(function () {
  const overlay = document.getElementById("overlay");
  const btnStartFs = document.getElementById("btnStartFs");
  const btnAbort = document.getElementById("btnAbort");
  const stageText = document.getElementById("stageText");
  const timerEl = document.getElementById("timer");

  // Defaults so cfg is NEVER null
  let cfg = {
    goNoGoDurationMs: 120000,
    oneBackDurationMs: 120000,
    posturalTrialMs: 30000,

    // match experiment.py defaults: stim_time=0.5, avg_isi=1.2, jitter_max=0.5 (seconds)
    stimSec: 0.5,
    avgIsiSec: 1.2,
    jitterMaxSec: 0.5,

    // match show_welcome() wait(15) and draw_text(...wait_time=2/3)
    welcomeMs: 15000,
    startBannerMs: 2000,
    endSavingMs: 2000,
    endSavedMs: 3000
  };

  let abort = false;
  let hasConfigFromController = false;

  function post(type, payload = {}) {
    if (window.opener) {
      window.opener.postMessage({ source: "PARADIGM", type, payload }, "*");
    }
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

  function setText(lines) {
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

  // Equivalent to wait_for_space(instruction_lines=[...]) in experiment.py
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
    root.innerHTML = "";
  }

  // ------------------ VERBATIM screens from experiment.py ------------------

  async function showWelcome() {
    // show_welcome() text, verbatim :contentReference[oaicite:8]{index=8}
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
    // show_instructions() text, verbatim :contentReference[oaicite:9]{index=9}
    const instructions = [
      "You may begin whenever you are ready.",
      "",
      "Press SPACE to begin the test."
    ];
    await waitForSpaceWithLines(instructions, "INSTRUCTIONS_START");
  }

  // ------------------ Tasks (same structure as experiment.py) ------------------

  async function goNoGoTask() {
    // go_nogo_task() wait_for_space lines, verbatim :contentReference[oaicite:10]{index=10}
    await waitForSpaceWithLines([
      "Go/No-Go Task Instructions:",
      "Press any key as quickly as possible when you see a GREEN square (Go).",
      "Do NOT respond when you see a RED square (No-Go).",
      "Accuracy and speed are both important.",
      "",
      "Press SPACE when you are ready to begin."
    ], "INSTRUCTIONS_GONOGO");

    // draw_text("Go/No-Go Task Starting", wait_time=2), verbatim :contentReference[oaicite:11]{index=11}
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
      const stimulus_type = isGo ? "Go" : "No-Go"; // matches python stimulus_type
      showSquare(isGo ? "rgb(0,150,0)" : "rgb(150,0,0)");
      post("marker", { marker: `GoNoGo_${stimulus_type}` });

      const t0 = performance.now();
      let responded = false;
      let rtMs = null;

      // Python responds to ANY key (KEYDOWN) :contentReference[oaicite:12]{index=12}
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
    // oneback_task() wait_for_space lines, verbatim :contentReference[oaicite:13]{index=13}
    await waitForSpaceWithLines([
      "1-Back Task Instructions:",
      "A letter will be displayed on the screen.",
      "Press SPACE ONLY if the current letter matches the one shown immediately before.",
      "Do NOT respond if the letter is different.",
      "Focus on accuracy and reaction time.",
      "",
      "Press SPACE when you are ready to begin."
    ], "INSTRUCTIONS_ONEBACK");

    // draw_text("1-Back Task Starting", wait_time=2), verbatim :contentReference[oaicite:14]{index=14}
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

      // matches python marker name :contentReference[oaicite:15]{index=15}
      post("marker", { marker: `1Back_${isTarget ? "Target" : "NonTarget"}` });

      const t0 = performance.now();
      let responded = false;
      let rtMs = null;

      // Prompt says SPACE ONLY, so enforce SPACE here
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
    // wait_between_conditions(condition_number) messages, verbatim :contentReference[oaicite:16]{index=16}
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
    await waitForSpace();
  }

  async function posturalBalanceTask() {
    // postural_balance_task() wait_for_space lines, verbatim :contentReference[oaicite:17]{index=17}
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

    // draw_text("Postural Balance Task Starting", wait_time=2), verbatim :contentReference[oaicite:18]{index=18}
    setText("Postural Balance Task Starting");
    await countdown(cfg.startBannerMs ?? 2000, "Postural");

    post("phaseStart", { phase: "Postural" });
    post("marker", { marker: "PHASE_START_POSTURAL" });

    const trialMs = cfg.posturalTrialMs ?? 30000;

    const conditions = [
      "Eyes Closed (Both Feet)",
      "Eyes Closed (Left Leg)",
      "Eyes Closed (Right Leg)"
    ];

    for (let i = 0; i < conditions.length; i++) {
      if (abort) throw new Error("Aborted");

      const condition = conditions[i];
      setText(condition);

      // matches python marker naming :contentReference[oaicite:19]{index=19}
      post("marker", { marker: `Postural_${condition.replaceAll(" ", "_")}` });

      await countdown(trialMs, `Postural ${i + 1}/3`);

      if (i < conditions.length - 1) {
        // condition_number in python is i+1
        await waitBetweenConditions(i + 1);
      }
    }

    post("marker", { marker: "PHASE_END_POSTURAL" });
    post("phaseEnd", { phase: "Postural" });

    // Python calls wait_between_conditions(condition_number=3) only in the loop logic?
    // In experiment.py, it shows the "All trials complete / Thank you" when condition_number==3,
    // but that branch isn't reached via the loop's i < len-1 condition. So we show it here
    // to match the *intended* final prompt behavior.
    await waitBetweenConditions(3);
  }

  // ------------------ Main flow (matches run_experiment()) ------------------
  async function runAll() {
    try {
      post("started", {});

      await showWelcome();
      await showInstructions();

      await goNoGoTask();
      await oneBackTask();
      await posturalBalanceTask();

      // draw_text end screens, verbatim :contentReference[oaicite:20]{index=20}
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

  // Receive config from controller + abort requests
  window.addEventListener("message", (ev) => {
    const msg = ev.data;
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
  });

  // If opened manually without controller:
  if (!window.opener) {
    setText(["No controller window found.", "", "Open this from the Baseline/Active test page."]);
    btnStartFs.disabled = true;
  } else {
    btnStartFs.disabled = true;
    setText(["Connecting to controller…", "", "Waiting for configuration."]);
    post("hello", {});
  }
})();
