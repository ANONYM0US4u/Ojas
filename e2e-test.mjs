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
  for (const f of ["index.html", "script.js", "styles.css", "ojaslogo1.svg"]) {
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
  check("picker screen shows", await evalJs(`!document.querySelector('[data-screen="picker"]').hidden`));
  check("picker continue disabled until selection", await evalJs(`document.querySelector('[data-picker-continue]').disabled`));

  // select Gut + Sexual only — the other two stay unassessed
  await evalJs(`document.querySelectorAll('.cat-card').forEach(c => { if (c.dataset.cat === 'gut' || c.dataset.cat === 'sexual') c.click(); });`);
  await sleep(100);
  check("picker continue enabled", await evalJs(`!document.querySelector('[data-picker-continue]').disabled`));
  await evalJs(`document.querySelector('[data-picker-continue]').click()`);
  await sleep(150);
  check("first checklist is sexual", await evalJs(`!document.querySelector('[data-screen="category"]').hidden && document.getElementById('cat-badge').textContent.includes('SEXUAL')`));
  check("next disabled before symptoms", await evalJs(`document.querySelector('[data-screen="category"] [data-next-step]').disabled`));

  // Sexual: tick ED + PME
  await evalJs(`document.querySelectorAll('#cat-symptoms input').forEach((b, i) => { if (i < 2) b.click(); });`);
  await sleep(100);
  check("next enabled after symptoms", await evalJs(`!document.querySelector('[data-screen="category"] [data-next-step]').disabled`));
  await evalJs(`document.querySelector('[data-screen="category"] [data-next-step]').click()`);
  await sleep(150);
  check("second checklist is gut", await evalJs(`document.getElementById('cat-badge').textContent.includes('GUT')`));

  // Gut: tick one symptom + add a note, then submit (last category)
  await evalJs(`document.querySelectorAll('#cat-symptoms input').forEach((b, i) => { if (i === 0) b.click(); });`);
  await evalJs(`const n = document.getElementById('cat-note'); n.value = 'Bloating after heavy meals'; n.dispatchEvent(new Event('input', {bubbles:true}));`);
  await sleep(100);
  check("submit label on last checklist", await evalJs(`document.querySelector('[data-screen="category"] [data-next-step]').textContent.includes('Submit')`));
  await evalJs(`document.querySelector('[data-screen="category"] [data-next-step]').click()`);
  await sleep(200);
  check("computing screen shows", await evalJs(`!document.querySelector('[data-screen="computing"]').hidden`));
}

