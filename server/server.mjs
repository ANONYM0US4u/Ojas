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
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
mkdirSync(DATA_DIR, { recursive: true });
const ORDERS_LOG = path.join(DATA_DIR, "orders.jsonl");
const SLOTS_LOG = path.join(DATA_DIR, "slots.jsonl");

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
  /* loopback by default on a dev machine; Render web services set
     RENDER=true and need 0.0.0.0 to accept inbound traffic */
  host: env("HOST", env("RENDER", false) ? "0.0.0.0" : "127.0.0.1"),
  razorpayKey: env("RAZORPAY_KEY_ID", ""),
  razorpaySecret: env("RAZORPAY_KEY_SECRET", ""),
  razorpayTransferAccount: env("RAZORPAY_TRANSFER_ACCOUNT", ""),
  clinicWhatsapp: env("CLINIC_WHATSAPP", "917042347171"),
  waPhoneNumberId: env("WA_PHONE_NUMBER_ID", ""),
  waToken: env("WA_ACCESS_TOKEN", "")
};

/* admin token — never a public default. If ADMIN_TOKEN is unset (or still
   holds the old example value "dev-secret") we mint an ephemeral token per
   run and print it in the startup log, so the auditor reads it from the
   server process instead of from source code. */
const configuredAdminToken = env("ADMIN_TOKEN", "");
const usesGeneratedAdminToken = !configuredAdminToken || configuredAdminToken === "dev-secret";
const adminToken = usesGeneratedAdminToken ? randomBytes(24).toString("hex") : configuredAdminToken;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function log(msg) { console.log("[" + new Date().toISOString() + "] " + msg); }

/* ── per-route, per-IP rate limiting (zero-dep, in-memory) ───────── */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();
function rateLimit(key, max) {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now > b.resetAt) {
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
    }
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  b.count++;
  return b.count <= max;
}
const clientIp = (req) => (req.socket && req.socket.remoteAddress) || "unknown";

/* ── fees are decided by the server, never by the client ─────────── */
const PRICES = { consult: 9900 }; /* paise — the ₹99 consult */
const priceFor = (kind) => PRICES[String(kind || "consult").toLowerCase()] || PRICES.consult;

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

