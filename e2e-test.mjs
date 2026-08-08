/* OJAS end-to-end smoke test — drives headless Chrome via CDP.
   Note: Chrome on this machine cannot read file:// on the D: drive,
   so the OJAS static files are synced to C:/tmp/ojas before loading. */
import { copyFileSync, mkdirSync } from "node:fs";

const CDP_BASE = "http://127.0.0.1:9223";
const SRC_DIR = "D:/OpenCodeDevelopement/ojas";
const DST_DIR = "C:/tmp/ojas";
const URL = "file:///C:/tmp/ojas/index.html";

function syncSite() {
  mkdirSync(DST_DIR, { recursive: true });
  for (const f of ["index.html", "script.js", "styles.css"]) {
    copyFileSync(`${SRC_DIR}/${f}`, `${DST_DIR}/${f}`);
  }
}

let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  };
}

async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval error: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result.value;
}

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPageLoad() {
  for (let i = 0; i < 60; i++) {
    try {
      const ready = await evalJs(`location.href.includes('index.html') && document.readyState === 'complete'`);
      if (ready) return;
    } catch (e) { /* target not navigated yet — opaque origin */ }
    await sleep(150);
  }
  throw new Error("page did not finish loading");
}

async function clickQuizFlow() {
  await evalJs(`document.querySelector('[data-start-quiz]').click()`);
  await sleep(150);
  check("quiz starts on gut screen", await evalJs(`!document.querySelector('[data-screen="gut"]').hidden`));

  // Step 1: Gut — answer all 3 groups
  await evalJs(`document.querySelectorAll('[data-screen="gut"] .seg-group').forEach(g => { const b = g.querySelector('.seg[data-v="2"]'); if (b) b.click(); });`);
  await sleep(100);
  check("gut Continue enabled", await evalJs(`!document.querySelector('[data-screen="gut"] [data-next-step]').disabled`));
  await evalJs(`document.querySelector('[data-screen="gut"] [data-next-step]').click()`);
  await sleep(150);
  check("advances to mind screen", await evalJs(`!document.querySelector('[data-screen="mind"]').hidden`));

  // Step 2: Mind — sliders already defaulted; set them higher
  await evalJs(`document.querySelectorAll('[data-screen="mind"] input[type="range"]').forEach(s => { s.value = 8; s.dispatchEvent(new Event('input', {bubbles:true})); });`);
  await evalJs(`document.querySelector('[data-screen="mind"] [data-next-step]').click()`);
  await sleep(150);
  check("advances to sleep screen", await evalJs(`!document.querySelector('[data-screen="sleep"]').hidden`));

  // Step 3: Sleep
  await evalJs(`document.querySelectorAll('[data-screen="sleep"] .seg-group').forEach(g => { const b = g.querySelector('.seg[data-v="2"]'); if (b) b.click(); });`);
  await evalJs(`document.querySelector('[data-screen="sleep"] [data-next-step]').click()`);
  await sleep(150);
  check("advances to sexual screen", await evalJs(`!document.querySelector('[data-screen="sexual"]').hidden`));

  // Step 4: Sexual
  await evalJs(`document.querySelectorAll('[data-screen="sexual"] .seg-group').forEach(g => { const b = g.querySelector('.seg[data-v="2"]'); if (b) b.click(); });`);
  await evalJs(`document.querySelector('[data-screen="sexual"] [data-submit-quiz]').click()`);
  await sleep(200);
  check("computing screen shows", await evalJs(`!document.querySelector('[data-screen="computing"]').hidden`));
}

