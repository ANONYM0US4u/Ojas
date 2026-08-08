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
    "programs": "programs",
    "checkout": "checkout",
    "panel":   "panel"
  };

  const pages = $$(".page");
  const navLinks = $$("[data-nav]");

  function navigate() {
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
    if (pageName === "results" && !quizState.computed) {
      location.hash = "#/diagnostic";
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
  const quizState = { step: 0, answers: {}, computed: false };
  const stepOrder = ["gut", "mind", "sleep", "sexual"];
  const screens = $$(".quiz-screen");
  const progress = $("#quiz-progress");
  const progressFill = $("#quiz-progress-fill");
  const stepDots = $$(".qstep");

  function showScreen(name) {
    screens.forEach((s) => (s.hidden = s.dataset.screen !== name));
    if (name === "intro" || name === "computing") progress.hidden = true;
    else progress.hidden = false;
  }

  function renderProgress() {
    const pct = ((quizState.step) / stepOrder.length) * 100;
    progressFill.style.width = pct + "%";
    stepDots.forEach((d, i) => {
      const s = d.classList.contains("qs-gut") ? "gut" : d.classList.contains("qs-mind") ? "mind" : d.classList.contains("qs-sleep") ? "sleep" : "sexual";
      d.classList.toggle("on", stepOrder.indexOf(s) <= quizState.step);
    });
  }

  function syncStepButtons() {
    const screen = stepOrder[quizState.step];
    const screenEl = $('.quiz-screen[data-screen="' + screen + '"]');
    if (!screenEl) return;
    const groups = $$(".seg-group", screenEl);
    let complete = true;
    groups.forEach((g) => { if (!g.dataset.selection) complete = false; });
    const nextBtn = $("[data-next-step]", screenEl);
    if (nextBtn) nextBtn.disabled = !complete;
  }

  /* segmented buttons */
  $$(".seg-group").forEach((group) => {
    const key = group.dataset.q;
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg");
      if (!btn) return;
      $$(".seg", group).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      group.dataset.selection = btn.dataset.v;
      quizState.answers[key] = Number(btn.dataset.v);
      syncStepButtons();
    });
  });

  /* sliders */
  $$('input[type="range"].slider').forEach((slider) => {
    const valEl = $('[data-val-for="' + slider.dataset.q + '"]');
    const update = () => {
      quizState.answers[slider.dataset.q] = Number(slider.value);
      if (valEl) valEl.textContent = slider.value;
    };
    slider.addEventListener("input", update);
    update();
  });

  $("[data-start-quiz]").addEventListener("click", () => {
    quizState.step = 0;
    quizState.computed = false;
    showScreen(stepOrder[0]);
    renderProgress();
    syncStepButtons();
  });

  /* Delegate prev/next — every step screen has its own buttons */
  document.addEventListener("click", (e) => {
    const prev = e.target.closest("[data-prev-step]");
    const next = e.target.closest("[data-next-step]");
    if (prev) {
      if (quizState.step === 0) { showScreen("intro"); return; }
      quizState.step--;
      showScreen(stepOrder[quizState.step]);
      renderProgress();
      syncStepButtons();
    } else if (next) {
      if (quizState.step < stepOrder.length - 1) {
        quizState.step++;
        showScreen(stepOrder[quizState.step]);
        renderProgress();
      }
    }
  });

  /* ── Compute results ─────────────────────── */
  function segScore(groupKey) { return quizState.answers[groupKey] != null ? Number(quizState.answers[groupKey]) : 0; }

  function computePillars() {
    const gut = ((segScore("gut-acidity") + segScore("gut-bloating") + segScore("gut-digestion")) / 9) * 100;
    const mind = ((quizState.answers["mind-burnout"] || 5) + (quizState.answers["mind-stress"] || 5) + (quizState.answers["mind-irritability"] || 5) - 3) / 27 * 100;
    const sleep = ((segScore("sleep-duration") + segScore("sleep-interruptions") + segScore("sleep-fatigue")) / 9) * 100;
    const sexual = ((segScore("sexual-anxiety") + segScore("sexual-stamina") + segScore("sexual-morning")) / 9) * 100;
    return { gut: Math.round(gut), mind: Math.round(mind), sleep: Math.round(sleep), sexual: Math.round(sexual) };
  }

  function describe(level) {
    if (level < 34) return { tag: "stable", copy: "in a stable range — this pillar is currently protecting your recovery." };
    if (level < 67) return { tag: "strained", copy: "under strain — it is eroding your recovery faster than you feel day-to-day." };
    return { tag: "critical", copy: "critically overloaded — this is a dominant force in your symptom chain right now." };
  }

  $("[data-submit-quiz]").addEventListener("click", () => {
    quizState.computed = true;
    showScreen("computing");
    const statusEl = $("#compute-status");
    const statuses = [
      "Mapping gut → serotonin pool…",
      "Tracing cortisol & stress load…",
      "Checking nocturnal testosterone window…",
      "Assembling your domino chain…"
    ];
    let i = 0;
    const tick = setInterval(() => {
      i++;
      if (i < statuses.length) statusEl.textContent = statuses[i];
    }, 700);
    setTimeout(() => {
      clearInterval(tick);
      renderResults();
      location.hash = "#/results";
    }, 3000);
  });

  $("[data-restart-quiz]").addEventListener("click", () => {
    quizState.computed = false;
    $$(".seg-group").forEach((g) => { delete g.dataset.selection; });
    $$(".seg.active").forEach((b) => b.classList.remove("active"));
    showScreen("intro");
    location.hash = "#/diagnostic";
  });

  /* ── Domino Graph + Clinical Summary ─────── */
  function renderResults() {
    const p = computePillars();
    const order = ["gut", "mind", "sleep", "sexual"];
    const hot = order.filter((k) => p[k] >= 50);

    /* pillar bars */
    order.forEach((k) => {
      const fill = $(".pbar-fill.pf-" + k);
      const val = $("#pval-" + k);
      val.textContent = p[k];
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = p[k] + "%"; }));
    });

    /* reset graph */
    $$(".graph-node").forEach((n) => n.classList.remove("lit", "hot"));
    $$(".edge").forEach((e) => e.classList.remove("lit"));

    const gutHot = p.gut >= 50, stressHot = p.mind >= 50, sleepHot = p.sleep >= 50;
    const seq = [];
    if (gutHot) { seq.push(".gn-gut", ".e-gut-ser", ".gn-ser"); }
    if (stressHot) { seq.push(".gn-stress", ".e-stress-cort", ".gn-cort"); }
    seq.push(".e-ser-t", ".e-cort-t", ".gn-t", ".e-t-sd", ".gn-sd");

    let delay = 0;
    seq.forEach((sel) => {
      setTimeout(() => {
        const el = $(sel);
        if (!el) return;
        if (el.classList.contains("edge")) el.classList.add("lit");
        else {
          el.classList.add("lit");
          if (el.classList.contains("gn-t") && (gutHot || stressHot || sleepHot)) el.classList.add("hot");
          if (el.classList.contains("gn-sd")) el.classList.add("hot");
        }
      }, delay);
      delay += 420;
    });

    /* clinical summary */
    const hl = $("#summary-headline");
    const box = $("#summary-text");
    const topPillars = order.filter((k) => p[k] >= 34).sort((a, b) => p[b] - p[a]);
    let html = "";
    let headline = "Your root-cause reading";

    if (topPillars.length === 0) {
      headline = "Your system is holding";
      html = "<p>All four pillars are in a stable range. Your body's recovery systems are largely intact — this is the strongest starting point for optimisation.</p><p>Our squad would still map your <span class='sum-link'>mild strain points</span> and design a protocol to keep every domino standing.</p>";
    } else {
      headline = "Your chain starts at " + topPillars[0];
      const chainCopy = {
        gut: "Gut dysbiosis is suppressing your serotonin pool — the same signalling network that steers mood <em>and</em> nocturnal hormone production.",
        mind: "Elevated cortisol from unmanaged stress is telling your body to postpone repair work — including the overnight testosterone build.",
        sleep: "Fragmented sleep is closing the nocturnal testosterone window — most of your daily T is produced in deep, uninterrupted sleep.",
        sexual: "Performance pressure is compounding the physiology: anxiety spikes cortisol further, which loops straight back into the chain."
      };
      topPillars.slice(0, 2).forEach((k) => {
        const d = describe(p[k]);
        html += "<p><strong class='sum-link' style='text-transform:capitalize'>" + k + "</strong>: " + d.copy + " " + chainCopy[k] + "</p>";
      });
      if (topPillars.length >= 2) {
        html += "<p>When <span class='sum-link'>" + topPillars[0] + "</span> and <span class='sum-link'>" + topPillars[1] + "</span> combine, nocturnal testosterone gets suppressed — which is exactly how a gut or stress problem <em>becomes</em> a sexual health problem.</p>";
      }
      html += "<p>This is not a verdict — it's a <span class='sum-link'>map</span>. Your squad protocol reverses the chain in the same order it fell.</p>";
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

  /* ── Track tabs (pricing) ────────────────── */
  $$(".track-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const track = tab.dataset.track;
      $$(".track-tab").forEach((t) => { t.classList.toggle("active", t === tab); t.setAttribute("aria-selected", t === tab); });
      $$(".price-card").forEach((c) => { c.hidden = c.dataset.track !== track; });
    });
  });

  /* ── Plan select → checkout ──────────────── */
  $$("[data-select-plan]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sessionStorage.setItem("ojas-plan", JSON.stringify({
        name: btn.dataset.name,
        price: btn.dataset.price,
        plan: btn.dataset.plan,
        track: btn.dataset.track
      }));
      location.hash = "#/checkout";
    });
  });

  function fmt(n) { return Number(n).toLocaleString("en-IN"); }

  function hydrateCheckout() {
    let plan = null;
    try { plan = JSON.parse(sessionStorage.getItem("ojas-plan")); } catch (e) { plan = null; }
    if (!plan) {
      plan = { name: "OJAS 60-Day Complete Vitality Program", price: "13450", plan: "sleep-60", track: "sleep" };
      sessionStorage.setItem("ojas-plan", JSON.stringify(plan));
    }
    const title = $("#order-title");
    const price = $("#order-price");
    if (title) title.textContent = plan.name;
    if (price) price.textContent = "₹" + fmt(plan.price);
    $$(".pay-label").forEach((el) => { el.innerHTML = "Pay ₹<span data-pay-amount>" + fmt(plan.price) + "</span> Securely"; });
    $$("[data-pay-amount]").forEach((el) => { el.textContent = fmt(plan.price); });
  }

  /* ── Payment method tabs ─────────────────── */
  $$(".pay-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const method = tab.dataset.method;
      $$(".pay-tab").forEach((t) => t.classList.toggle("active", t === tab));
      $$(".pay-panel").forEach((p) => { p.hidden = p.dataset.panel !== method; });
    });
  });

  /* ── Payment: backend-managed (Razorpay) with UPI-QR fallback ──
     Mode is detected at boot (detectBackend):
     · razorpay  — the patient pays inside the Razorpay hosted checkout;
                   the server verifies the signature before anything moves
                   forward. There is NO "I've paid" tap — an unpaid payment
                   can never reach the confirmation step.
     · qr        — no gateway keys / offline: patient scans the UPI QR
                   (money lands in the UPI VPA below); a manual confirm is
                   unavoidable because nobody can verify it server-side.
     · demo      — test mode (window.__OJAS_TEST__): instant fake pay. */
  let payMode = "demo";
  let payoutSuccess = [];
  const API_BASE = location.protocol === "file:" ? "http://localhost:8787" : "";

  function currentPlan() {
    let plan = null;
    try { plan = JSON.parse(sessionStorage.getItem("ojas-plan")); } catch (e) { plan = null; }
    if (!plan) plan = { name: "OJAS 60-Day Complete Vitality Program", price: "13450", plan: "sleep-60", track: "sleep" };
    return plan;
  }

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
      s.onload = () => res(window.Razorpay);
      s.onerror = () => rej(new Error("Razorpay checkout could not be loaded (check internet)"));
      document.head.appendChild(s);
    });
  }

  function postJson(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    });
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
    $("#qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + encodeURIComponent(uri);
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

  /* ── Checkout (full programs) ─────────────────── */
  let checkoutBusy = false;

  function openCheckoutSuccess(plan) {
    const success = $("#pay-success");
    success.classList.add("show");
    success.setAttribute("aria-hidden", "false");
    const note = success.querySelector("p");
    if (note) {
      const failed = payoutSuccess.filter((w) => String(w).includes("failed"));
      note.innerHTML = "Your payment is <strong>verified</strong> — receipt under <strong>ODW Digital Network</strong>. Your squad has been notified" +
        (failed.length === 0 ? " and will reach out within 24 hours." : " (WhatsApp delivery pending setup: " + failed.join(", ") + ").");
    }
  }

  $$("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (checkoutBusy) return;
      const plan = currentPlan();
      const amount = Number(plan.price);

      if (payMode === "demo") { payoutSuccess = []; openCheckoutSuccess(plan); return; }

      if (payMode === "razorpay") {
        checkoutBusy = true;
        btn.disabled = true;
        const nameEl = $("#pay-name"), phoneEl = $("#pay-phone");
        const name = nameEl ? nameEl.value.trim() : "";
        const phone = phoneEl ? phoneEl.value.trim().replace(/[^0-9]/g, "") : "";
        try {
          const order = await postJson("/api/order-create", {
            kind: "plan",
            amount: amount * 100,
            notes: { name: name, phone: phone, detail: plan.name, plan: plan.plan }
          });
          const Rz = await loadRazorpay();
          const rzp = new Rz({
            key: order.key,
            order_id: order.orderId,
            amount: order.amount,
            currency: "INR",
            name: "OJAS",
            description: plan.name,
            prefill: { name: name.slice(0, 60), contact: phone ? "+91" + phone : undefined },
            theme: { color: "#d4af37" },
            redirect: true,
            handler: async (resp) => {
              try {
                const v = await postJson("/api/verify", {
                  kind: "plan",
                  orderId: resp.razorpay_order_id,
                  paymentId: resp.razorpay_payment_id,
                  signature: resp.razorpay_signature,
                  amount: amount,
                  booking: { name: name, phone: phone, plan: plan.name, planId: plan.plan }
                });
                payoutSuccess = v.wa || [];
                checkoutBusy = false;
                btn.disabled = false;
                openCheckoutSuccess(plan);
              } catch (err) {
                console.error(err);
                checkoutBusy = false;
                btn.disabled = false;
                alert("Payment could not be verified: " + err.message);
              }
            },
            modal: { ondismiss: () => { checkoutBusy = false; btn.disabled = false; } }
          });
          rzp.open();
        } catch (err) {
          console.error(err);
          checkoutBusy = false;
          btn.disabled = false;
          alert("Payment could not be started: " + err.message);
        }
        return;
      }

      /* qr fallback — payment is scanned & paid by the patient; the
         booking then proceeds with a manual confirm (no server exists
         in this mode to verify the payment). */
      qrOnContinue = () => {
        payoutSuccess = [];
        openCheckoutSuccess(plan);
      };
      showQrPay(amount, plan.name);
    });
  });
  $("#pay-success [data-close-success]").addEventListener("click", () => {
    const success = $("#pay-success");
    success.classList.remove("show");
    success.setAttribute("aria-hidden", "true");
    sessionStorage.removeItem("ojas-plan");
    location.hash = "#/";
  });

  /* ── Init ────────────────────────────────── */
  const prefs = { consent: localStorage.getItem("ojas-consent") };
  hydrateCheckout();
  navigate();
  detectBackend();

  /* consent gates the app on first visit */
  if (!prefs.consent) {
    setTimeout(consentOpen, 600);
  }

  /* rehydrate checkout whenever it becomes active */
  window.addEventListener("hashchange", () => {
    if (routes[location.hash.replace(/^#\/?/, "")] === "checkout") hydrateCheckout();
  });

  /* ═══════════════ ₹99 CONSULT BOOKING ═══════════════ */
  const CONSULT_FEE = 99;
  const pillarNames = { gut: "Gut Health", mind: "Emotional Health", sleep: "Sleep Health", sexual: "Sexual Health" };

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

  function openConsult(pillar) {
    consultCtx = { pillar: pillar || "gut" };
    const label = pillarNames[consultCtx.pillar];
    $("#consult-pillar-tag").textContent = label + " Consult";
    $("#consult-pay-tag").textContent = label + " Consult";
    $("#c-name").value = ""; $("#c-age").value = ""; $("#c-phone").value = "";
    $("#c-profession").value = ""; $("#c-city").value = "";
    $$(".seg", $("#c-problem")).forEach((b) => b.classList.remove("active"));
    $("#consult-err").hidden = true;
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "details"));
    consultModal.classList.add("show");
    consultModal.setAttribute("aria-hidden", "false");
  }

  function closeConsult() {
    consultModal.classList.remove("show");
    consultModal.setAttribute("aria-hidden", "true");
  }

  /* problem segmented */
  $$(".seg", $("#c-problem")).forEach((b) => b.addEventListener("click", () => {
    $$(".seg", $("#c-problem")).forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  }));

  /* details → payment */
  $("#consult-to-pay").addEventListener("click", () => {
    const name = $("#c-name").value.trim();
    const age = $("#c-age").value.trim();
    const phone = $("#c-phone").value.trim();
    const profession = $("#c-profession").value.trim();
    const city = $("#c-city").value.trim();
    const concernBtn = $(".seg.active", $("#c-problem"));
    const err = $("#consult-err");

    if (!name || !age || !phone || !profession || !city || !concernBtn) {
      err.textContent = "Please fill all fields and select your concern.";
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
    err.hidden = true;

    consultCtx = Object.assign(consultCtx, {
      name, age: n, phone, profession, city, concern: concernBtn.dataset.v
    });
    $("#consult-summary-line").textContent =
      consultCtx.name + " · " + consultCtx.age + " yrs · " + consultCtx.city + " · " + consultCtx.concern;
    $("#consult-amount").textContent = "₹" + CONSULT_FEE;
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "payment"));
  });

  /* payment → verified checkout (razorpay) / scan-pay QR (fallback) / demo */
  const payBtn = $("#consult-pay-btn");
  let payInFlight = false;
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

    if (payMode === "demo") {
      payInFlight = true;
      payBtn.disabled = true;
      payBtn.innerHTML = "<span>Processing payment…</span>";
      setTimeout(() => { resetPayBtn(); afterPayment(); }, 1200);
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
            detail: pillarNames[c.pillar] + " consult", concern: c.concern
          }
        });
        const Rz = await loadRazorpay();
        const rzp = new Rz({
          key: order.key,
          order_id: order.orderId,
          amount: order.amount,
          currency: "INR",
          name: "OJAS",
          description: pillarNames[c.pillar] + " Consult",
          prefill: { name: c.name, contact: "+91" + c.phone },
          theme: { color: "#d4af37" },
          redirect: true,
          handler: async (resp) => {
            try {
              const v = await postJson("/api/verify", {
                kind: "consult",
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
                amount: CONSULT_FEE,
                booking: {
                  name: c.name, age: c.age, phone: c.phone, city: c.city,
                  profession: c.profession, concern: c.concern, pillar: pillarNames[c.pillar]
                }
              });
              payoutSuccess = v.wa || [];
              afterPayment();
            } catch (err) {
              console.error(err);
              payErr("Payment could not be verified: " + err.message);
            }
            resetPayBtn();
          },
          modal: { ondismiss: () => { resetPayBtn(); } }
        });
        rzp.open();
      } catch (err) {
        console.error(err);
        payErr("Payment could not be started: " + err.message);
        resetPayBtn();
      }
      return;
    }

    /* qr fallback — patient scans, pays, confirms manually */
    qrOnContinue = () => { payoutSuccess = []; afterPayment(); };
    showQrPay(CONSULT_FEE, "OJAS Consult");
  });

  function afterPayment() {
    resetPayBtn();
    renderSlots();
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
    selectedSlot = null;
    $("#consult-confirm-slot").disabled = true;
    $("#slot-err").hidden = true;
    $("#consult-date").textContent = dateLabel();
    const taken = consultationsTaken().reduce((acc, b) => (acc[b.slot] = true, acc), {});
    const grid = $("#consult-slots");
    grid.innerHTML = "";
    SLOTS.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-btn" + (taken[t] ? " is-taken" : "");
      b.textContent = t;
      b.disabled = !!taken[t];
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
    return [
      { to: "Patient (" + c.phone + ")", body: "OJAS — your ₹" + CONSULT_FEE + " consultation is CONFIRMED. Call on " + dateLabel() + " at " + selectedSlot + ". A reminder will follow tomorrow. OJAS Care" },
      { to: "Care team", body: "NEW OJAS CONSULT — " + c.name + " · " + c.age + " yrs · " + c.city + " · " + c.profession + " · Concern: " + c.concern + " · Phone +91 " + c.phone + " · Fee ₹" + CONSULT_FEE + " PAID · Call on " + dateLabel() + "." },
      { to: "Care team", body: "Time chosen by " + c.name + " for " + dateLabel() + ": " + selectedSlot + "." }
    ];
  }

  function renderSmsPreview() {
    const panel = $("#sms-preview");
    panel.innerHTML = "";
    deliverMessages().forEach((m) => {
      const d = document.createElement("div");
      d.className = "sms-bubble";
      const b = document.createElement("strong");
      b.textContent = "SMS → " + m.to;
      const t = document.createElement("p");
      t.textContent = m.body;
      d.appendChild(b); d.appendChild(t);
      panel.appendChild(d);
    });
    if (CONSULT_LIVE.smsWebhook) {
      fetch(CONSULT_LIVE.smsWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: consultCtx.phone, messages: deliverMessages() })
      }).catch(() => {});
    }
  }

  /* confirm → save + preview + finish (payment already verified) */
  $("#consult-confirm-slot").addEventListener("click", () => {
    if (!selectedSlot) { $("#slot-err").hidden = false; return; }
    const id = saveConsultation();
    renderSmsPreview();
    const waNote = $("#consult-wa-note");
    if (waNote) {
      const failed = payoutSuccess.filter((w) => String(w).includes("failed"));
      waNote.textContent = failed.length
        ? "Care team WhatsApp push pending setup (" + failed.join(", ") + ")."
        : "Your care team has been notified automatically.";
      waNote.hidden = false;
    }
    consultSteps.forEach((s) => s.classList.toggle("show", s.dataset.consultStep === "done"));
  });

  $("#consult-done").addEventListener("click", closeConsult);
})();
