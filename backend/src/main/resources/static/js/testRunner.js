/*
  testRunner.js
  - Connects to Muse via /js/muse/Muse.js (Web Bluetooth)
  - Runs electrode quality check (JS port of quality_check.py)
  - Opens experimental paradigm in a separate fullscreen-capable popup (dark)
  - Records EEG/PPG/ACC/GYRO + markers + responses in the controller window
  - Uploads per-phase CSVs to Spring Boot via /api/sessions/{id}/files (multipart)
  - NEW: Uses BroadcastChannel (same-origin) so messaging still works even if window.opener becomes null
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
    if (debugEl) {
      debugEl.textContent = (debugEl.textContent ? debugEl.textContent + "\n" : "") + line;
      debugEl.scrollTop = debugEl.scrollHeight;
    }
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

  // ---------- NEW: BroadcastChannel (robust messaging) ----------
  const bcName = `athlete-paradigm-${sessionId || "nosession"}`;
  const bc = (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel(bcName) : null;

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
  const phaseData = new Map();
  let currentPhase = null;

  // Paradigm popup reference
  let paradigmWin = null;

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

  async function finishRunFromPopup() {
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
  }

  function stopRunFromPopup(reason) {
    isRunning = false;
    currentPhase = null;
    setPill("pRun", "bad", "stopped");
    showText(["Test stopped.", reason || "Stopped"]);
    $("btnAbort").disabled = true;
    $("btnConnect").disabled = false;
  }

  // ---------- NEW: send to paradigm via BOTH BC and postMessage ----------
  function sendToParadigm(type, payload = {}) {
    const msg = { source: "CONTROLLER", type, payload };

    if (bc) {
      try { bc.postMessage(msg); } catch {}
    }

    if (paradigmWin && !paradigmWin.closed) {
      try { paradigmWin.postMessage(msg, "*"); } catch {}
    }
  }

  function sendConfigToParadigm() {
    sendToParadigm("config", {
      goNoGoDurationMs: 120000,
      oneBackDurationMs: 120000,
      posturalTrialMs: 30000,
      stimMs: 500,
      avgIsiMs: 1200,
      jitterMaxMs: 500
    });
  }

  // ---------- NEW: handle paradigm messages from BOTH postMessage and BroadcastChannel ----------
  function handleParadigmMessage(msg) {
    if (!msg || msg.source !== "PARADIGM") return;

    if (msg.type === "hello") {
      log("Paradigm says hello — sending config.");
      sendConfigToParadigm();
      return;
    }

    if (msg.type === "configAck") {
      log("Paradigm received config.");
      return;
    }

    if (msg.type === "phaseStart") {
      currentPhase = msg.payload.phase;
      ensurePhase(currentPhase);
      log(`Paradigm phaseStart: ${currentPhase}`);
      return;
    }

    if (msg.type === "phaseEnd") {
      log(`Paradigm phaseEnd: ${msg.payload.phase}`);
      return;
    }

    if (msg.type === "marker") {
      marker(msg.payload.marker);
      return;
    }

    if (msg.type === "response") {
      const r = msg.payload;
      recordResponse(r.task, r.stimulus, !!r.correct, r.rtMs);
      return;
    }

    if (msg.type === "done") {
      finishRunFromPopup()
        .then(() => {
          // Option B: close the paradigm window after uploads complete
          if (paradigmWin && !paradigmWin.closed) {
            try { paradigmWin.close(); } catch {}
          }
        })
        .catch(e => log(`finishRunFromPopup error: ${e}`));
      return;
    }

    if (msg.type === "aborted") {
      abortRequested = true;
      log(`Paradigm aborted: ${msg.payload?.reason || "unknown"}`);

      if (paradigmWin && !paradigmWin.closed) {
        try { paradigmWin.close(); } catch {}
      }

      stopRunFromPopup(`Paradigm aborted: ${msg.payload?.reason || "unknown"}`);
      return;
    }
  }

  // postMessage path
  window.addEventListener("message", (ev) => {
    handleParadigmMessage(ev.data);
  });

  // BroadcastChannel path
  if (bc) {
    bc.onmessage = (ev) => {
      handleParadigmMessage(ev.data);
    };
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

    // Setup phase for any pre-start markers
    currentPhase = "Setup";
    ensurePhase(currentPhase);
    marker("WELCOME");

    // NEW: include bc name so popup can use BroadcastChannel reliably
    const url = `/paradigm.html?bc=${encodeURIComponent(bcName)}`;

    const w = window.open(
      url,
      "paradigmWindow",
      "popup=yes,width=1200,height=800"
    );

    if (!w) {
      stopRunFromPopup("Popup blocked. Allow popups for this site.");
      return;
    }

    paradigmWin = w;

    // Try to maximize popup (fullscreen itself is requested inside the popup)
    try {
      w.moveTo(0, 0);
      w.resizeTo(screen.availWidth, screen.availHeight);
    } catch {}

    // Retry config a few times for robustness
    let tries = 0;
    const retry = setInterval(() => {
      tries++;
      if (!paradigmWin || paradigmWin.closed) { clearInterval(retry); return; }
      sendConfigToParadigm();
      if (tries >= 10) clearInterval(retry); // ~2 seconds
    }, 200);

    showText([
      "Paradigm opened in a separate window.",
      "",
      "If fullscreen didn’t start, click inside the paradigm window and press Start Fullscreen."
    ]);
  }

  function abort() {
    abortRequested = true;
    setPill("pRun", "bad", "aborting");
    log("Abort requested.");

    // Ask the paradigm to abort (via both BC and postMessage), then close it
    sendToParadigm("abort", {});
    if (paradigmWin && !paradigmWin.closed) {
      try { paradigmWin.close(); } catch {}
    }

    stopRunFromPopup("Aborted by user.");
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
