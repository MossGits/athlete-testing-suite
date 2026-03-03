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
    stimMs: 500,
    avgIsiMs: 1200,
    jitterMaxMs: 500
  };

  let abort = false;
  let hasConfigFromController = false;

  function post(type, payload = {}) {
    // Send to the controller window
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
    // Must be called from a user gesture (button click)
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  }

  function setText(lines) {
    stageText.innerHTML = Array.isArray(lines)
      ? lines.map(l => `<div>${l}</div>`).join("")
      : String(lines);
  }

  function showSquare(color) {
    stageText.innerHTML = "";
    const sq = document.createElement("div");
    sq.style.width = "260px";
    sq.style.height = "260px";
    sq.style.borderRadius = "22px";
    sq.style.background = color;
    sq.style.boxShadow = "0 20px 80px rgba(0,0,0,0.65)";
    const root = document.getElementById("root");
    root.innerHTML = "";
    root.appendChild(sq);
  }

  function showLetter(letter) {
    document.getElementById("root").innerHTML =
      `<div style="font-size:200px;font-weight:900;letter-spacing:2px">${letter}</div>`;
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

  // ---------- NEW: standardized “prompt between phases” ----------
  async function waitScreen(lines, transitionMarker) {
    if (transitionMarker) post("marker", { marker: transitionMarker });
    setText(lines);
    await waitForSpace();
  }

  async function runGoNoGo() {
    const durationMs = cfg.goNoGoDurationMs ?? 120000;
    const stimMs = cfg.stimMs ?? 500;
    const avgIsiMs = cfg.avgIsiMs ?? 1200;
    const jitterMaxMs = cfg.jitterMaxMs ?? 500;

    post("phaseStart", { phase: "GoNoGo" });
    post("marker", { marker: "PHASE_START_GONOGO" });

    setText([
      "Go/No-Go Task",
      "Press SPACE for GREEN (Go).",
      "Do NOT press for RED (No-Go).",
      "",
      "Get ready…"
    ]);
    await sleep(1500);

    const endAt = Date.now() + durationMs;

    while (Date.now() < endAt) {
      if (abort) throw new Error("Aborted");

      const isGo = Math.random() < 0.7;
      const stimType = isGo ? "Go" : "No-Go";
      showSquare(isGo ? "rgb(0,150,0)" : "rgb(150,0,0)");
      post("marker", { marker: `GoNoGo_${stimType}` });

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

      const correct = (isGo && responded) || (!isGo && !responded);
      post("response", { task: "Go/No-Go", stimulus: stimType, correct, rtMs });

      // ISI fixation
      document.getElementById("root").innerHTML = `<div style="font-size:34px;opacity:0.25">+</div>`;
      const jitter = Math.random() * jitterMaxMs;
      await sleep(avgIsiMs + jitter);
    }

    post("marker", { marker: "PHASE_END_GONOGO" });
    post("phaseEnd", { phase: "GoNoGo" });
  }

  async function runOneBack() {
    const durationMs = cfg.oneBackDurationMs ?? 120000;
    const stimMs = cfg.stimMs ?? 500;
    const avgIsiMs = cfg.avgIsiMs ?? 1200;
    const jitterMaxMs = cfg.jitterMaxMs ?? 500;

    post("phaseStart", { phase: "OneBack" });
    post("marker", { marker: "PHASE_START_ONEBACK" });

    setText([
      "1-Back Task",
      "Press SPACE ONLY if the letter matches the previous one.",
      "",
      "Get ready…"
    ]);
    await sleep(1500);

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

      document.getElementById("root").innerHTML = `<div style="font-size:34px;opacity:0.25">+</div>`;
      const jitter = Math.random() * jitterMaxMs;
      await sleep(avgIsiMs + jitter);

      prev = letter;
    }

    post("marker", { marker: "PHASE_END_ONEBACK" });
    post("phaseEnd", { phase: "OneBack" });
  }

  async function runPostural() {
    const trialMs = cfg.posturalTrialMs ?? 30000;
    const conditions = [
      "Eyes Closed (Both Feet)",
      "Eyes Closed (Left Leg)",
      "Eyes Closed (Right Leg)"
    ];

    post("phaseStart", { phase: "Postural" });
    post("marker", { marker: "PHASE_START_POSTURAL" });

    setText([
      "Postural Balance",
      "Three 30-second trials, eyes closed:",
      "1) Both feet",
      "2) Left leg",
      "3) Right leg",
      "",
      "Press SPACE to begin Trial 1"
    ]);

    await waitForSpace();

    for (let i = 0; i < conditions.length; i++) {
      if (abort) throw new Error("Aborted");

      const c = conditions[i];
      setText([c, "", "(Hold as still as possible)"]);
      post("marker", { marker: `Postural_${c.replaceAll(" ", "_")}` });

      await countdown(trialMs, `Postural ${i+1}/3`);

      if (i < conditions.length - 1) {
        setText([`Trial ${i+1} complete.`, `Prepare for Trial ${i+2}.`, "", "Press SPACE when ready."]);
        await waitForSpace();
      }
    }

    post("marker", { marker: "PHASE_END_POSTURAL" });
    post("phaseEnd", { phase: "Postural" });
  }

  async function runAll() {
    try {
      post("started", {});
      setText(["Welcome", "", "Press SPACE to begin the test."]);
      await waitForSpace();

      await runGoNoGo();

      // ---------- NEW: prompt between phases ----------
      await waitScreen(
        [
          "Go/No-Go complete ✅",
          "",
          "Press SPACE to continue to the 1-Back task."
        ],
        "TRANSITION_GONOGO_TO_ONEBACK"
      );

      await runOneBack();

      // ---------- NEW: prompt between phases ----------
      await waitScreen(
        [
          "1-Back complete ✅",
          "",
          "Next: Postural Balance (eyes closed).",
          "Press SPACE to continue."
        ],
        "TRANSITION_ONEBACK_TO_POSTURAL"
      );

      await runPostural();

      setText(["Complete ✅", "", "You may close this window."]);
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
      // Fullscreen failed; still allow running
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
      // Merge into defaults so missing fields don't break things
      cfg = { ...cfg, ...(msg.payload || {}) };
      hasConfigFromController = true;
      post("configAck", {});
      setText(["Ready.", "", "Click Start Fullscreen to begin."]);
      // Optionally enable Start only after config received
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
    // Start disabled until config arrives (but defaults exist, so even if you enabled it, it wouldn't crash)
    btnStartFs.disabled = true;
    setText(["Connecting to controller…", "", "Waiting for configuration."]);
    post("hello", {});
  }
})();
