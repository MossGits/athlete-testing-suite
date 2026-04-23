/*
  testRunner.js
  - Connects to Muse via /js/muse/Muse.js (Web Bluetooth)
  - Runs electrode quality check (JS port of quality_check.py)
  - Opens experimental paradigm in a separate fullscreen-capable popup (dark)
  - Records EEG/PPG/ACC/GYRO + markers + responses in the controller window
  - Uploads per-phase CSVs to Spring Boot via /api/sessions/{id}/files (multipart)
*/

(function () {
  const qs = new URLSearchParams(location.search);
  const sessionId = qs.get("sessionId");
  const athleteId = qs.get("athleteId");
  const athleteLabel = qs.get("athleteLabel");
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

  function setPill(pillId, colorClass, text) {
    const pill = $(pillId);
    if (!pill) return;
    const dot = pill.querySelector("span");
    const strong = pill.querySelector("strong");
    if (dot) dot.className = colorClass;
    if (strong) strong.textContent = text;
  }

  function fallbackInitialsFromAthleteId(value) {
    if (!value) return "—";
    const s = String(value).trim();
    if (!s) return "—";
    return s.slice(0, 2).toUpperCase();
  }

  function qualityClassFromIndex(idx) {
    if (idx <= 7) return "status-good";
    if (idx <= 9) return "status-warn";
    return "status-bad";
  }

  function setSensorDot(dotId, idx) {
    const el = $(dotId);
    if (!el) return;

    el.classList.remove("status-good", "status-warn", "status-bad");
    el.classList.add("sensorDot", qualityClassFromIndex(idx));
  }

  if ($("sessionId")) $("sessionId").textContent = sessionId || "(missing)";
  if ($("athleteId")) $("athleteId").textContent = athleteLabel || fallbackInitialsFromAthleteId(athleteId);
  if ($("mode")) $("mode").textContent = mode;

  if (!sessionId) log("Missing sessionId in query string. Expected ?sessionId=...&athleteId=...&mode=...");

  const bcName = sessionId ? `athlete-paradigm-${sessionId}` : null;
  const bc = (bcName && typeof BroadcastChannel !== "undefined") ? new BroadcastChannel(bcName) : null;
  const storageKey = bcName ? `paradigm-msg-${bcName}` : null;

  const seen = new Map();
  function seenRecently(signature, windowMs = 2000) {
    const now = Date.now();
    for (const [k, t] of seen.entries()) if (now - t > windowMs) seen.delete(k);
    if (seen.has(signature)) return true;
    seen.set(signature, now);
    return false;
  }

  function signatureFor(msg) {
    const p = msg?.payload;
    if (!msg) return "null";
    if (msg.type === "marker") return `marker:${p?.marker ?? ""}`;
    if (msg.type === "phaseStart") return `phaseStart:${p?.phase ?? ""}`;
    if (msg.type === "phaseEnd") return `phaseEnd:${p?.phase ?? ""}`;
    if (msg.type === "configAck") return "configAck";
    if (msg.type === "hello") return "hello";
    if (msg.type === "done") return "done";
    if (msg.type === "aborted") return `aborted:${p?.reason ?? ""}`;
    if (msg.type === "response") return `resp:${p?.task ?? ""}:${p?.stimulus ?? ""}:${p?.rtMs ?? ""}:${p?.correct ?? ""}`;
    return `${msg.type}:${JSON.stringify(p ?? {})}`;
  }

  function sendToParadigm(type, payload = {}) {
    const msg = { source: "CONTROLLER", type, payload };
    if (bc) {
      try { bc.postMessage(msg); return; } catch {}
    }
    if (paradigmWin && !paradigmWin.closed) {
      try { paradigmWin.postMessage(msg, "*"); return; } catch {}
    }
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify({ ts: Date.now(), ...msg })); } catch {}
    }
  }

  const muse = new Muse();
  const EEG_SFREQ = 256;
  const EEG_CH = 4;
  const eegRoll = Array.from({ length: EEG_CH }, () => []);
  const ppgRoll = [[], [], []];
  const accRoll = [[], [], []];
  const gyroRoll = [[], [], []];

  let isConnected = false;
  let pollTimer = null;

  let qualityTimer = null;
  let qualityStableSince = null;
  let qualityPassed = false;

  let isRunning = false;
  let abortRequested = false;

  let lastEegTs = null;
  const EEG_DT_MS = 1000 / EEG_SFREQ;

  const phaseData = new Map();
  let currentPhase = null;

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

  let lastMarker = null;
  let lastMarkerAt = 0;

  function marker(m) {
    const now = Date.now();
    if (m === lastMarker && (now - lastMarkerAt) < 50) return;
    lastMarker = m;
    lastMarkerAt = now;

    if (currentPhase) ensurePhase(currentPhase).MARKERS.push(`${now},${m}`);
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

    while (true) {
      if (!muse?.eeg || muse.eeg.length < 4) break;
      const v = [muse.eeg[0].read(), muse.eeg[1].read(), muse.eeg[2].read(), muse.eeg[3].read()];
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

    while (true) {
      if (!muse?.ppg || muse.ppg.length < 3) break;
      const v = [muse.ppg[0].read(), muse.ppg[1].read(), muse.ppg[2].read()];
      if (v.some(x => x === null)) break;
      for (let i = 0; i < 3; i++) { ppgRoll[i].push(v[i]); trimTo(ppgRoll[i], 256); }
      if (isRunning && currentPhase) ensurePhase(currentPhase).PPG.push(`${Date.now()},${v[0]},${v[1]},${v[2]}`);
    }

    while (true) {
      if (!muse?.accelerometer || muse.accelerometer.length < 3) break;
      const v = [muse.accelerometer[0].read(), muse.accelerometer[1].read(), muse.accelerometer[2].read()];
      if (v.some(x => x === null)) break;
      for (let i = 0; i < 3; i++) { accRoll[i].push(v[i]); trimTo(accRoll[i], 256); }
      if (isRunning && currentPhase) ensurePhase(currentPhase).ACC.push(`${Date.now()},${v[0]},${v[1]},${v[2]}`);
    }

    while (true) {
      if (!muse?.gyroscope || muse.gyroscope.length < 3) break;
      const v = [muse.gyroscope[0].read(), muse.gyroscope[1].read(), muse.gyroscope[2].read()];
      if (v.some(x => x === null)) break;
      for (let i = 0; i < 3; i++) { gyroRoll[i].push(v[i]); trimTo(gyroRoll[i], 256); }
      if (isRunning && currentPhase) ensurePhase(currentPhase).GYRO.push(`${Date.now()},${v[0]},${v[1]},${v[2]}`);
    }

    const eegOk = !!muse?.eeg?.[0] && (now - muse.eeg[0].lastwrite) < 1500;
    const ppgOk = !!muse?.ppg?.[0] && (now - muse.ppg[0].lastwrite) < 1500;
    const accOk = !!muse?.accelerometer?.[0] && (now - muse.accelerometer[0].lastwrite) < 1500;
    const gyroOk = !!muse?.gyroscope?.[0] && (now - muse.gyroscope[0].lastwrite) < 1500;

    const streamsActive = eegOk || ppgOk || accOk || gyroOk;
    setPill("pStreams", streamsActive ? "ok" : "warn", streamsActive ? "active" : "waiting");
  }

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
    if (!Array.isArray(indices) || indices.length < 4) return;

    setSensorDot("dot-left-ear", indices[0]);
    setSensorDot("dot-left-forehead", indices[1]);
    setSensorDot("dot-right-forehead", indices[2]);
    setSensorDot("dot-right-ear", indices[3]);
  }

  function startLiveQuality() {
    const qp = $("qualityPanel");
    if (qp) qp.style.display = "block";
    if (qualityTimer) return;

    setPill("pQuality", "warn", "running");
    qualityStableSince = null;
    qualityPassed = false;

    qualityTimer = setInterval(() => {
      const haveData = eegRoll.every(ch => ch.length >= Math.floor(EEG_SFREQ / 2));
      if (!haveData) {
        renderQuality([10, 10, 10, 10]);
        setPill("pQuality", "warn", "waiting");
        const bs = $("btnStart");
        if (bs) bs.disabled = true;
        return;
      }

      const sds = eegRoll.map(ch => stddev(ch));
      const indices = sds.map(sd => isFinite(sd) ? computeQualityIndex(sd) : 10);
      renderQuality(indices);

      const pass = indices.every(x => x <= 7);
      const now = Date.now();

      const bs = $("btnStart");
      if (pass) {
        if (!qualityStableSince) qualityStableSince = now;
        const stableMs = now - qualityStableSince;
        if (stableMs >= 2000) {
          qualityPassed = true;
          setPill("pQuality", "ok", "ready");
          if (bs) bs.disabled = false;
        } else {
          setPill("pQuality", "warn", "checking");
          if (bs) bs.disabled = true;
        }
      } else {
        qualityStableSince = null;
        qualityPassed = false;
        if (bs) bs.disabled = true;
        setPill("pQuality", "warn", "adjusting");
      }
    }, 250);
  }

  function asFile(contents, filename) {
    const blob = new Blob([contents], { type: "text/csv" });
    return new File([blob], filename, { type: "text/csv" });
  }

  function rowsToCsv(lines) {
    return lines.join("\n") + "\n";
  }

  function filterCsvLinesByWindow(lines, startMs, endMs) {
    if (!Array.isArray(lines) || lines.length === 0) return "";
    const header = lines[0];
    const out = [header];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const commaIdx = line.indexOf(",");
      if (commaIdx < 0) continue;

      const t = Number(line.slice(0, commaIdx).trim());
      if (!Number.isFinite(t)) continue;

      if (t >= startMs && t < endMs) {
        out.push(line);
      }
    }

    return rowsToCsv(out);
  }

  function buildPosturalWindows(markerLines) {
    const events = [];

    for (let i = 1; i < markerLines.length; i++) {
      const line = markerLines[i];
      if (!line || !line.trim()) continue;

      const commaIdx = line.indexOf(",");
      if (commaIdx < 0) continue;

      const t = Number(line.slice(0, commaIdx).trim());
      const marker = line.slice(commaIdx + 1).trim();

      if (!Number.isFinite(t) || !marker) continue;
      events.push({ t, marker });
    }

    events.sort((a, b) => a.t - b.t);

    const both = events.find(e => e.marker === "Postural_Both_Feet");
    const left = events.find(e => e.marker === "Postural_Left_Leg");
    const right = events.find(e => e.marker === "Postural_Right_Leg");
    const phaseEnd = events.find(e => e.marker === "PHASE_END_POSTURAL");

    if (!both || !left || !right) {
      throw new Error("Could not split POSTURAL phase: missing posture markers.");
    }

    return [
      { suffix: "POSTURALBOTH", startMs: both.t, endMs: left.t },
      { suffix: "POSTURALLEFT", startMs: left.t, endMs: right.t },
      { suffix: "POSTURALRIGHT", startMs: right.t, endMs: phaseEnd ? phaseEnd.t : Number.MAX_SAFE_INTEGER }
    ];
  }

  async function uploadPhaseCSVs() {
    if (!sessionId) throw new Error("Missing sessionId");
    log("Uploading phase CSVs...");

    for (const [phase, data] of phaseData.entries()) {
      const p = phase.toUpperCase();

      if (p === "POSTURAL") {
        const markerLines = data.MARKERS || [];
        const windows = buildPosturalWindows(markerLines);

        for (const w of windows) {
          const fd = new FormData();

          fd.append(`EEG_${w.suffix}`, asFile(filterCsvLinesByWindow(data.EEG, w.startMs, w.endMs), `session_${sessionId}_EEG_${w.suffix}.csv`));
          fd.append(`PPG_${w.suffix}`, asFile(filterCsvLinesByWindow(data.PPG, w.startMs, w.endMs), `session_${sessionId}_PPG_${w.suffix}.csv`));
          fd.append(`ACC_${w.suffix}`, asFile(filterCsvLinesByWindow(data.ACC, w.startMs, w.endMs), `session_${sessionId}_ACC_${w.suffix}.csv`));
          fd.append(`GYRO_${w.suffix}`, asFile(filterCsvLinesByWindow(data.GYRO, w.startMs, w.endMs), `session_${sessionId}_GYRO_${w.suffix}.csv`));

          const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, {
            method: "POST",
            body: fd,
            credentials: "include"
          });

          const txt = await res.text();
          log(`POST /files (${w.suffix}) -> HTTP ${res.status}`);
          if (!res.ok) {
            log(txt);
            throw new Error(`Upload failed for postural segment ${w.suffix}`);
          }
        }

        {
          const fd = new FormData();

          fd.append(`MARKERS_POSTURAL`, asFile(rowsToCsv(data.MARKERS), `session_${sessionId}_POSTURAL_MARKERS.csv`));
          fd.append(`RESPONSES_POSTURAL`, asFile(rowsToCsv(data.RESPONSES), `session_${sessionId}_POSTURAL_RESPONSES.csv`));

          const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, {
            method: "POST",
            body: fd,
            credentials: "include"
          });

          const txt = await res.text();
          log(`POST /files (POSTURAL_MARKERS_RESPONSES) -> HTTP ${res.status}`);
          if (!res.ok) {
            log(txt);
            throw new Error("Upload failed for postural markers/responses");
          }
        }

        continue;
      }

      const fd = new FormData();

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
    setPill("pRun", "warn", "uploading");
    isRunning = false;
    currentPhase = null;

    await uploadPhaseCSVs();

    if (sessionId) {
      try { await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST", credentials: "include" }); } catch {}
    }

    setPill("pRun", "ok", "complete");

    if (paradigmWin && !paradigmWin.closed) {
      try { paradigmWin.close(); } catch {}
    }

    const bcBtn = $("btnConnect");
    if (bcBtn) bcBtn.disabled = false;
  }

  function stopRunFromPopup(reason) {
    isRunning = false;
    currentPhase = null;
    setPill("pRun", "bad", "stopped");
    log(reason || "Stopped");
    const bcBtn = $("btnConnect");
    if (bcBtn) bcBtn.disabled = false;
  }

  let configAcked = false;
  let retryTimer = null;

  function sendConfigToParadigm() {
    if (configAcked) return;
    sendToParadigm("config", {
      goNoGoDurationMs: 15000,
      oneBackDurationMs: 15000,
      posturalTrialMs: 15000,
      stimSec: 0.5,
      avgIsiSec: 1.2,
      jitterMaxSec: 0.5,
      welcomeMs: 2000,
      startBannerMs: 500,
      endSavingMs: 500,
      endSavedMs: 500
    });
  }

  function handleParadigmMessage(msg) {
    if (!msg || msg.source !== "PARADIGM") return;

    const sig = signatureFor(msg);
    if (seenRecently(sig)) return;

    log(`RX PARADIGM: ${msg.type}`);

    if (msg.type === "hello") {
      sendConfigToParadigm();
      return;
    }

    if (msg.type === "configAck") {
      configAcked = true;
      log("Paradigm received config.");
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      return;
    }

    if (msg.type === "phaseStart") {
      currentPhase = msg.payload?.phase || "UNKNOWN";
      ensurePhase(currentPhase);
      return;
    }

    if (msg.type === "phaseEnd") return;

    if (msg.type === "marker") {
      marker(msg.payload?.marker);
      return;
    }

    if (msg.type === "response") {
      const r = msg.payload || {};
      recordResponse(r.task, r.stimulus, !!r.correct, r.rtMs);
      return;
    }

    if (msg.type === "done") {
      finishRunFromPopup().catch(e => {
        log(`finishRunFromPopup error: ${e?.message || e}`);
        stopRunFromPopup(`Upload error: ${e?.message || e}`);
      });
      return;
    }

    if (msg.type === "aborted") {
      abortRequested = true;
      stopRunFromPopup(`Paradigm aborted: ${msg.payload?.reason || "unknown"}`);
      if (paradigmWin && !paradigmWin.closed) {
        try { paradigmWin.close(); } catch {}
      }
      return;
    }
  }

  window.addEventListener("message", (ev) => handleParadigmMessage(ev.data));

  if (bc) {
    bc.onmessage = (ev) => handleParadigmMessage(ev.data);
  }

  if (storageKey) {
    window.addEventListener("storage", (ev) => {
      if (ev.key !== storageKey || !ev.newValue) return;
      try {
        const msg = JSON.parse(ev.newValue);
        handleParadigmMessage(msg);
      } catch {}
    });
  }

  async function runParadigm() {
    abortRequested = false;
    isRunning = true;
    configAcked = false;

    const bs = $("btnStart");
    const bcBtn = $("btnConnect");

    if (bs) bs.disabled = true;
    if (bcBtn) bcBtn.disabled = true;

    setPill("pRun", "warn", "running");

    if (sessionId) {
      try { await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/start`, { method: "POST", credentials: "include" }); } catch {}
    }

    currentPhase = "Setup";
    ensurePhase(currentPhase);
    marker("WELCOME");

    const url = `/paradigm.html?bc=${encodeURIComponent(bcName || "")}`;
    const w = window.open(url, "paradigmWindow", "popup=yes,width=1200,height=800");
    if (!w) {
      stopRunFromPopup("Popup blocked. Allow popups for this site.");
      return;
    }
    paradigmWin = w;

    try { w.moveTo(0, 0); w.resizeTo(screen.availWidth, screen.availHeight); } catch {}

    let tries = 0;
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    retryTimer = setInterval(() => {
      tries++;
      if (configAcked) { clearInterval(retryTimer); retryTimer = null; return; }
      if (!paradigmWin || paradigmWin.closed) { clearInterval(retryTimer); retryTimer = null; return; }
      sendConfigToParadigm();
      if (tries >= 10) { clearInterval(retryTimer); retryTimer = null; }
    }, 200);

    log("Paradigm opened. Waiting for configAck...");
  }

  async function connectMuse() {
    try {
      setPill("pMuse", "warn", "connecting");
      log("Requesting Muse device…");
      await muse.connect();
      isConnected = true;
      setPill("pMuse", "ok", "connected");
      log("Muse connected.");

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(consumeMuseBuffers, 50);

      startLiveQuality();

    } catch (err) {
      isConnected = false;
      setPill("pMuse", "bad", "failed");
      log("Muse connection failed: " + (err?.message || err));
    }
  }

  const btnConnect = $("btnConnect");
  const btnStart = $("btnStart");

  if (btnConnect) btnConnect.addEventListener("click", connectMuse);
  if (btnStart) btnStart.addEventListener("click", runParadigm);

  setPill("pMuse", "bad", "disconnected");
  setPill("pStreams", "warn", "waiting");
  setPill("pQuality", "warn", "not started");
  setPill("pRun", "warn", "idle");

  log("Ready.");
})();
