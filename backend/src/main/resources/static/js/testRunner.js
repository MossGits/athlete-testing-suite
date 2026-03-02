/*
  testRunner.js
  - Connects to Muse via /js/muse/Muse.js (Web Bluetooth)
  - Runs electrode quality check (JS port of quality_check.py)
  - Runs the experiment paradigm (JS port of experiment.py timing)
  - Records EEG/PPG/ACC/GYRO + markers + responses
  - Uploads per-phase CSVs to Spring Boot via /api/sessions/{id}/files (multipart)
*/

(function () {
  // ---------- helpers ----------
  const qs = new URLSearchParams(location.search);
  const sessionId = qs.get("sessionId");
  const athleteId = qs.get("athleteId");
  const mode = qs.get("mode") || "UNKNOWN";

  const $ = (id) => document.getElementById(id);

  const debugEl = $("debug");
  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(line);
    debugEl.textContent = (debugEl.textContent ? debugEl.textContent + "\n" : "") + line;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function setPill(pillId, colorClass, text) {
    const pill = $(pillId);
    if (!pill) return;
    const dot = pill.querySelector("span");
    const strong = pill.querySelector("strong");
    dot.className = colorClass;
    strong.textContent = text;
  }

  function msToClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  // ---------- wire query params ----------
  $("sessionId").textContent = sessionId || "(missing)";
  $("athleteId").textContent = athleteId || "(missing)";
  $("mode").textContent = mode;

  if (!sessionId) {
    log("Missing sessionId in query string. This page expects ?sessionId=...&athleteId=...&mode=...");
  }

  // ---------- muse + sampling ----------
  const muse = new Muse();

  // Rolling last ~1 second for quality
  const EEG_SFREQ = 256;

  // Muse 2 EEG channels: TP9, AF7, AF8, TP10 (NO AUX)
  const EEG_CH = 4;
  const eegRoll = Array.from({ length: EEG_CH }, () => []);

  const ppgRoll = [[], [], []];
  const accRoll = [[], [], []];
  const gyroRoll = [[], [], []];

  // Recording state
  let isConnected = false;
  let pollTimer = null;
  let qualityTimer = null;
  let qualityStableSince = null;
  let qualityPassed = false;
  let isRunning = false;
  let abortRequested = false;

  // Timestamping
  let lastEegTs = null;
  const EEG_DT_MS = 1000 / EEG_SFREQ;

  // Per-phase CSV buffers
  // phaseName -> { EEG: [lines], PPG: [lines], ACC: [lines], GYRO: [lines], MARKERS: [lines], RESPONSES: [lines] }
  const phaseData = new Map();
  let currentPhase = null;

  function ensurePhase(phase) {
    if (!phaseData.has(phase)) {
      phaseData.set(phase, {
        EEG: ["t_epoch_ms,tp9,af7,af8,tp10"],
        PPG: ["t_epoch_ms,ambient,ir,red"],
        ACC: ["t_epoch_ms,ax,ay,az"],
        GYRO: ["t_epoch_ms,gx,gy,gz"],
        MARKERS: ["t_epoch_ms,marker"],
        RESPONSES: ["t_epoch_ms,task,stimulus,correct,rt_ms"],
        META: []
      });
    }
    return phaseData.get(phase);
  }

  function marker(m) {
    const t = Date.now();
    if (currentPhase) {
      ensurePhase(currentPhase).MARKERS.push(`${t},${m}`);
    }
  }

  function recordResponse(task, stimulus, correct, rtMs) {
    const t = Date.now();
    if (currentPhase) {
      ensurePhase(currentPhase).RESPONSES.push(`${t},${task},${stimulus},${correct ? 1 : 0},${rtMs ?? 0}`);
    }
  }

  function trimTo(arr, n) {
    if (arr.length > n) arr.splice(0, arr.length - n);
  }

  function consumeMuseBuffers() {
    const now = Date.now();

    // ---- EEG (4 channels: TP9, AF7, AF8, TP10) ----
    while (true) {
      if (!muse?.eeg || muse.eeg.length < 4) break;

      const v = [
        muse.eeg[0].read(),
        muse.eeg[1].read(),
        muse.eeg[2].read(),
        muse.eeg[3].read(),
      ];
      if (v.some(x => x === null)) break;

      for (let i = 0; i < 4; i++) {
        eegRoll[i].push(v[i]);
        trimTo(eegRoll[i], EEG_SFREQ);
      }

      if (isRunning && currentPhase) {
        if (lastEegTs === null) lastEegTs = Date.now();
        lastEegTs += EEG_DT_MS;
        const t = Math.round(lastEegTs);
        ensurePhase(currentPhase).EEG.push(`${t},${v[0]},${v[1]},${v[2]},${v[3]}`);
      }
    }

    // ---- PPG (3 channels) ----
    while (true) {
      if (!muse?.ppg || muse.ppg.length < 3) break;
      const v = [muse.ppg[0].read(), muse.ppg[1].read(), muse.ppg[2].read()];
      if (v.some(x => x === null)) break;
      for (let i = 0; i < 3; i++) {
        ppgRoll[i].push(v[i]);
        trimTo(ppgRoll[i], 256);
      }
      if (isRunning && currentPhase) {
        const t = Date.now();
        ensurePhase(currentPhase).PPG.push(`${t},${v[0]},${v[1]},${v[2]}`);
      }
    }

    // ---- ACC (3 axes) ----
    while (true) {
      if (!muse?.accelerometer || muse.accelerometer.length < 3) break;
      const v = [muse.accelerometer[0].read(), muse.accelerometer[1].read(), muse.accelerometer[2].read()];
      if (v.some(x => x === null)) break;
      for (let i = 0; i < 3; i++) {
        accRoll[i].push(v[i]);
        trimTo(accRoll[i], 256);
      }
      if (isRunning && currentPhase) {
        const t = Date.now();
        ensurePhase(currentPhase).ACC.push(`${t},${v[0]},${v[1]},${v[2]}`);
      }
    }

    // ---- GYRO (3 axes) ----
    while (true) {
      if (!muse?.gyroscope || muse.gyroscope.length < 3) break;
      const v = [muse.gyroscope[0].read(), muse.gyroscope[1].read(), muse.gyroscope[2].read()];
      if (v.some(x => x === null)) break;
      for (let i = 0; i < 3; i++) {
        gyroRoll[i].push(v[i]);
        trimTo(gyroRoll[i], 256);
      }
      if (isRunning && currentPhase) {
        const t = Date.now();
        ensurePhase(currentPhase).GYRO.push(`${t},${v[0]},${v[1]},${v[2]}`);
      }
    }

    // Stream presence checks (guard for missing buffers)
    const eegOk = !!muse?.eeg?.[0] && (now - muse.eeg[0].lastwrite) < 1500;
    const ppgOk = !!muse?.ppg?.[0] && (now - muse.ppg[0].lastwrite) < 1500;
    const accOk = !!muse?.accelerometer?.[0] && (now - muse.accelerometer[0].lastwrite) < 1500;
    const gyroOk = !!muse?.gyroscope?.[0] && (now - muse.gyroscope[0].lastwrite) < 1500;

    const status = `EEG:${eegOk ? 'OK' : '—'}  PPG:${ppgOk ? 'OK' : '—'}  ACC:${accOk ? 'OK' : '—'}  GYRO:${gyroOk ? 'OK' : '—'}`;
    setPill("pStreams", eegOk ? "ok" : "warn", status);

    // Quality runs live; button is optional
    $("btnQuality").disabled = !isConnected || !eegOk;
  }

  // ---------- quality check ----------
  function stddev(arr) {
    if (!arr.length) return NaN;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    let v = 0;
    for (const x of arr) v += (x - mean) * (x - mean);
    return Math.sqrt(v / arr.length);
  }

  function computeQualityIndex(sd) {
    // Same mapping you had, but note: for EEG in microvolts,
    // you may want to tune these constants later.
    const idx = Math.tanh((sd - 30) / 15) * 5 + 5;
    return Math.max(0, Math.min(10, Math.round(idx)));
  }

  function renderQuality(indices) {
    const labels = ["TP9", "AF7", "AF8", "TP10"];
    const grid = $("qGrid");
    grid.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const div = document.createElement("div");
      div.className = "qcell";
      const idx = indices[i];

      let bg = "rgba(73, 209, 127, 0.18)";
      if (idx >= 4) bg = "rgba(255, 209, 102, 0.18)";
      if (idx >= 7) bg = "rgba(255, 107, 107, 0.18)";
      div.style.background = bg;

      div.innerHTML = `<div style="font-weight:700">${labels[i]}</div><div class="muted">idx ${idx}</div>`;
      grid.appendChild(div);
    }
  }

  function startLiveQuality() {
    $("qualityPanel").style.display = "block";
    if (qualityTimer) return; // already running

    setPill("pQuality", "warn", "running");
    qualityStableSince = null;
    qualityPassed = false;

    qualityTimer = setInterval(() => {
      // Wait until we have enough samples (~0.5s) in all channels
      const haveData = eegRoll.every(ch => ch.length >= Math.floor(EEG_SFREQ / 2));
      if (!haveData) {
        renderQuality([10, 10, 10, 10]);
        setPill("pQuality", "warn", "waiting for EEG…");
        $("btnStart").disabled = true;
        return;
      }

      const sds = eegRoll.map(ch => stddev(ch));
      const indices = sds.map(sd => isFinite(sd) ? computeQualityIndex(sd) : 10);
      renderQuality(indices);

      // Pass condition: all channels <= 4 for 2 seconds (slightly forgiving)
      const pass = indices.every(x => x <= 4);
      const now = Date.now();

      if (pass) {
        if (!qualityStableSince) qualityStableSince = now;
        const stableMs = now - qualityStableSince;

        if (stableMs >= 2000) {
          qualityPassed = true;
          setPill("pQuality", "ok", "PASSED");
          $("btnStart").disabled = false;
        } else {
          setPill("pQuality", "warn", `stabilizing (${Math.ceil((2000 - stableMs) / 1000)}s)`);
          $("btnStart").disabled = true;
        }
      } else {
        qualityStableSince = null;
        qualityPassed = false;
        $("btnStart").disabled = true;
        setPill("pQuality", "warn", "adjust electrodes");
      }
    }, 250);
  }

  function runQualityCheck() {
    // Kept for the button, but quality is meant to be live now.
    startLiveQuality();
  }

  // ---------- UI stage helpers ----------
  const stage = $("stage");
  const timerEl = $("timer");

  function showText(lines) {
    stage.style.background = "rgba(0,0,0,0.25)";
    stage.innerHTML = `<div id="stageText" style="font-size:28px;text-align:center;max-width:900px;line-height:1.35"></div>`;
    const el = $("stageText");
    el.innerHTML = Array.isArray(lines) ? lines.map(l => `<div>${l}</div>`).join("") : lines;
  }

  function showSquare(color) {
    stage.innerHTML = "";
    const sq = document.createElement("div");
    sq.style.width = "220px";
    sq.style.height = "220px";
    sq.style.borderRadius = "18px";
    sq.style.background = color;
    stage.appendChild(sq);
  }

  function showBigLetter(letter) {
    stage.innerHTML = `<div style="font-size:160px;font-weight:800;letter-spacing:2px">${letter}</div>`;
  }

  // ---------- upload helpers ----------
  async function listFiles() {
    if (!sessionId) return log("Cannot list files: missing sessionId");
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, { credentials: "include" });
    const txt = await res.text();
    log(`GET /files -> HTTP ${res.status}`);
    log(txt);
  }

  function asFile(contents, filename) {
    const blob = new Blob([contents], { type: "text/csv" });
    return new File([blob], filename, { type: "text/csv" });
  }

  async function uploadPhaseCSVs() {
    if (!sessionId) {
      log("Cannot upload: missing sessionId");
      return;
    }

    log("Uploading phase CSVs...");

    for (const [phase, data] of phaseData.entries()) {
      const fd = new FormData();
      const p = phase.toUpperCase();

      fd.append(`EEG_${p}`, asFile(data.EEG.join("\n") + "\n", `session_${sessionId}_${p}_EEG.csv`));
      fd.append(`PPG_${p}`, asFile(data.PPG.join("\n") + "\n", `session_${sessionId}_${p}_PPG.csv`));
      fd.append(`ACC_${p}`, asFile(data.ACC.join("\n") + "\n", `session_${sessionId}_${p}_ACC.csv`));
      fd.append(`GYRO_${p}`, asFile(data.GYRO.join("\n") + "\n", `session_${sessionId}_${p}_GYRO.csv`));
      fd.append(`MARKERS_${p}`, asFile(data.MARKERS.join("\n") + "\n", `session_${sessionId}_${p}_MARKERS.csv`));
      fd.append(`RESPONSES_${p}`, asFile(data.RESPONSES.join("\n") + "\n", `session_${sessionId}_${p}_RESPONSES.csv`));

      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, {
        method: "POST",
        body: fd,
        credentials: "include"
      });

      const txt = await res.text();
      log(`POST /files (${phase}) -> HTTP ${res.status}`);
      if (!res.ok) {
        log(txt);
        throw new Error(`Upload failed for phase ${phase}`);
      }
    }

    log("Upload complete.");
  }

  // ---------- paradigm ----------
  async function runGoNoGo() {
    currentPhase = "GoNoGo";
    ensurePhase(currentPhase);

    showText([
      "Go/No-Go Task Instructions:",
      "Press SPACE as quickly as possible when you see a GREEN square (Go).",
      "Do NOT respond when you see a RED square (No-Go).",
      "", "Get ready…"
    ]);
    await sleep(2000);

    marker("PHASE_START_GONOGO");

    const durationMs = 120000;
    const stimMs = 500;
    const avgIsiMs = 1200;
    const jitterMaxMs = 500;

    const endAt = Date.now() + durationMs;

    while (Date.now() < endAt) {
      if (abortRequested) throw new Error("Aborted");

      const isGo = Math.random() < 0.7;
      const stimType = isGo ? "Go" : "No-Go";
      showSquare(isGo ? "rgb(0,150,0)" : "rgb(150,0,0)");
      marker(`GoNoGo_${stimType}`);

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
      recordResponse("Go/No-Go", stimType, correct, rtMs);

      showText("");
      const jitter = Math.random() * jitterMaxMs;
      await sleep(avgIsiMs + jitter);
    }

    marker("PHASE_END_GONOGO");
  }

  async function runOneBack() {
    currentPhase = "OneBack";
    ensurePhase(currentPhase);

    showText([
      "1-Back Task Instructions:",
      "A letter will appear.",
      "Press SPACE ONLY if it matches the letter immediately before.",
      "", "Get ready…"
    ]);
    await sleep(2000);

    marker("PHASE_START_ONEBACK");

    const durationMs = 120000;
    const stimMs = 500;
    const avgIsiMs = 1200;
    const jitterMaxMs = 500;

    const stimuli = ["A", "B", "C", "D", "E"];
    let prev = null;

    const endAt = Date.now() + durationMs;

    while (Date.now() < endAt) {
      if (abortRequested) throw new Error("Aborted");

      let letter;
      let isTarget = false;
      if (prev && Math.random() < 0.3) {
        letter = prev;
        isTarget = true;
      } else {
        const choices = prev ? stimuli.filter(x => x !== prev) : stimuli;
        letter = choices[Math.floor(Math.random() * choices.length)];
      }

      showBigLetter(letter);
      marker(`1Back_${isTarget ? "Target" : "NonTarget"}`);

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
      recordResponse("1-Back", isTarget ? "Target" : "Non-Target", correct, rtMs);

      showText("");
      const jitter = Math.random() * jitterMaxMs;
      await sleep(avgIsiMs + jitter);

      prev = letter;
    }

    marker("PHASE_END_ONEBACK");
  }

  async function waitForSpaceOrAbort() {
    return new Promise((resolve, reject) => {
      const onKey = (e) => {
        if (abortRequested) {
          cleanup();
          reject(new Error("Aborted"));
          return;
        }
        if (e.code === "Space" || e.key === " ") {
          cleanup();
          resolve();
        }
      };
      function cleanup() { window.removeEventListener("keydown", onKey); }
      window.addEventListener("keydown", onKey);
    });
  }

  async function countdown(ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (abortRequested) throw new Error("Aborted");
      const left = end - Date.now();
      timerEl.textContent = `${label} — time left ${msToClock(left)}`;
      await sleep(200);
    }
    timerEl.textContent = "—";
  }

  async function runPostural() {
    currentPhase = "Postural";
    ensurePhase(currentPhase);

    const conditions = [
      "Eyes Closed (Both Feet)",
      "Eyes Closed (Left Leg)",
      "Eyes Closed (Right Leg)"
    ];

    showText([
      "Postural Balance Instructions:",
      "You will do three 30-second trials, eyes closed.",
      "1) Both feet", "2) Left leg", "3) Right leg",
      "", "Press SPACE to begin Trial 1"
    ]);

    await waitForSpaceOrAbort();
    marker("PHASE_START_POSTURAL");

    for (let i = 0; i < conditions.length; i++) {
      if (abortRequested) throw new Error("Aborted");
      const c = conditions[i];
      showText([c, "(Hold as still as possible)"]);
      marker(`Postural_${c.replaceAll(' ', '_')}`);

      await countdown(30000, `Postural: ${c}`);

      if (i < conditions.length - 1) {
        showText([`Trial ${i + 1} complete.`, `Prepare for Trial ${i + 2}.`, "Press SPACE when ready."]);
        await waitForSpaceOrAbort();
      }
    }

    marker("PHASE_END_POSTURAL");
  }

  async function runParadigm() {
    abortRequested = false;
    isRunning = true;
    $("btnAbort").disabled = false;
    $("btnStart").disabled = true;
    $("btnConnect").disabled = true;
    $("btnQuality").disabled = true;

    setPill("pRun", "warn", "running");

    if (sessionId) {
      try {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/start`, { method: "POST", credentials: "include" });
      } catch {}
    }

    currentPhase = "Setup";
    ensurePhase(currentPhase);

    showText([
      "Welcome to the Concussion Diagnostic Test.",
      "", "Get comfortable and keep the headset secure.",
      "", "The test will begin shortly…"
    ]);
    marker("WELCOME");
    await countdown(15000, "Welcome");

    showText(["Press SPACE to begin the test."]);
    await waitForSpaceOrAbort();

    try {
      await runGoNoGo();
      await runOneBack();
      await runPostural();

      showText(["Experiment complete.", "Saving data…"]);
      setPill("pRun", "warn", "uploading");

      isRunning = false;
      currentPhase = null;

      await uploadPhaseCSVs();

      if (sessionId) {
        try {
          await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST", credentials: "include" });
        } catch {}
      }

      setPill("pRun", "ok", "complete");
      showText(["All done ✅", "CSVs have been stored for this session."]);
      $("btnAbort").disabled = true;
      $("btnConnect").disabled = false;

      await listFiles();

    } catch (err) {
      isRunning = false;
      currentPhase = null;
      setPill("pRun", "bad", "stopped");
      showText(["Test stopped.", String(err?.message || err)]);
      log(`Run error: ${err}`);
      $("btnAbort").disabled = true;
      $("btnConnect").disabled = false;
    }
  }

  function abort() {
    abortRequested = true;
    setPill("pRun", "bad", "aborting");
    log("Abort requested.");
  }

  // ---------- connect + polling ----------
  async function connectMuse() {
    try {
      setPill("pMuse", "warn", "connecting");
      log("Requesting Muse device… (Web Bluetooth prompt should appear)");
      await muse.connect();
      isConnected = true;
      setPill("pMuse", "ok", "connected");
      log("Muse connected.");

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(consumeMuseBuffers, 50);

      // Quality check runs live automatically now
      startLiveQuality();

      // Button no longer required, but leaving enabled is fine
      $("btnQuality").disabled = false;

    } catch (err) {
      isConnected = false;
      setPill("pMuse", "bad", "failed");
      log("Muse connection failed: " + (err?.message || err));
    }
  }

  // ---------- bind buttons ----------
  $("btnConnect").addEventListener("click", connectMuse);
  $("btnQuality").addEventListener("click", runQualityCheck);
  $("btnStart").addEventListener("click", runParadigm);
  $("btnAbort").addEventListener("click", abort);
  $("btnListFiles").addEventListener("click", listFiles);

  // initial pills
  setPill("pMuse", "bad", "disconnected");
  setPill("pStreams", "warn", "waiting");
  setPill("pQuality", "warn", "not started");
  setPill("pRun", "warn", "idle");

  log("Ready.");
})();