async function run() {
  syncSite();
  const t = await fetch(`${CDP_BASE}/json/new?${URL.split("#")[0]}`, { method: "PUT" }).then((r) => r.json());
  await connect(t.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");
  await waitForPageLoad();
  await evalJs(`localStorage.clear()`);
  await send("Page.reload", { ignoreCache: true });
  await waitForPageLoad();
  await evalJs(`window.__OJAS_TEST__ = true;`);
  await sleep(1500);

  // ── Consent modal ──
  check("consent modal shown on first visit", await evalJs(`document.getElementById('consent-modal').classList.contains('show')`));
  await evalJs(`document.getElementById('consent-dpdp').click(); document.getElementById('consent-terms').click();`);
  await sleep(80);
  check("consent accept enabled", await evalJs(`!document.getElementById('consent-accept').disabled`));
  await evalJs(`document.getElementById('consent-accept').click()`);
  await sleep(150);
  check("consent modal closes", await evalJs(`!document.getElementById('consent-modal').classList.contains('show')`));

  // ── Results guard: direct nav to #/results without quiz → redirect ──
  await evalJs(`location.hash = '#/results'`);
  await sleep(200);
  check("results guard redirects to diagnostic", await evalJs(`location.hash === '#/diagnostic'`));

  // ── Full quiz flow ──
  await clickQuizFlow();
  await sleep(3400); // computing animation
  check("lands on results page", await evalJs(`location.hash === '#/results'`));
  const bars = await evalJs(`Array.from(document.querySelectorAll('.pbar-fill')).map(f => f.style.width)`);
  check("pillar bars animate", bars.every((w) => parseFloat(w) > 0) && bars.length === 4, bars.join(","));
  let litNodes = 0, hotNodes = 0;
  for (let i = 0; i < 30 && (litNodes < 6 || hotNodes < 2); i++) {
    await sleep(400);
    litNodes = await evalJs(`document.querySelectorAll('.graph-node.lit').length`);
    hotNodes = await evalJs(`document.querySelectorAll('.graph-node.hot').length`);
  }
  check("domino nodes lit (chain animates)", litNodes >= 4, litNodes + " nodes lit");
  check("hot chain endpoint lit", hotNodes >= 2, hotNodes + " hot nodes");
  const summaryLen = await evalJs(`document.getElementById('summary-text').innerHTML.length`);
  check("clinical summary rendered", summaryLen > 100, summaryLen + " chars");

  // ── Pricing tracks ──
  await evalJs(`location.hash = '#/programs'`);
  await sleep(250);
  check("programs page active", await evalJs(`document.querySelector('.page-programs').classList.contains('active')`));
  check("sleep track visible by default", await evalJs(`!document.querySelector('.price-card[data-track="sleep"]').hidden`));
  await evalJs(`document.querySelector('.track-tab[data-track="sexual"]').click()`);
  await sleep(150);
  check("sexual track switches", await evalJs(`document.querySelector('.price-card[data-track="sexual"]').hidden === false && document.querySelector('.price-card[data-track="sleep"]').hidden === true`));

  // ── Select plan → checkout hydration ──
  await evalJs(`document.querySelector('[data-select-plan][data-plan="sexual-60"]').click()`);
  await sleep(300);
  check("plan routes to checkout", await evalJs(`location.hash === '#/checkout'`));
  check("order title hydrated", await evalJs(`document.getElementById('order-title').textContent.includes('60-Day')`), await evalJs(`document.getElementById('order-title').textContent`));
  check("order price hydrated", await evalJs(`document.getElementById('order-price').textContent.includes('18,450')`), await evalJs(`document.getElementById('order-price').textContent`));

  // ── Payment method tabs + success modal ──
  await evalJs(`document.querySelector('.pay-tab[data-method="card"]').click()`);
  await sleep(100);
  check("card panel shows", await evalJs(`!document.querySelector('[data-panel="card"]').hidden`));
  await evalJs(`document.querySelector('[data-panel="card"] [data-pay]').click()`);
  await sleep(200);
  check("payment success modal shows", await evalJs(`document.getElementById('pay-success').classList.contains('show')`));
  await evalJs(`document.querySelector('#pay-success [data-close-success]').click()`);
  await sleep(150);
  check("success modal closes + back home", await evalJs(`!document.getElementById('pay-success').classList.contains('show') && location.hash === '#/'`));

  // ── Medical panel ──
  await evalJs(`location.hash = '#/panel'`);
  await sleep(250);
  const docCards = await evalJs(`document.querySelectorAll('.doc-card').length`);
  check("6 doctor cards rendered", docCards === 6, docCards + " cards");
  check("registration numbers present", await evalJs(`Array.from(document.querySelectorAll('.doc-reg')).every(d => d.textContent.includes('Reg. No.'))`));

  // ── Consult booking (₹99) — test mode: UPI deep-link + WhatsApp stubbed ──
  await evalJs(`location.hash = '#/'`);
  await sleep(250);
  await evalJs(`document.querySelector('.quad-card[data-consult="gut"]').click()`);
  await sleep(250);
  check("consult modal opens", await evalJs(`document.getElementById('consult-modal').classList.contains('show')`));
  await evalJs(`
    document.getElementById('c-name').value = 'Rahul Sharma';
    document.getElementById('c-age').value = '34';
    document.getElementById('c-phone').value = '9876543210';
    document.getElementById('c-profession').value = 'Software Engineer';
    document.getElementById('c-city').value = 'Mumbai';
    document.querySelector('#c-problem .seg[data-v="Erectile Dysfunction (ED)"]').click();
    document.getElementById('consult-to-pay').click();
  `);
  await sleep(250);
  check("consult advances to payment step", await evalJs(`document.querySelector('.consult-step[data-consult-step="payment"]').classList.contains('show')`));
  await evalJs(`document.getElementById('consult-pay-btn').click()`);
  await sleep(1800);
  check("consult advances to time slot step", await evalJs(`document.querySelector('.consult-step[data-consult-step="timeslot"]').classList.contains('show')`));
  await evalJs(`document.querySelector('#consult-slots .slot-btn:not(.is-taken)').click(); document.getElementById('consult-confirm-slot').click();`);
  await sleep(300);
  check("consult done step + record saved", await evalJs(`document.querySelector('.consult-step[data-consult-step="done"]').classList.contains('show') && JSON.parse(localStorage.getItem('ojas-consultations')||'[]').length === 1`));
  check("care-team notification note shown", await evalJs(`!document.getElementById('consult-wa-note').hidden && document.getElementById('consult-wa-note').textContent.includes('notified')`));
  check("saved profile has all details", await evalJs(`JSON.parse(localStorage.getItem('ojas-consultations'))[0].fields.name === 'Rahul Sharma' && JSON.parse(localStorage.getItem('ojas-consultations'))[0].fields.concern === 'Erectile Dysfunction (ED)'`));

  // ── Checkout payment — test mode: success modal shows on first pay click (no manual confirm) ──
  await evalJs(`document.getElementById('consult-done').click()`);
  await sleep(150);
  await evalJs(`document.querySelector('.track-tab[data-track="sleep"]').click()`);
  await evalJs(`location.hash = '#/programs'`);
  await sleep(250);
  await evalJs(`document.querySelector('[data-select-plan][data-plan="sleep-60"]').click()`);
  await sleep(300);
  check("checkout routes again", await evalJs(`location.hash === '#/checkout'`));
  await evalJs(`document.getElementById('pay-name').value = 'Rahul Sharma'; document.getElementById('pay-phone').value = '9876543210';`);
  await evalJs(`document.querySelector('[data-panel="upi"] [data-pay]').click()`);
  await sleep(300);
  check("checkout success modal shows", await evalJs(`document.getElementById('pay-success').classList.contains('show')`));
  check("no i've-paid / whatsapp buttons left", await evalJs(`!document.getElementById('consult-wa-btn') && !document.getElementById('pay-wa-btn')`));
  await evalJs(`document.querySelector('#pay-success [data-close-success]').click()`);
  await sleep(150);
  check("checkout closes + back home", await evalJs(`!document.getElementById('pay-success').classList.contains('show') && location.hash === '#/'`));

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${results.length} checks passed`);
  process.exit(passCount === results.length ? 0 : 1);
}

run().catch((e) => { console.error("TEST ERROR:", e.message); process.exit(1); });