async function waSendTemplate(to, templateName, langCode, bodyParams) {
  if (!waConfigured()) throw new Error("WhatsApp not configured on server");
  const r = await fetch("https://graph.facebook.com/v21.0/" + CFG.waPhoneNumberId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + CFG.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: langCode },
        components: [{ type: "body", parameters: bodyParams.map((p) => ({ type: "text", text: String(p) })) }]
      }
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(obj ?? null));
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
    if (!rateLimit("order-create:" + clientIp(req), 20)) return json(res, 429, { error: "too many requests, please slow down" });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad json" }); }

    const kind = String(body.kind || "consult").slice(0, 20);
    const amount = priceFor(kind);

    const notes = (typeof body.notes === "object" && body.notes) || {};
    const participant = {
      kind,
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
    if (!rzPayable()) return json(res, 503, { error: "Razorpay not configured — payment verification unavailable" });
    if (!rateLimit("verify:" + clientIp(req), 20)) return json(res, 429, { error: "too many requests, please slow down" });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad json" }); }

    const orderId = String(body.orderId || "");
    const paymentId = String(body.paymentId || "");
    const signature = String(body.signature || "");

    if (!orderId || !paymentId || !signature) {
      return json(res, 400, { error: "missing fields (need orderId, paymentId, signature)" });
    }

    if (!safeEq(signature, rzSignature(orderId, paymentId))) {
      return json(res, 403, { error: "payment signature mismatch" });
    }

    /* a valid signature alone isn't enough — confirm with Razorpay that
       the payment actually settled for exactly our price before logging
       anything as a paid booking. */
    let pay;
    try {
      pay = await rz("payments/" + paymentId);
    } catch (e) {
      log("verify payment fetch error: " + e.message);
      return json(res, 502, { error: "could not confirm payment status with the gateway — nothing was logged" });
    }
    const kind = String(body.kind || "consult").slice(0, 20);
    const expectedPaise = priceFor(kind);
    if (!pay || pay.status !== "captured") return json(res, 403, { error: "payment is not captured" });
    if (Math.round(Number(pay.amount)) !== expectedPaise) return json(res, 403, { error: "paid amount does not match the consult fee" });

    /* idempotent — the same payment can never be logged twice (client
       retries and manual re-checks land here and short-circuit) */
    if (existsSync(ORDERS_LOG)) {
      const prev = readFileSync(ORDERS_LOG, "utf8").split(/\r?\n/).filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        .find((r) => r.razorpayPaymentId === paymentId);
      if (prev) return json(res, 200, { ok: true, bookingId: prev.merchantRef, alreadyBooked: true });
    }

    const booking = (typeof body.booking === "object" && body.booking) || {};
    const ref = String(body.merchantRef || "OJ-" + Date.now().toString().slice(-6)).slice(0, 40);
    const rec = {
      t: new Date().toISOString(),
      kind,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      amount: expectedPaise / 100,
      merchantRef: ref,
      bookingRef: ref,
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
          body: { transfers: [{ account: CFG.razorpayTransferAccount, amount: expectedPaise, currency: "INR" }] }
        });
        xferReports.push("transfer-created:" + (xfer && xfer.id || "?"));
      } catch (e) { xferReports.push("transfer-failed: " + e.message); }
    }

    return json(res, 200, { ok: true, bookingId: rec.merchantRef, transfers: xferReports });
  }

  if (url.pathname === "/api/booking-time" && req.method === "POST") {
    if (!rateLimit("booking-time:" + clientIp(req), 30)) return json(res, 429, { error: "too many slot requests — slow down" });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad json" }); }

    const bookingRef = String(body.bookingRef || "");
    const date = String(body.date || "-").slice(0, 40);
    const slot = String(body.slot || "").slice(0, 24);
    const b = (typeof body.booking === "object" && body.booking) || {};
    if (!bookingRef) return json(res, 400, { error: "missing bookingRef" });

    /* only a verified, captured booking may drive the clinic WhatsApp —
       the ref must exist in the paid-order log. Replays die here. */
    const knownRef = () => {
      if (!existsSync(ORDERS_LOG)) return false;
      return readFileSync(ORDERS_LOG, "utf8").split(/\r?\n/).some((l) => {
        try { return JSON.parse(l).bookingRef === bookingRef; } catch { return false; }
      });
    };
    if (!knownRef()) return json(res, 403, { error: "unknown booking reference" });

    const waReports = [];
    const clinicNum = CFG.clinicWhatsapp.replace(/^\+/, "");
    if (clinicNum && waConfigured()) {
      try {
        await waSendTemplate(clinicNum, "new_booking_alert", "en", [
          String(b.name || "-").slice(0, 80) + " (" + String(b.age ?? "-").slice(0, 10) + ", " + String(b.city || "-").slice(0, 40) + ")",
          String(b.phone || "-").slice(0, 12),
          String(b.concern || "-").slice(0, 160) + ", " + String(b.duration || "-").slice(0, 40),
          date + (slot ? " " + slot : "")
        ]);
        waReports.push("clinic");
      } catch (e) { waReports.push("clinic-failed: " + e.message); }
    }
    /* slot registry — occupied slots are served back via GET /api/slots */
    if (slot) {
      try { appendFileSync(SLOTS_LOG, JSON.stringify({ t: new Date().toISOString(), ref: bookingRef, date, slot }) + "\n"); }
      catch (e) { log("slot persist error: " + e.message); }
    }
    log("SLOT " + bookingRef + " " + date + " " + slot + " wa=" + waReports.join(","));
    return json(res, 200, { ok: true, wa: waReports });
  }

  if (url.pathname === "/api/slots" && req.method === "GET") {
    const date = String(url.searchParams.get("date") || "").slice(0, 40);
    if (!date || !existsSync(SLOTS_LOG)) return json(res, 200, []);
    const rows = readFileSync(SLOTS_LOG, "utf8").split(/\r?\n/).filter(Boolean)
      .map((l) => { try { const o = JSON.parse(l); return o.date === date ? o.slot : null; } catch { return null; } }).filter(Boolean);
    return json(res, 200, rows);
  }

  if (url.pathname === "/api/orders" && req.method === "GET") {
    if (!rateLimit("orders:" + clientIp(req), 60)) return json(res, 429, { error: "too many requests" });
    const authToken = url.searchParams.get("token") || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!safeEq(authToken, adminToken)) return json(res, 403, { error: "bad token" });
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
  /* deny dotfiles and everything outside the public surface — the
     project root contains .env, server sources and the booking log.
     Windows resolves filenames case-insensitively, so every deny check
     also runs on a lower-cased copy: /Server/… must hit the wall too. */
  const pc = p.toLowerCase();
  if (/(^|\/)\./.test(pc) || pc === "/server" || pc.startsWith("/server/") ||
      pc.startsWith("/shots/") || pc.startsWith("/node_modules/")) {
    res.writeHead(403, { "X-Content-Type-Options": "nosniff" });
    return res.end("forbidden");
  }
  const fp = path.resolve(path.join(ROOT, p));
  const win = process.platform === "win32";
  const fpCheck = win ? fp.toLowerCase() : fp;
  const rootCheck = win ? ROOT.toLowerCase() : ROOT;
  if (!fpCheck.startsWith(rootCheck)) { res.writeHead(403); return res.end("forbidden"); }
  if (!existsSync(fp) || !statSync(fp).isFile()) { res.writeHead(404); return res.end("not found"); }
  const type = MIME[path.extname(fp).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
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

server.listen(CFG.port, CFG.host, () => {
  log("OJAS server on http://" + CFG.host + ":" + CFG.port);
  log("razorpay: " + (rzPayable() ? "configured" : "NOT configured (payments run in QR/demo mode)"));
  log("whatsapp: " + (waConfigured() ? "configured" : "NOT configured (no push — booking log only)"));
  log("clinic whatsapp: " + CFG.clinicWhatsapp);
  log("orders log: " + ORDERS_LOG);
  if (usesGeneratedAdminToken) {
    log("WARN: ADMIN_TOKEN is unset (or still the example default) — generated an ephemeral token for this run: " +
        adminToken + " — add it to .env to keep audit access across restarts");
  }
});