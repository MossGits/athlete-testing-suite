(function () {
  const overlay = document.getElementById("overlay");
  const btnStartFs = document.getElementById("btnStartFs");
  const btnAbort = document.getElementById("btnAbort");
  const timerEl = document.getElementById("timer");

  // ---------- Robust messaging (BC + opener + storage) ----------
  const qs = new URLSearchParams(location.search);
  const bcName = qs.get("bc"); // controller opens /paradigm.html?bc=athlete-paradigm-<sessionId>
  const bc = (bcName && typeof BroadcastChannel !== "undefined") ? new BroadcastChannel(bcName) : null;
  const storageKey = bcName ? `paradigm-msg-${bcName}` : "paradigm-msg-nosession";

  // Defaults so cfg is NEVER null
  let cfg = {
    goNoGoDurationMs: 15000,
    oneBackDurationMs: 15000,
    posturalTrialMs: 15000,

    // match experiment.py defaults: stim_time=0.5, avg_isi=1.2, jitter_max=0.5 (seconds)
    stimSec: 0.5,
    avgIsiSec: 1.2,
    jitterMaxSec: 0.5,

    // match show_welcome() wait(15) and draw_text(...wait_time=2/3)
    welcomeMs: 2000,
    startBannerMs: 500,
    endSavingMs: 500,
    endSavedMs: 500
  };

  let abort = false;
  let hasConfigFromController = false;

 function post(type, payload = {}) {
  const msg = { source: "PARADIGM", type, payload };

  // Prefer BroadcastChannel; don't double-send.
  if (bc) {
    try { bc.postMessage(msg); } catch {}
    return;
  }

  // Fallback: opener only if no BC
  if (window.opener) {
    try { window.opener.postMessage(msg, "*"); } catch {}
  }
}

    // 1) BroadcastChannel (best)
    if (bc) {
      try { bc.postMessage(msg); } catch {}
    }

    // 2) window.opener (fallback)
    if (window.opener) {
      try { window.opener.postMessage(msg, "*"); } catch {}
    }

    // 3) localStorage (robust same-origin fallback)
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ts: Date.now(), ...msg }));
    } catch {}
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function msToClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  async function ensureFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  }

  function getStageTextEl() {
    let el = document.getElementById("stageText");
    if (!el) {
      const root = document.getElementById("root");
      root.innerHTML = `<div id="stageText"></div>`;
      el = document.getElementById("stageText");
    }
    return el;
  }

  function setText(lines) {
    const stageText = getStageTextEl();
    stageText.innerHTML = Array.isArray(lines)
      ? lines.map(l => `<div>${l}</div>`).join("")
      : String(lines);
  }

  function setTimer(label, leftMs) {
    timerEl.textContent = (label ? `${label} — ` : "") + msToClock(leftMs);
  }

  async function countdown(ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (abort) throw new Error("Aborted");
      setTimer(label, end - Date.now());
      await sleep(100);
    }
    timerEl.textContent = "—";
  }

  function waitForSpace() {
    return new Promise((resolve, reject) => {
      const onKey = (e) => {
        if (abort) { cleanup(); reject(new Error("Aborted")); return; }
        if (e.code === "Space" || e.key === " ") { cleanup(); resolve(); }
      };
      function cleanup() { window.removeEventListener("keydown", onKey); }
      window.addEventListener("keydown", onKey);
    });
  }

  async function waitForSpaceWithLines(lines, markerName) {
    if (markerName) post("marker", { marker: markerName });
    setText(lines);
    await waitForSpace();
  }

  function showSquare(color) {
    const root = document.getElementById("root");
    root.innerHTML = "";
    const sq = document.createElement("div");
    sq.style.width = "260px";
    sq.style.height = "260px";
    sq.style.borderRadius = "22px";
    sq.style.background = color;
    sq.style.boxShadow = "0 20px 80px rgba(0,0,0,0.65)";
    root.appendChild(sq);
  }

  function showLetter(letter) {
    const root = document.getElementById("root");
    root.innerHTML =
      `<div style="font-size:200px;font-weight:900;letter-spacing:2px">${letter}</div>`;
  }

  function showBlank() {
    const root = document.getElementById("root");
    root.innerHTML = `<div id="stageText"></div>`;
  }

  // ------------------ VERBATIM screens from experiment.py ------------------

  async function showWelcome() {
    const welcome_text = [
      "Welcome to the Concussion Diagnostic Test.",
      "",
      "You will complete a series of tasks designed to assess cognitive function and balance.",
      "",
      "Please ensure you are seated comfortably with your Muse headset securely in place.",
      "",
      "Your participation is invaluable in advancing concussion research.",
      "",
      "The test will begin shortly."
    ];
    setText(welcome_text);
    await countdown(cfg.welcomeMs ?? 15000, "Welcome");
  }

  async function showInstructions() {
    const instructions = [
      "You may begin whenever you are ready.",
      "",
      "Press SPACE to begin the test."
    ];
    await waitForSpaceWithLines(instructions, "INSTRUCTIONS_START");
  }

  async function goNoGoTask() {
    await waitForSpaceWithLines([
      "Go/No-Go Task Instructions:",
      "Press any key as quickly as possible when you see a GREEN square (Go).",
      "Do NOT respond when you see a RED square (No-Go).",
      "Accuracy and speed are both important.",
      "",
      "Press SPACE when you are ready to begin."
    ], "INSTRUCTIONS_GONOGO");

    setText("Go/No-Go Task Starting");
    await countdown(cfg.startBannerMs ?? 2000, "Go/No-Go");

    post("phaseStart", { phase: "GoNoGo" });
    post("marker", { marker: "PHASE_START_GONOGO" });

    const durationMs = cfg.goNoGoDurationMs ?? 120000;
    const stimMs = Math.round((cfg.stimSec ?? 0.5) * 1000);
    const avgIsiMs = Math.round((cfg.avgIsiSec ?? 1.2) * 1000);
    const jitterMaxMs = Math.round((cfg.jitterMaxSec ?? 0.5) * 1000);

    const endAt = Date.now() + durationMs;

    while (Date.now() < endAt) {
      if (abort) throw new Error("Aborted");

      const isGo = Math.random() < 0.7;
      const stimulus_type = isGo ? "Go" : "No-Go";
      showSquare(isGo ? "rgb(0,150,0)" : "rgb(150,0,0)");
      post("marker", { marker: `GoNoGo_${stimulus_type}` });

      const t0 = performance.now();
      let responded = false;
      let rtMs = null;

      const onKey = (e) => {
        if (responded) return;
        responded = true;
        rtMs = Math.round(performance.now() - t0);
      };

      window.addEventListener("keydown", onKey);
      await sleep(stimMs);
      window.removeEventListener("keydown", onKey);

      const correct = (isGo && responded) || (!isGo && !responded);
      post("response", { task: "Go/No-Go", stimulus: stimulus_type, correct, rtMs });

      showBlank();
      const jitter = Math.random() * jitterMaxMs;
      await sleep(avgIsiMs + jitter);
    }

    post("marker", { marker: "PHASE_END_GONOGO" });
    post("phaseEnd", { phase: "GoNoGo" });
  }

  async function oneBackTask() {
    await waitForSpaceWithLines([
      "1-Back Task Instructions:",
      "A letter will be displayed on the screen.",
      "Press SPACE ONLY if the current letter matches the one shown immediately before.",
      "Do NOT respond if the letter is different.",
      "Focus on accuracy and reaction time.",
      "",
      "Press SPACE when you are ready to begin."
    ], "INSTRUCTIONS_ONEBACK");

    setText("1-Back Task Starting");
    await countdown(cfg.startBannerMs ?? 2000, "1-Back");

    post("phaseStart", { phase: "OneBack" });
    post("marker", { marker: "PHASE_START_ONEBACK" });

    const durationMs = cfg.oneBackDurationMs ?? 120000;
    const stimMs = Math.round((cfg.stimSec ?? 0.5) * 1000);
    const avgIsiMs = Math.round((cfg.avgIsiSec ?? 1.2) * 1000);
    const jitterMaxMs = Math.round((cfg.jitterMaxSec ?? 0.5) * 1000);

    const stimuli = ["A","B","C","D","E"];
    let prev = null;

    const endAt = Date.now() + durationMs;

    while (Date.now() < endAt) {
      if (abort) throw new Error("Aborted");

      let letter;
      let isTarget = false;
      if (prev && Math.random() < 0.3) {
        letter = prev;
        isTarget = true;
      } else {
        const choices = prev ? stimuli.filter(x => x !== prev) : stimuli;
        letter = choices[Math.floor(Math.random() * choices.length)];
      }

      prev = letter;
      showLetter(letter);
      post("marker", { marker: `1Back_${isTarget ? "Target" : "NonTarget"}` });

      const t0 = performance.now();
      let responded = false;
      let rtMs = null;

      const onKey = (e) => {
        if (responded) return;
        if (e.code === "Space" || e.key === " ") {
          responded = true;
          rtMs = Math.round(performance.now() - t0);
        }
      };

      window.addEventListener("keydown", onKey);
      await sleep(stimMs);
      window.removeEventListener("keydown", onKey);

      const correct = (isTarget && responded) || (!isTarget && !responded);
      post("response", { task: "1-Back", stimulus: isTarget ? "Target" : "Non-Target", correct, rtMs });

      showBlank();
      const jitter = Math.random() * jitterMaxMs;
      await sleep(avgIsiMs + jitter);
    }

    post("marker", { marker: "PHASE_END_ONEBACK" });
    post("phaseEnd", { phase: "OneBack" });
  }

