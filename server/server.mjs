/* ══════════════════════════════════════════════════════════════════
   OJAS BACKEND — payments + WhatsApp delivery (zero npm dependencies)
   ──────────────────────────────────────────────────────────────────
   · Static host for the OJAS site — open http://localhost:8787
     (no more file:// drive restrictions).
   · Razorpay Orders API: creates a real payment order (UPI / cards /
     netbanking) for the exact amount and verifies the payment
     signature server-side — no "trust me, I paid" taps.
   · Meta WhatsApp Cloud API: after a verified payment, pushes the
     patient profile to the clinic's WhatsApp AND a confirmation to
     the patient. The system sends it — the patient does nothing.
   · Every booking is appended to data/orders.jsonl; audit via
     GET /api/orders?token=<ADMIN_TOKEN>.

   RUN:    node server/server.mjs          (or: npm start)
   CONFIG: copy .env.example to .env and fill in keys.
   RAZORPAY: test keys from dashboard.razorpay.com (test mode needs no
     KYC; live mode needs account verification — funds settle to the
     bank account registered there, i.e. the HDFC account behind
     7042347171@hdfc).
   WHATSAPP: Meta Cloud API app token + phone number ID (WhatsApp
     Business Platform). Sandbox can only message your own test
     number; with a verified business number + approved template it
     pushes to any patient.
   ══════════════════════════════════════════════════════════════════ */