async function run() {
  syncSite();
  const t = await fetch(`${CDP_BASE}/json/new?${URL.split("#")[0]}`, { method: "PUT" }).then((r) => r.json());
  await connect(t.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");
  // demo payment mode must be set BEFORE any page script runs (detectBackend
  // probes the backend at boot) — otherwise payMode falls back to QR.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__OJAS_TEST__ = true;" });
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
  const bars = await evalJs(`Array.from(document.querySelectorAll('.pbar:not([hidden])')).map(b => parseFloat(b.querySelector('.pbar-fill').style.width))`);
  check("only assessed pillar bars animate", bars.length === 2 && bars.every((w) => w > 0), bars.join(","));
  check("unassessed pillar bars hidden", await evalJs(`document.querySelectorAll('.pbar[hidden]').length === 2`));
  let litNodes = 0, hotNodes = 0;
  for (let i = 0; i < 30 && litNodes < 3; i++) {
    await sleep(400);
    litNodes = await evalJs(`document.querySelectorAll('.graph-node.lit').length`);
    hotNodes = await evalJs(`document.querySelectorAll('.graph-node.hot').length`);
  }
  check("domino nodes lit (chain animates)", litNodes >= 3, litNodes + " nodes lit");
  check("sexual chain endpoint hot", hotNodes >= 1, hotNodes + " hot nodes");
  check("unassessed graph nodes hidden", await evalJs(`Array.from(document.querySelectorAll('.graph-node')).filter(n => getComputedStyle(n).display === 'none').length === 3`));
  const summaryLen = await evalJs(`document.getElementById('summary-text').innerHTML.length`);
  check("clinical summary rendered", summaryLen > 100, summaryLen + " chars");
  check("summary notes unassessed areas", await evalJs(`document.getElementById('summary-text').textContent.includes('2 of 4')`));

  // ── Results CTA → ₹99 consult opens with top assessed pillar ──
  await evalJs(`document.getElementById('results-consult').click()`);
  await sleep(250);
  check("results consult CTA opens modal", await evalJs(`document.getElementById('consult-modal').classList.contains('show')`));
  check("multi-pillar CTA lists all assessed areas", await evalJs(`document.getElementById('consult-pillar-tag').textContent.includes('WELLNESS') && document.querySelectorAll('#c-problem .c-group-title').length === 2`));
  check("multi-pillar CTA first group is sexual", await evalJs(`document.querySelector('#c-problem .c-group-title').textContent.includes('Sexual')`));
  check("multi-pillar CTA keeps all concern options", await evalJs(`document.querySelectorAll('#c-problem .cbox').length === 10`));
  await evalJs(`document.getElementById('consult-close').click()`);
  await sleep(150);
  check("results consult modal closes", await evalJs(`!document.getElementById('consult-modal').classList.contains('show')`));

  // ── Retake cleanliness: revisiting diagnostic after a finished quiz ──
  await evalJs(`location.hash = '#/diagnostic'`);
  await sleep(250);
  check("revisit diagnostic resets to intro", await evalJs(`document.querySelector('[data-screen="intro"]').hidden === false && document.querySelector('[data-screen="computing"]').hidden === true`));

  // ── Medical panel ──
  await evalJs(`location.hash = '#/panel'`);
  await sleep(250);
  const docCards = await evalJs(`document.querySelectorAll('.doc-card').length`);
  check("6 doctor cards rendered", docCards === 6, docCards + " cards");
  check("registration numbers present", await evalJs(`Array.from(document.querySelectorAll('.doc-reg')).every(d => d.textContent.includes('Reg. No.'))`));

  // ── Consult booking (₹99) — test mode: UPI deep-link + WhatsApp stubbed ──
  await evalJs(`location.hash = '#/'`);
  await sleep(250);
  await evalJs(`document.querySelector('.quad-card[data-consult="sexual"]').click()`);
  await sleep(250);
  check("consult modal opens", await evalJs(`document.getElementById('consult-modal').classList.contains('show')`));
  await evalJs(`
    document.getElementById('c-name').value = 'Rahul Sharma';
    document.getElementById('c-age').value = '34';
    document.getElementById('c-phone').value = '9876543210';
    document.getElementById('c-profession').value = 'Software Engineer';
    document.getElementById('c-city').value = 'Mumbai';
    document.querySelector('#c-problem .cbox[value="ED — Erectile Dysfunction"]').click();
    document.querySelector('#c-duration .seg[data-v="1-6 months"]').click();
    document.getElementById('consult-to-pay').click();
  `);
  await sleep(250);
  check("consult advances to payment step", await evalJs(`document.querySelector('.consult-step[data-consult-step="payment"]').classList.contains('show')`));
  check("payment step actually visible on screen", await evalJs(`window.getComputedStyle(document.querySelector('.consult-step[data-consult-step="payment"]')).display !== 'none' && document.querySelector('.consult-step[data-consult-step="payment"]').getBoundingClientRect().height > 0`));
  check("no consult step relies on hidden attribute", await evalJs(`document.querySelectorAll('.consult-step[hidden]').length === 0`));
  await evalJs(`document.getElementById('consult-pay-btn').click()`);
  await sleep(1800);
  check("consult advances to time slot step", await evalJs(`document.querySelector('.consult-step[data-consult-step="timeslot"]').classList.contains('show')`));
  check("time slot step actually visible on screen", await evalJs(`window.getComputedStyle(document.querySelector('.consult-step[data-consult-step="timeslot"]')).display !== 'none'`));
  await evalJs(`document.querySelector('#consult-slots .slot-btn:not(.is-taken)').click(); document.getElementById('consult-confirm-slot').click();`);
  await sleep(300);
  check("consult done step + record saved", await evalJs(`document.querySelector('.consult-step[data-consult-step="done"]').classList.contains('show') && window.getComputedStyle(document.querySelector('.consult-step[data-consult-step="done"]')).display !== 'none' && JSON.parse(localStorage.getItem('ojas-consultations')||'[]').length === 1`));
  check("booking ref + slot chips filled", await evalJs(`document.getElementById('consult-ref').textContent.startsWith('OJ-') && document.getElementById('consult-slot').textContent.includes(' · ')`));
  check("saved profile has all details", await evalJs(`JSON.parse(localStorage.getItem('ojas-consultations'))[0].fields.name === 'Rahul Sharma' && JSON.parse(localStorage.getItem('ojas-consultations'))[0].fields.concern === 'ED — Erectile Dysfunction'`));

  // ── Solo-pillar run: lone node centers; map styles untouched for 2-4 ──
  await evalJs(`location.hash = '#/diagnostic'`);
  await sleep(250);
  await evalJs(`document.querySelector('[data-start-quiz]').click()`);
  await sleep(150);
  await evalJs(`document.querySelector('.cat-card[data-cat="sexual"]').click(); document.querySelector('[data-picker-continue]').click();`);
  await sleep(200);
  await evalJs(`document.querySelector('.cbox').click(); document.querySelector('[data-next-step]').click();`);
  await sleep(3600);
  check("solo run lands on results", await evalJs(`location.hash === '#/results'`));
  check("solo run applies map-solo", await evalJs(`document.getElementById('domino-graph').classList.contains('map-solo')`));
  const soloCentered = await evalJs(`(function(){ const g = document.getElementById('domino-graph'), n = g.querySelector('.graph-node.lit'); if (!n) return false; const gr = g.getBoundingClientRect(), nr = n.getBoundingClientRect(); return Math.abs((nr.left + nr.width / 2) - (gr.left + gr.width / 2)) < 40 && Math.abs((nr.top + nr.height / 2) - (gr.top + gr.height / 2)) < 40; })()`);
  check("solo node centered in frame", soloCentered);
  check("solo caption shown", await evalJs(`!document.getElementById('map-solo-note').hidden && document.getElementById('map-solo-note').textContent.includes('1 area')`));
  check("solo CTA keeps single-format form", await evalJs(`(function(){ document.getElementById('results-consult').click(); const modal = document.getElementById('consult-modal'); const ok = modal.classList.contains('show') && document.getElementById('consult-pillar-tag').textContent.includes('SEXUAL') && document.querySelectorAll('#c-problem .c-group-title').length === 0 && document.querySelectorAll('#c-problem .cbox').length === 5; document.getElementById('consult-close').click(); return ok; })()`));

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${results.length} checks passed`);
  process.exit(passCount === results.length ? 0 : 1);
}

run().catch((e) => { console.error("TEST ERROR:", e.message); process.exit(1); });