async function waitBetweenConditions(condition_number) {
  let messages = [
    "Trial 1 complete.",
    "Prepare for Trial 2: Stand on your LEFT leg with eyes closed.",
    "Press SPACE when you are ready."
  ];
  if (condition_number === 2) {
    messages = [
      "Trial 2 complete.",
      "Prepare for Trial 3: Stand on your RIGHT leg with eyes closed.",
      "Press SPACE when you are ready."
    ];
  } else if (condition_number === 3) {
    messages = [
      "All trials complete.",
      "Thank you for your participation."
    ];
  }

  setText(messages);

  // For the final screen, auto-advance after 2 seconds (no SPACE required)
  if (condition_number === 3) {
    await sleep(2000);
    return;
  }

  await waitForSpace();
}

  async function posturalBalanceTask() {
  await waitForSpaceWithLines([
    "Postural Balance Task Instructions:",
    "You will complete three 30-second standing trials, all with eyes closed.",
    "1. Both feet on the ground",
    "2. Standing on your LEFT leg",
    "3. Standing on your RIGHT leg",
    "",
    "Please stand as still as possible during each trial.",
    "Press SPACE to start the first trial."
  ], "INSTRUCTIONS_POSTURAL");

  setText("Postural Balance Task Starting");
  await countdown(cfg.startBannerMs ?? 2000, "Postural");

  const trialMs = cfg.posturalTrialMs ?? 30000;

  const conditions = [
    {
      phase: "PosturalBoth",
      label: "Eyes Closed (Both Feet)",
      marker: "Postural_Both_Feet"
    },
    {
      phase: "PosturalLeft",
      label: "Eyes Closed (Left Leg)",
      marker: "Postural_Left_Leg"
    },
    {
      phase: "PosturalRight",
      label: "Eyes Closed (Right Leg)",
      marker: "Postural_Right_Leg"
    }
  ];

  for (let i = 0; i < conditions.length; i++) {
    if (abort) throw new Error("Aborted");

    const condition = conditions[i];

    post("phaseStart", { phase: condition.phase });
    post("marker", { marker: `PHASE_START_${condition.phase.toUpperCase()}` });

    setText(condition.label);
    post("marker", { marker: condition.marker });

    await countdown(trialMs, `Postural ${i + 1}/3`);

    post("marker", { marker: `PHASE_END_${condition.phase.toUpperCase()}` });
    post("phaseEnd", { phase: condition.phase });

    if (i < conditions.length - 1) {
      await waitBetweenConditions(i + 1);
    }
  }

  await waitBetweenConditions(3);
}

  async function runAll() {
    try {
      post("started", {});

      await showWelcome();
      await showInstructions();

      await goNoGoTask();
      await oneBackTask();
      await posturalBalanceTask();

      setText("Experiment Complete. Saving data...");
      await countdown(cfg.endSavingMs ?? 2000, "Finishing");

      setText("Data saved. The program will now close.");
      await countdown(cfg.endSavedMs ?? 3000, "Done");

      post("done", {});
    } catch (e) {
      setText(["Stopped.", String(e?.message || e)]);
      post("aborted", { reason: String(e?.message || e) });
    }
  }

  btnAbort.addEventListener("click", () => {
    abort = true;
    post("aborted", { reason: "User aborted in paradigm window" });
  });

  btnStartFs.addEventListener("click", async () => {
    try {
      await ensureFullscreen();
      overlay.style.display = "none";
      post("ready", { hasConfigFromController });
      runAll();
    } catch (e) {
      overlay.style.display = "none";
      post("ready", { fullscreen: false, error: String(e?.message || e), hasConfigFromController });
      runAll();
    }
  });

  function handleControllerMessage(msg) {
    if (!msg || msg.source !== "CONTROLLER") return;

    if (msg.type === "config") {
      cfg = { ...cfg, ...(msg.payload || {}) };
      hasConfigFromController = true;
      post("configAck", {});
      setText(["Ready.", "", "Click Start Fullscreen to begin."]);
      btnStartFs.disabled = false;
      return;
    }

    if (msg.type === "abort") {
      abort = true;
      post("aborted", { reason: "Abort requested by controller" });
      return;
    }
  }

  window.addEventListener("message", (ev) => {
    handleControllerMessage(ev.data);
  });

  if (bc) {
    bc.onmessage = (ev) => {
      handleControllerMessage(ev.data);
    };
  }

  // If opened manually without controller:
  if (!window.opener && !bc) {
    setText(["No controller window found.", "", "Open this from the Baseline/Active test page."]);
    btnStartFs.disabled = true;
  } else {
    btnStartFs.disabled = true;
    setText(["Connecting to controller…", "", "Waiting for configuration."]);
    post("hello", {});
  }
})();
