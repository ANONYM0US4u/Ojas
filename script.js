/* ═══════════════════════════════════════════════
   OJAS — Men's Health Platform · Draft v0.1
   Router · Consent · Quiz Engine · Domino Graph · Checkout
   ═══════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── Helpers ─────────────────────────────── */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ── SPA Router ───────────────────────────── */
  const routes = {
    "":        "home",
    "home":    "home",
    "science": "science",
    "diagnostic": "diagnostic",
    "results": "results",
    "panel":   "panel"
  };

  const pages = $$(".page");
  const navLinks = $$("[data-nav]");

  function navigate() {
    stopComputing();
    const hash = location.hash.replace(/^#\/?/, "").split("?")[0];
    const pageName = routes[hash] || "home";
    pages.forEach((p) => p.classList.toggle("active", p.dataset.page === pageName));
    navLinks.forEach((a) => {
      const href = (a.getAttribute("href") || "#/").replace("#/", "").split("?")[0];
      a.classList.toggle("active", routes[href] === pageName);
    });
    document.title = "OJAS — Men's Health Platform";
    if (pageName !== "home") document.title = pageName.replace(/\b\w/g, (c) => c.toUpperCase()) + " · OJAS";
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    closeNav();
    if (pageName === "results" && (quizState.computing || !quizState.computed)) {
      location.hash = "#/diagnostic";
    }
    /* a finished quiz leaves the computing screen visible forever —
       reset to intro whenever Diagnostic is opened again */
    if (pageName === "diagnostic" && quizState.computed) {
      quizState.selected = [];
      quizState.flow = [];
      quizState.step = 0;
      quizState.answers = {};
      quizState.computed = false;
      quizState.computing = false;
      $$(".cat-card").forEach((c) => c.classList.remove("selected"));
      syncPickerBtn();
      showScreen("intro");
    }
  }

  window.addEventListener("hashchange", navigate);

  /* ── Mobile nav ───────────────────────────── */
  const navToggle = $("#nav-toggle");
  const siteNav = $("#site-nav");
  function closeNav() { siteNav.classList.remove("open"); navToggle.classList.remove("open"); navToggle.setAttribute("aria-expanded", "false"); }
  navToggle.addEventListener("click", () => {
    const open = siteNav.classList.toggle("open");
    navToggle.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", open);
  });

  /* ── DPDP Consent Modal ───────────────────── */
  const consentModal = $("#consent-modal");
  const cbDpdp = $("#consent-dpdp");
  const cbTerms = $("#consent-terms");
  const consentAccept = $("#consent-accept");

  function consentOpen() { consentModal.classList.add("show"); consentModal.setAttribute("aria-hidden", "false"); }
  function consentClose() { consentModal.classList.remove("show"); consentModal.setAttribute("aria-hidden", "true"); }

  cbDpdp.addEventListener("change", syncConsentBtn);
  cbTerms.addEventListener("change", syncConsentBtn);
  function syncConsentBtn() {
    consentAccept.disabled = !(cbDpdp.checked && cbTerms.checked);
  }
  consentAccept.addEventListener("click", () => {
    localStorage.setItem("ojas-consent", "v1");
    consentClose();
  });
  $("#consent-decline").addEventListener("click", () => {
    consentClose();
    if (location.hash !== "#/" && location.hash !== "") location.hash = "#/";
  });

  /* ── Quiz Engine ──────────────────────────── */
  const ASSESSMENT_SPECS = {
    sexual: {
      label: "Sexual Health",
      tag: "SEXUAL HEALTH ASSESSMENT",
      symptoms: [
        "ED — Erectile Dysfunction",
        "PME — Premature Ejaculation",
        "Low Libido",
        "Performance Anxiety"
      ],
      notePlaceholder: "Other symptoms or specific notes… e.g. frequency, triggers, anything the doctor should know"
    },
    sleep: {
      label: "Sleep Improvement",
      tag: "SLEEP IMPROVEMENT ASSESSMENT",
      symptoms: [
        "Trouble falling asleep",
        "Waking up frequently",
        "Waking up exhausted",
        "Irregular sleep schedule"
      ],
      notePlaceholder: "Other symptoms or specific notes… e.g. shift work, snoring, restless nights"
    },
    gut: {
      label: "Gut Health",
      tag: "GUT HEALTH ASSESSMENT",
      symptoms: [
        "Bloating or frequent gas",
        "Irregular bowel movements",
        "Acidity, heartburn, or GERD",
        "Low energy after meals"
      ],
      notePlaceholder: "Other symptoms or specific notes… e.g. food triggers, IBS, chronic acidity"
    },
    mind: {
      label: "Emotional Well-Being",
      tag: "EMOTIONAL WELL-BEING ASSESSMENT",
      symptoms: [
        "Chronic stress",
        "Persistent anxiety/worry",
        "Burnout",
        "Mood swings"
      ],
      notePlaceholder: "Other symptoms or specific notes… e.g. work pressure, relationship strain, racing thoughts"
    }
  };
  const CAT_ORDER = ["sexual", "sleep", "gut", "mind"];

  const quizState = { selected: [], flow: [], step: 0, answers: {}, computed: false, computing: false };
  const screens = $$(".quiz-screen");
  const progress = $("#quiz-progress");
  const progressFill = $("#quiz-progress-fill");

  function currentScreenName() {
    const el = screens.find((s) => !s.hidden);
    return el ? el.dataset.screen : "";
  }

  function showScreen(name) {
    screens.forEach((s) => (s.hidden = s.dataset.screen !== name));
    progress.hidden = name === "intro" || name === "computing" || name === "picker";
  }

  function renderProgress() {
    const total = quizState.flow.length;
    if (!total) return;
    progressFill.style.width = ((quizState.step / total) * 100) + "%";
    const label = $("#quiz-step-count");
    if (label) {
      label.textContent = "Step " + (quizState.step + 1) + " of " + total + " · " + ASSESSMENT_SPECS[quizState.flow[quizState.step]].label;
    }
  }

  /* ---- category picker ---- */
  const catGrid = $("#cat-grid");
  const pickerBtn = $("[data-picker-continue]");
  function syncPickerBtn() { pickerBtn.disabled = quizState.selected.length === 0; }

  catGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".cat-card");
    if (!card) return;
    const cat = card.dataset.cat;
    card.classList.toggle("selected");
    const i = quizState.selected.indexOf(cat);
    if (i >= 0) quizState.selected.splice(i, 1);
    else quizState.selected.push(cat);
    syncPickerBtn();
  });

  $("#select-all-cats").addEventListener("click", () => {
    quizState.selected = CAT_ORDER.slice();
    $$(".cat-card").forEach((c) => c.classList.add("selected"));
    syncPickerBtn();
  });

  $("[data-start-quiz]").addEventListener("click", () => {
    quizState.selected = [];
    quizState.flow = [];
    quizState.step = 0;
    quizState.answers = {};
    quizState.computed = false;
    quizState.computing = false;
    stopComputing();
    $$(".cat-card").forEach((c) => c.classList.remove("selected"));
    syncPickerBtn();
    showScreen("picker");
  });

  pickerBtn.addEventListener("click", () => {
    quizState.flow = CAT_ORDER.filter((c) => quizState.selected.indexOf(c) >= 0);
    quizState.step = 0;
    quizState.answers = {};
    renderCategory();
    renderProgress();
    showScreen("category");
  });

  /* ---- dynamic category checklist ---- */
  const catSymptoms = $("#cat-symptoms");
  const catNote = $("#cat-note");
  const catInvalid = $("#cat-invalid");

  function currentCat() { return quizState.flow[quizState.step]; }

  function catAnswer(cat) {
    if (!quizState.answers[cat]) quizState.answers[cat] = { symptoms: [], note: "" };
    return quizState.answers[cat];
  }

  function catHasContent() {
    const a = catAnswer(currentCat());
    const txt = (a.note || "").trim();
    return a.symptoms.length > 0 || txt.length > 0;
  }

  function syncCatButton() {
    const btn = $('[data-screen="category"] [data-next-step]');
    if (!btn) return;
    btn.disabled = !catHasContent();
    btn.textContent = quizState.step === quizState.flow.length - 1 ? "Submit & Generate My Matrix" : "Continue";
  }

  function renderCategory() {
    const cat = currentCat();
    const spec = ASSESSMENT_SPECS[cat];
    const a = catAnswer(cat);
    $("#cat-badge").textContent = spec.tag;
    $("#cat-title").textContent = spec.tag;
    catInvalid.hidden = true;
    catSymptoms.innerHTML = "";
    spec.symptoms.forEach((sym) => {
      const l = document.createElement("label");
      l.className = "check-row";
      const c = document.createElement("input");
      c.type = "checkbox";
      c.className = "cbox";
      c.value = sym;
      c.checked = a.symptoms.indexOf(sym) >= 0;
      const s = document.createElement("span");
      s.textContent = sym;
      l.appendChild(c);
      l.appendChild(s);
      catSymptoms.appendChild(l);
    });
    catNote.value = a.note || "";
    catNote.placeholder = spec.notePlaceholder;
    syncCatButton();
  }

  catSymptoms.addEventListener("change", (e) => {
    const box = e.target.closest("input.cbox");
    if (!box) return;
    const a = catAnswer(currentCat());
    const i = a.symptoms.indexOf(box.value);
    if (box.checked && i < 0) a.symptoms.push(box.value);
    if (!box.checked && i >= 0) a.symptoms.splice(i, 1);
    catInvalid.hidden = true;
    syncCatButton();
  });

  catNote.addEventListener("input", () => {
    catAnswer(currentCat()).note = catNote.value;
    catInvalid.hidden = true;
    syncCatButton();
  });

  /* ---- nav: back / continue ---- */
  document.addEventListener("click", (e) => {
    const prev = e.target.closest("[data-prev-step]");
    const next = e.target.closest("[data-next-step]");
    if (prev) {
      if (currentScreenName() === "picker") { showScreen("intro"); return; }
      if (quizState.step === 0) { showScreen("picker"); return; }
      quizState.step--;
      renderCategory();
      renderProgress();
    } else if (next && currentScreenName() === "category") {
      if (!catHasContent()) { catInvalid.hidden = false; return; }
      if (quizState.step === quizState.flow.length - 1) {
        submitQuiz();
      } else {
        quizState.step++;
        renderCategory();
        renderProgress();
      }
    }
  });

  /* ---- compute + submit ---- */
  let computeTick = null;
  let computeTimeout = null;
  function stopComputing() {
    if (computeTick != null) { clearInterval(computeTick); computeTick = null; }
    if (computeTimeout != null) { clearTimeout(computeTimeout); computeTimeout = null; }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function computePillars() {
    const p = {};
    quizState.flow.forEach((cat) => {
      const a = quizState.answers[cat];
      if (!a) return;
      const spec = ASSESSMENT_SPECS[cat];
      let s = (a.symptoms.length / spec.symptoms.length) * 100;
      if (a.note && a.note.trim()) s = Math.min(100, s + 8);
      p[cat] = Math.round(s);
    });
    return p;
  }

  function submitQuiz() {
    if (quizState.computing) return;
    quizState.computing = true;
    quizState.computed = true;
    showScreen("computing");
    const statusEl = $("#compute-status");
    const statuses = [
      "Mapping your selected areas…",
      "Tracing cortisol & stress load…",
      "Checking nocturnal testosterone window…",
      "Assembling your domino chain…"
    ];
    let i = 0;
    computeTick = setInterval(() => {
      i++;
      if (i < statuses.length) statusEl.textContent = statuses[i];
    }, 700);
    computeTimeout = setTimeout(() => {
      stopComputing();
      quizState.computing = false;
      renderResults();
      location.hash = "#/results";
    }, 3000);
  }

  $("[data-restart-quiz]").addEventListener("click", () => {
    quizState.computed = false;
    quizState.computing = false;
    stopComputing();
    showScreen("intro");
    location.hash = "#/diagnostic";
  });

  /* results CTA — book a ₹99 consult covering every assessed pillar */
  $("#results-consult").addEventListener("click", () => {
    openConsult(quizState.flow.length ? quizState.flow : ["sexual"]);
  });

  /* ── Domino Graph + Clinical Summary ─────── */
  function describe(level) {
    if (level < 34) return { tag: "stable", copy: "in a stable range — this pillar is currently protecting your recovery." };
    if (level < 67) return { tag: "strained", copy: "under strain — it is eroding your recovery faster than you feel day-to-day." };
    return { tag: "critical", copy: "critically overloaded — this is a dominant force in your symptom chain right now." };
  }

  function renderResults() {
    const p = computePillars();
    const order = ["gut", "mind", "sleep", "sexual"];
    const is = (k) => p[k] != null;

    /* pillar bars — unassessed hidden entirely */
    order.forEach((k) => {
      const bar = $('.pbar[data-pillar="' + k + '"]');
      if (!bar) return;
      bar.hidden = !is(k);
      if (!is(k)) return;
      const fill = $(".pbar-fill.pf-" + k, bar);
      const val = $("#pval-" + k);
      val.textContent = p[k];
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = p[k] + "%"; }));
    });

    /* graph — reset, hide unassessed nodes/edges */
    const nodePillar = {
      gut: "gut", serotonin: "gut",
      stress: "mind", cortisol: "mind",
      testosterone: "sleep", "sexual-dysfunction": "sexual"
    };
    $$(".graph-node").forEach((n) => {
      n.classList.remove("lit", "hot");
      n.style.display = is(nodePillar[n.dataset.node]) ? "" : "none";
    });
    $$(".edge").forEach((e) => e.classList.remove("lit"));

    /* solo-pillar runs — center the lone node in the frame (the fixed
       map layout would strand it at a corner or bottom edge) */
    const solo = quizState.flow.length === 1;
    $("#domino-graph").classList.toggle("map-solo", solo);
    const soloNote = $("#map-solo-note");
    if (soloNote) soloNote.hidden = !solo;

    const g = is("gut"), m = is("mind"), sl = is("sleep"), sx = is("sexual");
    [
      { sel: ".e-gut-ser", on: g },
      { sel: ".e-ser-t", on: g && sl },
      { sel: ".e-stress-cort", on: m },
      { sel: ".e-cort-t", on: m && sl },
      { sel: ".e-t-sd", on: sl && sx }
    ].forEach((ed) => {
      const el = $(ed.sel);
      if (el) el.style.display = ed.on ? "" : "none";
    });

    const hotOnes = order.filter((k) => is(k) && p[k] >= 50);
    const seq = [];
    if (g) seq.push(".gn-gut", ".e-gut-ser", ".gn-ser");
    if (m) seq.push(".gn-stress", ".e-stress-cort", ".gn-cort");
    if (g && sl) seq.push(".e-ser-t");
    if (m && sl) seq.push(".e-cort-t");
    if (sl) seq.push(".gn-t");
    if (sl && sx) seq.push(".e-t-sd");
    if (sx) seq.push(".gn-sd");

    let delay = 0;
    seq.forEach((sel) => {
      setTimeout(() => {
        const el = $(sel);
        if (!el) return;
        if (el.classList.contains("edge")) {
          el.classList.add("lit");
        } else {
          el.classList.add("lit");
          if (el.classList.contains("gn-t") && hotOnes.some((k) => k !== "sexual")) el.classList.add("hot");
          if (el.classList.contains("gn-sd") && sx) el.classList.add("hot");
          if (hotOnes.indexOf(nodePillar[el.dataset.node]) >= 0) el.classList.add("hot");
        }
      }, delay);
      delay += 420;
    });

    /* clinical summary — only assessed pillars */
    const hl = $("#summary-headline");
    const box = $("#summary-text");
    const names = { gut: "Gut", mind: "Emotional", sleep: "Sleep", sexual: "Sexual" };
    const topPillars = order.filter((k) => is(k) && p[k] >= 34).sort((a, b) => p[b] - p[a]);
    let html = "";
    let headline = "Your root-cause reading";

    if (topPillars.length === 0) {
      headline = "Your system is holding";
      const list = quizState.flow.map((c) => names[c]).join(", ");
      html = "<p>" + list + " — " + (quizState.flow.length === 1 ? "your assessed area is" : "your assessed areas are") +
        " in a stable range. Your body's recovery systems are largely intact — the strongest starting point for optimisation.</p>" +
        "<p>Our squad would still map your mild strain points and design a protocol to keep every domino standing.</p>";
    } else {
      headline = "Your chain starts at " + names[topPillars[0]];
      const chainCopy = {
        gut: "Gut dysbiosis is suppressing your serotonin pool — the same signalling network that steers mood <em>and</em> nocturnal hormone production.",
        mind: "Elevated cortisol from unmanaged stress is telling your body to postpone repair work — including the overnight testosterone build.",
        sleep: "Fragmented sleep is closing the nocturnal testosterone window — most of your daily T is produced in deep, uninterrupted sleep.",
        sexual: "Performance pressure is compounding the physiology: anxiety spikes cortisol further, which loops straight back into the chain."
      };
      topPillars.slice(0, 2).forEach((k) => {
        const d = describe(p[k]);
        html += "<p><strong class='sum-link' style='text-transform:capitalize'>" + names[k] + "</strong>: " + d.copy + " " + chainCopy[k] + "</p>";
      });
      if (topPillars.length >= 2) {
        html += "<p>When <span class='sum-link'>" + names[topPillars[0]] + "</span> and <span class='sum-link'>" + names[topPillars[1]] + "</span> combine, nocturnal testosterone gets suppressed — which is exactly how a gut or stress problem <em>becomes</em> a sexual health problem.</p>";
      }
      html += "<p>This is not a verdict — it's a <span class='sum-link'>map</span>. Your squad protocol reverses the chain in the same order it fell.</p>";
    }
    const missing = CAT_ORDER.filter((c) => quizState.flow.indexOf(c) < 0).map((c) => names[c]);
    if (missing.length) {
      html += "<p class='sum-muted'>You assessed " + quizState.flow.length + " of 4 areas (" + missing.join(", ") +
        " not covered). The full map completes when you add the rest — retake the assessment anytime.</p>";
    }
    hl.textContent = headline;
    box.innerHTML = html;
  }

  /* ── Home quadrant hover linking ─────────── */
  const quadGrid = $("#quad-grid");
  const quadCaption = $("#quad-caption");
  const captions = {
    gut: "Gut dysbiosis drops serotonin → mood, sleep architecture, and nocturnal testosterone are all downstream of one root.",
    mind: "Chronic stress raises cortisol → the body postpones deep sleep and testosterone production — the gut slows as a side effect.",
    sleep: "Fragmented sleep closes the testosterone window → low drive compounds anxiety, which further disrupts sleep. A loop.",
    sexual: "Performance pressure spikes cortisol → which suppresses the same hormones that drive desire and stamina."
  };
  quadGrid.addEventListener("mouseover", (e) => {
    const card = e.target.closest(".quad-card");
    if (!card) return;
    const pillar = card.dataset.pillar;
    const links = (card.dataset.connections || "").split(",");
    $$(".quad-card").forEach((c) => {
      const linked = c === card || links.includes(c.dataset.pillar);
      c.classList.toggle("linked", linked && c !== card);
      c.classList.toggle("dimmed", !linked);
    });
    quadCaption.textContent = captions[pillar];
  });
  quadGrid.addEventListener("mouseleave", () => {
    $$(".quad-card").forEach((c) => c.classList.remove("linked", "dimmed"));
    quadCaption.textContent = captions.gut;
  });

  function fmt(n) { return Number(n).toLocaleString("en-IN"); }

  /* ── Payment: backend-managed (Razorpay) with UPI-QR fallback ──
     Mode is detected at boot (detectBackend):
     · ""        — unknown until the health probe settles; the pay
                   button refuses clicks during this window so a
                   booking can never slip through in the wrong mode.
     · razorpay  — the patient pays inside the Razorpay hosted checkout;
                   the server verifies the signature before anything moves
                   forward. There is NO "I've paid" tap — an unpaid payment
                   can never reach the confirmation step.
     · qr        — no gateway keys / offline: patient scans the UPI QR
                   (money lands in the UPI VPA below); a manual confirm is
                   unavoidable because nobody can verify it server-side.
     · demo      — test mode (window.__OJAS_TEST__): instant fake pay. */
  let payMode = "";
  let paymentVerified = false;
  let confirmedBookingId = "";
  const API_BASE = location.protocol === "file:" ? "http://localhost:8787" : "";

  async function detectBackend() {
    if (window.__OJAS_TEST__ === true) { payMode = "demo"; return; }
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(API_BASE + "/api/health", { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error("health " + r.status);
      const h = await r.json();
      payMode = h.razorpay ? "razorpay" : "qr";
    } catch (e) {
      payMode = "qr";
    }
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      const to = setTimeout(() => { s.remove(); rej(new Error("Razorpay checkout could not be loaded (check internet)")); }, 8000);
      s.onload = () => { clearTimeout(to); res(window.Razorpay); };
      s.onerror = () => { clearTimeout(to); s.remove(); rej(new Error("Razorpay checkout could not be loaded (check internet)")); };
      document.head.appendChild(s);
    });
  }

  async function postJson(path, body) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    } finally {
      clearTimeout(to);
    }
  }

  /* ── QR fallback flow (no gateway configured) ── */
  const QR_UPI = "7042347171@hdfc";
  let qrOnContinue = null;

  function showQrPay(rupees, label) {
    const m = $("#qr-modal");
    if (!m) return;
    $("#qr-amount").textContent = "₹" + fmt(rupees);
    $("#qr-label").textContent = label;
    $("#qr-upi").textContent = QR_UPI;
    const uri = "upi://pay?pa=" + encodeURIComponent(QR_UPI) +
      "&pn=OJAS&am=" + rupees + "&cu=INR&tn=" + encodeURIComponent(label.slice(0, 60));
    const img = $("#qr-img");
    img.onerror = () => {
      /* third-party QR service unreachable — degrade to the deep link */
      const link = $("#qr-deeplink");
      if (link) {
        const a = link.querySelector("a");
        a.href = uri;
        link.hidden = false;
        img.hidden = true;
      }
    };
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + encodeURIComponent(uri);
    $("#qr-copy").textContent = "Copy UPI ID";
    $("#qr-copy").disabled = false;
    m.classList.add("show");
    m.setAttribute("aria-hidden", "false");
  }
  function closeQr() {
    const m = $("#qr-modal");
    if (m) { m.classList.remove("show"); m.setAttribute("aria-hidden", "true"); }
    qrOnContinue = null;
  }
  $("#qr-close").addEventListener("click", closeQr);
  $("#qr-modal").addEventListener("click", (e) => { if (e.target === $("#qr-modal")) closeQr(); });
  $("#qr-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(QR_UPI); $("#qr-copy").textContent = "Copied!"; }
    catch (e) { $("#qr-copy").textContent = "Copy not supported on this device"; }
    setTimeout(() => { $("#qr-copy").textContent = "Copy UPI ID"; }, 2000);
  });
  $("#qr-confirm").addEventListener("click", () => {
    const cb = qrOnContinue;
    closeQr();
    if (cb) cb();
  });

  /* ── Init ────────────────────────────────── */
  const prefs = { consent: localStorage.getItem("ojas-consent") };
  /* a fresh load carries no quiz state — drop any stale hash so a
     refresh lands on home instead of a dead screen */
  if (location.hash) history.replaceState(null, "", "#/");
  navigate();
  detectBackend();

  /* consent gates the app on first visit */
  if (!prefs.consent) {
    setTimeout(consentOpen, 600);
  }

  /* ═══════════════ ₹99 CONSULT BOOKING ═══════════════ */
  const CONSULT_FEE = 99;
  const pillarNames = { gut: "Gut Health", mind: "Emotional Health", sleep: "Sleep Health", sexual: "Sexual Health" };

  /* per-pillar consult questions (from ojas_consultation_form_spec) */
  const CONSULT_SPECS = {
    sexual: {
      tag: "SEXUAL HEALTH CONSULT",
      label: "Your concern",
      options: [
        "ED — Erectile Dysfunction",
        "PME — Premature Ejaculation",
        "Low Libido / Low Sex Drive",
        "Performance Anxiety",
        "Other concern"
      ],
      placeholder: "e.g. Performance anxiety, low energy, work stress"
    },
    gut: {
      tag: "GUT HEALTH CONSULT",
      label: "Your digestive concern",
      options: [
        "Bloating or frequent gas",
        "Irregular bowel movements",
        "Acidity, heartburn, or GERD",
        "Low energy or fatigue after meals",
        "Other digestive concern"
      ],
      placeholder: "e.g. Food intolerances, IBS symptoms, chronic acidity"
    },
    emotional: {
      tag: "EMOTIONAL WELL-BEING CONSULT",
      label: "Your emotional well-being concern",
      options: [
        "Chronic stress or inability to relax",
        "Persistent anxiety or racing thoughts",
        "Burnout or feeling constantly overwhelmed",
        "Irritability or mood fluctuations",
        "Other emotional concern"
      ],
      placeholder: "e.g. Work pressure, relationship strain, lack of focus"
    },
    sleep: {
      tag: "SLEEP IMPROVEMENT CONSULT",
      label: "Your sleep concern",
      options: [
        "Difficulty falling asleep (Insomnia)",
        "Frequent night wake-ups (Fragmented sleep)",
        "Waking up unrefreshed or tired",
        "Irregular sleep schedule or shift work",
        "Other sleep concern"
      ],
      placeholder: "e.g. Snoring, late-night screen time, restless sleep"
    }
  };
  /* card data-consult values: mind → emotional spec */
  const PILLAR_TO_SPEC = { gut: "gut", mind: "emotional", sleep: "sleep", sexual: "sexual" };

  const consultModal = $("#consult-modal");
  const consultSteps = $$(".consult-step", consultModal);