import http from "node:http";
import { createReadStream, existsSync, readFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
mkdirSync(DATA_DIR, { recursive: true });
const ORDERS_LOG = path.join(DATA_DIR, "orders.jsonl");

/* ── .env loader (zero-dep) ─────────────────────────────────────── */
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const env = (name, def) => process.env[name] ?? def;

const CFG = {
  port: Number(env("PORT", 8787)),
  razorpayKey: env("RAZORPAY_KEY_ID", ""),
  razorpaySecret: env("RAZORPAY_KEY_SECRET", ""),
  razorpayTransferAccount: env("RAZORPAY_TRANSFER_ACCOUNT", ""),
  clinicWhatsapp: env("CLINIC_WHATSAPP", "917042347171"),
  waPhoneNumberId: env("WA_PHONE_NUMBER_ID", ""),
  waToken: env("WA_ACCESS_TOKEN", ""),
  adminToken: env("ADMIN_TOKEN", "dev-secret")
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function log(msg) { console.log("[" + new Date().toISOString() + "] " + msg); }

/* ── Razorpay REST (no SDK needed) ──────────────────────────────── */
const rzPayable = () => !!(CFG.razorpayKey && CFG.razorpaySecret);
const rzAuth = () => "Basic " + Buffer.from(CFG.razorpayKey + ":" + CFG.razorpaySecret).toString("base64");

async function rz(resource, opts = {}) {
  const r = await fetch("https://api.razorpay.com/v1/" + resource, {
    method: opts.method || "GET",
    headers: { Authorization: rzAuth(), "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error("Razorpay " + r.status + ": " + (typeof data === "string" ? data : JSON.stringify(data)));
  return data;
}

function rzSignature(orderId, paymentId) {
  return createHmac("sha256", CFG.razorpaySecret).update(orderId + "|" + paymentId).digest("hex");
}
function safeEq(a, b) {
  const ha = Buffer.from(String(a)), hb = Buffer.from(String(b));
  return ha.length === hb.length && createHmac("sha256", "ojas-eq").update(ha).digest().equals(createHmac("sha256", "ojas-eq").update(hb).digest());
}

/* ── WhatsApp Cloud API (Meta) ──────────────────────────────────── */
const waConfigured = () => !!(CFG.waPhoneNumberId && CFG.waToken);

async function waSend(to, text) {
  if (!waConfigured()) throw new Error("WhatsApp not configured on server");
  const r = await fetch("https://graph.facebook.com/v21.0/" + CFG.waPhoneNumberId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + CFG.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: { body: String(text) }
    })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error("WhatsApp " + r.status + ": " + JSON.stringify(data));
  return data;
}

/* ── order book (JSONL audit log) ───────────────────────────────── */
function storeBooking(rec) { appendFileSync(ORDERS_LOG, JSON.stringify(rec) + "\n"); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(obj ?? null));
}

/* ── WhatsApp message builders ──────────────────────────────────── */
function buildClinicMessage(rec) {
  const b = rec.booking || {};
  const L = ["NEW OJAS " + String(rec.kind || "order").toUpperCase() + " - " + (rec.bookingRef || rec.merchantRef || "OJ-??????"), ""];
  if (b.name) L.push("Name: " + b.name);
  if (b.age) L.push("Age: " + b.age + " yrs");
  if (b.city) L.push("City: " + b.city);
  if (b.profession) L.push("Profession: " + b.profession);
  if (b.phone) L.push("WhatsApp: +91 " + b.phone);
  if (b.concern) L.push("Concern: " + b.concern);
  if (b.duration) L.push("Duration: " + b.duration);
  if (b.pillar) L.push("Consult: " + b.pillar);
  if (b.date) L.push("Scheduled: " + b.date + (b.slot ? " at " + b.slot : ""));
  if (b.plan) L.push("Program: " + b.plan);
  L.push("Amount: Rs " + (rec.amount || 0) + " PAID");
  return L.join("\n");
}
function buildPatientMessage(rec) {
  const b = rec.booking || {};
  let s = "OJAS - your " + (rec.kind || "order") + " is CONFIRMED.";
  if (b.date) s += " Scheduled " + b.date + (b.slot ? " at " + b.slot : "") + ".";
  s += " Your care team has been notified. - OJAS Care";
  return s;
}

/* ── API routes ─────────────────────────────────────────────────── */
async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, { ok: true, razorpay: rzPayable(), transferAccount: !!CFG.razorpayTransferAccount, whatsapp: waConfigured(), clinicWhatsapp: CFG.clinicWhatsapp });
  }

  if (url.pathname === "/api/order-create" && req.method === "POST") {
    if (!rzPayable()) return json(res, 503, { error: "Razorpay not configured. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to .env" });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad json" }); }

    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1) return json(res, 400, { error: "invalid amount" });

    const notes = (typeof body.notes === "object" && body.notes) || {};
    const participant = {
      kind: String(body.kind || "order").slice(0, 20),
      name: String(notes.name || "").slice(0, 80),
      phone: String(notes.phone || "").replace(/[^0-9]/g, "").slice(0, 12),
      detail: String(notes.detail || notes.plan || "").slice(0, 160),
      notes
    };

    try {
      const order = await rz("orders", {
        method: "POST",
        body: {
          amount,
          currency: "INR",
          receipt: "OJ-" + Date.now().toString().slice(-8),
          notes: participant
        }
      });
      return json(res, 200, { orderId: order.id, key: CFG.razorpayKey, amount, participant });
    } catch (e) {
      log("order-create error: " + e.message);
      if (/401|403/.test(e.message)) return json(res, 401, { error: "Razorpay auth failed — check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET" });
      return json(res, 502, { error: "order could not be created: " + e.message });
    }
  }

  if (url.pathname === "/api/verify" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad json" }); }

    const orderId = String(body.orderId || "");
    const paymentId = String(body.paymentId || "");
    const signature = String(body.signature || "");

    if (!orderId || !paymentId || !signature) {
      return json(res, 400, { error: "missing fields (need orderId, paymentId, signature)" });
    }

    let verified = false;
    if (rzPayable()) {
      verified = safeEq(signature, rzSignature(orderId, paymentId));
    } else {
      verified = safeEq(signature, "ojas-demo-" + createHmac("sha256", "demo").update(orderId + "|" + paymentId).digest("hex"));
    }
    if (!verified) return json(res, 403, { error: "payment signature mismatch" });

    const booking = (typeof body.booking === "object" && body.booking) || {};
    const rec = {
      t: new Date().toISOString(),
      kind: String(body.kind || "order"),
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      amount: Math.round(Number(body.amount)) || 0,
      merchantRef: String(body.merchantRef || "OJ-" + Date.now().toString().slice(-6)),
      bookingRef: String(body.merchantRef || "OJ-" + Date.now().toString().slice(-6)),
      booking
    };
    storeBooking(rec);
    log("PAID " + rec.kind + " " + (booking.name || "(no name)") + " ref=" + rec.merchantRef + " rz=" + paymentId);

    /* move the money to the clinic's UPI VPA (e.g. 7042347171@hdfc) —
       requires the transfer account (UPI VPA) configured on Razorpay:
       dashboard → Settings → Route/Topups → create an account with the
       UPI VPA, then put its account_id in RAZORPAY_TRANSFER_ACCOUNT. */
    const xferReports = [];
    if (CFG.razorpayTransferAccount) {
      try {
        const xfer = await rz("payments/" + paymentId + "/transfers", {
          method: "POST",
          body: { transfers: [{ account: CFG.razorpayTransferAccount, amount: rec.amount, currency: "INR" }] }
        });
        xferReports.push("transfer-created:" + (xfer && xfer.id || "?"));
      } catch (e) { xferReports.push("transfer-failed: " + e.message); }
    }

    const waReports = [];
    const clinicNum = CFG.clinicWhatsapp.replace(/^\+/, "");
    if (clinicNum) {
      try { await waSend(clinicNum, buildClinicMessage(rec)); waReports.push("clinic"); }
      catch (e) { waReports.push("clinic-failed: " + e.message); }
    }
    const patientPhone = String(booking.phone || "").replace(/[^0-9]/g, "");
    if (patientPhone) {
      try { await waSend(patientPhone, buildPatientMessage(rec)); waReports.push("patient"); }
      catch (e) { waReports.push("patient-failed: " + e.message); }
    }
    return json(res, 200, { ok: true, bookingId: rec.merchantRef, wa: waReports, transfers: xferReports });
  }

  if (url.pathname === "/api/orders" && req.method === "GET") {
    if (url.searchParams.get("token") !== CFG.adminToken) return json(res, 403, { error: "bad token" });
    if (!existsSync(ORDERS_LOG)) return json(res, 200, []);
    const rows = readFileSync(ORDERS_LOG, "utf8").split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return json(res, 200, rows);
  }

  return json(res, 404, { error: "not found" });
}

/* ── static files (same server, no CORS pain) ───────────────────── */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname || "/");
  if (p === "/") p = "/index.html";
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  if (!existsSync(fp) || !statSync(fp).isFile()) { res.writeHead(404); return res.end("not found"); }
  const type = MIME[path.extname(fp).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  createReadStream(fp).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    log("handler error: " + (e && e.stack || e));
    try { json(res, 500, { error: "server error" }); } catch {}
  }
});

server.listen(CFG.port, () => {
  log("OJAS server on http://localhost:" + CFG.port);
  log("razorpay: " + (rzPayable() ? "configured" : "NOT configured (payments run in QR/demo mode)"));
  log("whatsapp: " + (waConfigured() ? "configured" : "NOT configured (no push — booking log only)"));
  log("clinic whatsapp: " + CFG.clinicWhatsapp);
  log("orders log: " + ORDERS_LOG);
});