/* ── CONFIG ─────────────────────────────
     smsWebhook : optional endpoint (Msg91/Twilio proxy) for SMS delivery
                  previews. When blank, the flow previews every message
                  locally. Payments + WhatsApp profile delivery run through
                  the backend (server/server.mjs) — see .env. */
  const CONSULT_LIVE = {
    smsWebhook: ""
  };

  let consultCtx = null;

  /* open from any element carrying data-consult */
  $$("[data-consult]").forEach((card) => {
    card.addEventListener("click", () => openConsult(card.dataset.consult));
  });
  $("#consult-close").addEventListener("click", closeConsult);
  consultModal.addEventListener("click", (e) => { if (e.target === consultModal) closeConsult(); });

  function openConsult(pillars) {
    /* a fresh booking session — never inherit "paid", a confirmed ref or
       the previous slot from an earlier consult in the same visit */
    paymentVerified = false;
    confirmedBookingId = "";
    selectedSlot = null;
    slotSaving = false;
    qrOnContinue = null;
    resetPayBtn();
    const perr = $("#pay-err");
    if (perr) perr.hidden = true;
    const list = (Array.isArray(pillars) ? pillars : [pillars]).filter(Boolean);
    const specs = list.map((p) => CONSULT_SPECS[PILLAR_TO_SPEC[p]] || CONSULT_SPECS.sexual);
    consultCtx = { pillar: list.length === 1 ? list[0] : "multi" };
    const multi = list.length > 1;
    const label = multi ? "FULL WELLNESS CONSULT · " + list.length + " AREAS" : specs[0].tag;
    $("#consult-pillar-tag").textContent = label;
    $("#consult-pay-tag").textContent = label;
    $("#c-problem-label").textContent = multi ? "Your concerns (one per area)" : specs[0].label;
    $("#c-problem").innerHTML = "";
    specs.forEach((spec, i) => {
      const group = document.createElement("div");
      if (multi) {
        const h = document.createElement("h4");
        h.className = "c-group-title";
        h.textContent = pillarNames[list[i]] || specs[i].tag;
        group.appendChild(h);
      }
      spec.options.forEach((opt) => {
        const l = document.createElement("label");
        l.className = "check-row";
        const c = document.createElement("input");
        c.type = "checkbox";
        c.className = "cbox";
        c.value = opt.indexOf("Other") === 0 ? "Other" : opt;
        const s = document.createElement("span");
        s.textContent = opt;
        l.appendChild(c);
        l.appendChild(s);
        group.appendChild(l);
      });
      /* one free-text field per group, revealed only when that group's
         own "Other" box is checked (multi-pillar forms have several) */
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "c-other-input";
      otherInput.placeholder = spec.placeholder;
      otherInput.autocomplete = "off";
      otherInput.hidden = true;
      group.appendChild(otherInput);
      $("#c-problem").appendChild(group);
    });
    $("#c-name").value = ""; $("#c-age").value = ""; $("#c-phone").value = "";
    $("#c-profession").value = ""; $("#c-city").value = "";
    $$("#c-problem .cbox").forEach((b) => { b.checked = false; });
    $("#c-other").value = "";
    $("#c-other-field").hidden = true;
    $$("#c-duration .seg").forEach((b) => b.classList.remove("active"));
    $("#consult-err").hidden = true;
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "details"));
    consultModal.classList.add("show");
    consultModal.setAttribute("aria-hidden", "false");
  }

  function closeConsult() {
    consultModal.classList.remove("show");
    consultModal.setAttribute("aria-hidden", "true");
  }

  /* problem checkboxes (+ "Other" free-text) & duration
     single-select — delegated, because the options are rendered
     per-pillar inside openConsult */
  consultModal.addEventListener("change", (e) => {
    const box = e.target.closest("#c-problem .cbox");
    if (!box) return;
    if (box.value !== "Other") return;
    const input = box.closest(".check-row").nextElementSibling;
    if (!input || !input.classList.contains("c-other-input")) return;
    input.hidden = !box.checked;
    if (box.checked) input.focus();
  });
  $$("#c-duration .seg").forEach((b) => b.addEventListener("click", () => {
    $$("#c-duration .seg").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  }));

  /* details → payment */
  $("#consult-to-pay").addEventListener("click", () => {
    try {
    const name = $("#c-name").value.trim();
    const age = $("#c-age").value.trim();
    const phone = $("#c-phone").value.trim();
    const profession = $("#c-profession").value.trim();
    const city = $("#c-city").value.trim();
    const concernBoxes = $$("#c-problem .cbox");
    const selected = concernBoxes.filter((b) => b.checked);
    const err = $("#consult-err");

    if (!name || !age || !phone || !profession || !city || selected.length === 0) {
      err.textContent = "Please fill all fields and select at least one concern.";
      err.hidden = false;
      return;
    }
    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      err.textContent = "Enter a valid 10-digit Indian mobile number.";
      err.hidden = false;
      return;
    }
    const n = Number(age);
    if (!Number.isInteger(n) || n < 18 || n > 99) {
      err.textContent = "Age must be between 18 and 99.";
      err.hidden = false;
      return;
    }
    const durBtn = $(".seg.active", $("#c-duration"));
    if (!durBtn) {
      err.textContent = "Please select how long this has been bothering you.";
      err.hidden = false;
      return;
    }
    /* each pillar group keeps its own "Other" text — build the concern
       list group by group so no free text leaks across groups */
    const concernParts = [];
    let missingOtherText = false;
    $$("#c-problem > div").forEach((g) => {
      const boxes = $$(".cbox", g).filter((b) => b.checked);
      boxes.filter((b) => b.value !== "Other").forEach((b) => concernParts.push(b.value));
      if (boxes.some((b) => b.value === "Other")) {
        const inp = g.querySelector(".c-other-input");
        const txt = (inp && inp.value || "").trim();
        if (!txt) missingOtherText = true;
        else concernParts.push(txt);
      }
    });
    if (missingOtherText) {
      err.textContent = "Please tell us your concern in a few words.";
      err.hidden = false;
      return;
    }
    err.hidden = true;

    consultCtx = Object.assign(consultCtx, {
      name, age: n, phone, profession, city,
      concern: concernParts.join(", "),
      duration: durBtn.dataset.v
    });
    $("#consult-summary-line").textContent =
      consultCtx.name + " · " + consultCtx.age + " yrs · " + consultCtx.city + " · " + consultCtx.concern + " (" + consultCtx.duration + ")";
    $("#consult-amount").textContent = "₹" + CONSULT_FEE;
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "payment"));
    document.querySelectorAll('iframe[src*="checkout.razorpay.com"]').forEach((f) => { (f.parentElement || f).remove(); });
    } catch (e) {
      console.error(e);
    }
  });

  /* payment → verified checkout (razorpay) / scan-pay QR (fallback) / demo */
  const payBtn = $("#consult-pay-btn");
  let payInFlight = false;
  let verifyInFlight = false;
  function resetPayBtn() {
    payInFlight = false;
    payBtn.disabled = false;
    payBtn.innerHTML = "<span>Pay ₹" + CONSULT_FEE + " &amp; confirm</span>";
  }
  function payErr(msg) {
    const el = $("#pay-err");
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  payBtn.addEventListener("click", async () => {
    if (payInFlight) return;
    payErr("");

    if (!payMode) {
      payErr("Payment mode is still being verified — please try again in a moment.");
      detectBackend();
      return;
    }

    if (payMode === "demo") {
      payInFlight = true;
      payBtn.disabled = true;
      payBtn.innerHTML = "<span>Processing payment…</span>";
      setTimeout(() => { paymentVerified = true; resetPayBtn(); afterPayment(); }, 1200);
      return;
    }

    if (payMode === "razorpay") {
      payInFlight = true;
      payBtn.disabled = true;
      payBtn.innerHTML = "<span>Starting secure payment…</span>";
      const c = consultCtx;
      try {
        const order = await postJson("/api/order-create", {
          kind: "consult",
          amount: CONSULT_FEE * 100,
          notes: {
            name: c.name, phone: c.phone, city: c.city,
            detail: (c.pillar === "multi" ? "Full wellness" : pillarNames[c.pillar]) + " consult", concern: c.concern
          }
        });
        const Rz = await loadRazorpay();
        const rzp = new Rz({
          key: order.key,
          order_id: order.orderId,
          amount: order.amount,
          currency: "INR",
          name: "OJAS",
          description: (c.pillar === "multi" ? "Full wellness" : pillarNames[c.pillar]) + " Consult",
          prefill: { name: c.name, contact: "+91" + c.phone },
          theme: { color: "#d4af37" },
          handler: async (resp) => {
            if (verifyInFlight) return;
            verifyInFlight = true;
            const payload = {
              kind: "consult",
              orderId: resp.razorpay_order_id,
              paymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
              booking: {
                name: c.name, age: c.age, phone: c.phone, city: c.city,
                profession: c.profession, concern: c.concern, duration: c.duration, pillar: c.pillar === "multi" ? "Full wellness" : pillarNames[c.pillar]
              }
            };
            try {
              /* one safe retry for transient gateway hiccups — the server
                 is idempotent: an already-verified payment is never logged
                 twice, so a retry can never double-book */
              let v = null;
              for (let attempt = 0; attempt < 2; attempt++) {
                try { v = await postJson("/api/verify", payload); break; }
                catch (e) { if (attempt === 0) await sleep(1500); else throw e; }
              }
              paymentVerified = true;
              confirmedBookingId = v.bookingId || "";
              afterPayment();
              resetPayBtn();
            } catch (err) {
              console.error(err);
              /* do NOT re-enable the pay button here — the capture may
                 already have settled and a second charge would double-bill */
              payErr("Payment received but verification is pending (" + err.message + "). Nothing has been logged yet — close this window and try the payment again in a moment; if you were charged, the clinic will confirm manually.");
            } finally {
              verifyInFlight = false;
            }
          },
          modal: { ondismiss: () => { if (!verifyInFlight) resetPayBtn(); } }
        });
        rzp.on("payment.failed", (resp) => {
          payErr("Payment failed: " + ((resp.error && (resp.error.code || resp.error.description)) || "try again") + ". No amount was charged.");
          resetPayBtn();
        });
        document.querySelectorAll('iframe[src*="checkout.razorpay.com"]').forEach((f) => { (f.parentElement || f).remove(); });
        rzp.open();
        setTimeout(() => {
          document.querySelectorAll('iframe[src*="checkout.razorpay.com"]').forEach((f) => {
            let p = f.parentElement;
            while (p && p !== document.body) {
              const cs = window.getComputedStyle(p);
              if (cs.position === "fixed" || cs.position === "absolute") break;
              p = p.parentElement;
            }
            if (p && p.style) p.style.zIndex = "9990";
          });
        }, 800);
      } catch (err) {
        console.error(err);
        payErr("Payment could not be started: " + err.message);
        resetPayBtn();
      }
      return;
    }

    /* qr fallback — patient scans, pays, confirms manually (unverified) */
    qrOnContinue = () => { afterPayment(); };
    showQrPay(CONSULT_FEE, "OJAS Consult");
  });

  function afterPayment() {
    resetPayBtn();
    renderSlots();
    const title = $("#consult-timeslot-title");
    if (title) title.textContent = paymentVerified
      ? "Payment received — consultation confirmed"
      : "Slot request sent — payment verification pending";
    const sub = $("#consult-sub-line");
    if (sub) sub.innerHTML = paymentVerified
      ? "Your doctor's call is booked for <strong class=\"gold\">" + dateLabel() + "</strong>. Pick a time below."
      : "Once your payment clears, we'll confirm your call for <strong class=\"gold\">" + dateLabel() + "</strong>. Pick a preferred time below.";
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "timeslot"));
  }

  /* tomorrow's slots */
  function consultDate() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }
  const dateLabel = () => consultDate().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const SLOTS = ["10:00 AM", "11:00 AM", "12:00 PM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM"];

  let selectedSlot = null;
  function renderSlots() {
    $("#consult-confirm-slot").disabled = true;
    $("#slot-err").hidden = true;
    $("#consult-date").textContent = dateLabel();
    const taken = consultationsTaken().reduce((acc, b) => (acc[b.slot] = true, acc), {});
    /* server-side slot registry (razorpay mode) — merged with the local
       record; any failure falls back to local data only */
    if (payMode === "razorpay") {
      fetch(API_BASE + "/api/slots?date=" + encodeURIComponent(dateLabel()))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
        .then((occ) => { if (Array.isArray(occ)) { occ.forEach((s) => (taken[s] = true)); paintSlots(taken); } });
    }
    paintSlots(taken);
  }

  function paintSlots(taken) {
    const grid = $("#consult-slots");
    const prev = selectedSlot;
    const keeping = prev && !taken[prev];
    if (!keeping) { selectedSlot = null; $("#consult-confirm-slot").disabled = true; }
    grid.innerHTML = "";
    SLOTS.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-btn" + (taken[t] ? " is-taken" : "");
      b.textContent = t;
      b.disabled = !!taken[t];
      if (keeping && t === prev) b.classList.add("active");
      b.addEventListener("click", () => {
        $$(".slot-btn", grid).forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        selectedSlot = t;
        $("#consult-confirm-slot").disabled = false;
      });
      grid.appendChild(b);
    });
  }

  /* persistence (clinic-side record) + taken tracking */
  const STORE_KEY = "ojas-consultations";
  function consultationsAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; }
  }
  function consultationsTaken() {
    const day = dateLabel();
    return consultationsAll().filter((b) => b.date === day);
  }
  function newBookingId() {
    return "OJ-" + Date.now().toString().slice(-6);
  }
  function saveConsultation() {
    const id = newBookingId();
    const list = consultationsAll();
    list.push({
      id: id,
      bookedOn: new Date().toLocaleDateString("en-IN"),
      date: dateLabel(),
      slot: selectedSlot,
      fields: Object.assign({}, consultCtx)
    });
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    return id;
  }

  /* the messages that get delivered */
  function deliverMessages() {
    const c = consultCtx;
    const paid = paymentVerified ? "Fee ₹" + CONSULT_FEE + " PAID" : "Fee ₹" + CONSULT_FEE + " — payment pending verification";
    const status = paymentVerified ? "CONFIRMED" : "REQUESTED (pending payment verification)";
    return [
      { to: "Patient (" + c.phone + ")", body: "OJAS — your ₹" + CONSULT_FEE + " consultation is " + status + ". Call on " + dateLabel() + " at " + selectedSlot + ". A reminder will follow tomorrow. OJAS Care" },
      { to: "Care team", body: "NEW OJAS CONSULT — " + c.name + " · " + c.age + " yrs · " + c.city + " · " + c.profession + " · Concern: " + c.concern + " (" + c.duration + ") · Phone +91 " + c.phone + " · " + paid + " · Call on " + dateLabel() + "." },
      { to: "Care team", body: "Time chosen by " + c.name + " for " + dateLabel() + ": " + selectedSlot + "." }
    ];
  }

  function pushSmsWebhook() {
    if (CONSULT_LIVE.smsWebhook) {
      fetch(CONSULT_LIVE.smsWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: consultCtx.phone, messages: deliverMessages() })
      }).catch(() => {});
    }
  }

  /* confirm → save + preview + finish (payment already verified) */
  let slotSaving = false;
  $("#consult-confirm-slot").addEventListener("click", async () => {
    if (slotSaving) return;
    if (!selectedSlot) { $("#slot-err").hidden = false; return; }
    slotSaving = true;
    $("#consult-confirm-slot").disabled = true;
    const id = saveConsultation();
    const refEl = $("#consult-ref");
    if (refEl) refEl.textContent = id;
    const slotEl = $("#consult-slot");
    if (slotEl) slotEl.textContent = dateLabel() + " · " + selectedSlot;
    pushSmsWebhook();
    const c = consultCtx;
    let waResult = [];
    if (confirmedBookingId) {
      try {
        const r = await postJson("/api/booking-time", {
          bookingRef: confirmedBookingId,
          date: dateLabel(),
          slot: selectedSlot,
          booking: { name: c.name, age: c.age, phone: c.phone, city: c.city, concern: c.concern, duration: c.duration }
        });
        waResult = r.wa || [];
      } catch (err) { waResult = ["clinic-failed: " + err.message]; }
    }
    const doneSub = $("#consult-done-sub");
    if (doneSub) doneSub.textContent = paymentVerified
      ? "Confirmation sent to your phone and your care team. Show-up reminders have also been booked."
      : "Your slot request is logged. Payment verification is pending — the care team will confirm once it clears.";
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "done"));
  });

  $("#consult-done").addEventListener("click", closeConsult);
})();
