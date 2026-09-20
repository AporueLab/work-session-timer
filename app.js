(() => {
  "use strict";

  const elements = {
    card: document.querySelector(".timer-card"),
    setupView: document.querySelector("#setup-view"),
    timerView: document.querySelector("#timer-view"),
    completeView: document.querySelector("#complete-view"),
    partsInput: document.querySelector("#parts-input"),
    workInput: document.querySelector("#work-input"),
    breakInput: document.querySelector("#break-input"),
    autoAdvanceInput: document.querySelector("#auto-advance-input"),
    summary: document.querySelector("#session-summary"),
    start: document.querySelector("#start-button"),
    phaseLabel: document.querySelector("#phase-label"),
    countdown: document.querySelector("#countdown"),
    progressLabel: document.querySelector("#progress-label"),
    runningControls: document.querySelector("#running-controls"),
    continueControls: document.querySelector("#continue-controls"),
    pause: document.querySelector("#pause-button"),
    restart: document.querySelector("#restart-button"),
    skip: document.querySelector("#skip-button"),
    stop: document.querySelector("#stop-button"),
    continueButton: document.querySelector("#continue-button"),
    stopWaiting: document.querySelector("#stop-waiting-button"),
    newSession: document.querySelector("#new-session-button"),
    alarm: document.querySelector("#alarm")
  };

  const state = {
    settings: null,
    phases: [],
    phaseIndex: 0,
    status: "setup",
    remainingMs: 0,
    deadline: 0,
    intervalId: null,
    audioContext: null,
    alarmBuffer: null,
    alarmLoadPromise: null,
    alarmPrimingPromise: null
  };

  function boundedNumber(input, minimum, maximum, fallback) {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maximum, Math.max(minimum, value));
  }

  function readSettings() {
    return {
      parts: Math.round(boundedNumber(elements.partsInput, 1, 12, 2)),
      workMinutes: boundedNumber(elements.workInput, 0.01, 180, 30),
      breakMinutes: boundedNumber(elements.breakInput, 0.01, 60, 10),
      automaticAdvance: elements.autoAdvanceInput.checked
    };
  }

  function plural(value, word) {
    return `${value} ${word}${value === 1 ? "" : "s"}`;
  }

  function updateSummary() {
    const settings = readSettings();
    const totalMinutes = (settings.parts * settings.workMinutes) +
      ((settings.parts - 1) * settings.breakMinutes);
    const mode = settings.automaticAdvance ? " · automatic" : "";
    elements.summary.textContent = `${plural(settings.parts, "period")} · ${formatDuration(totalMinutes)}${mode}`;
  }

  function formatDuration(totalMinutes) {
    if (totalMinutes < 60) return `${Math.round(totalMinutes)} min total`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    return minutes ? `${hours} h ${minutes} min total` : `${hours} h total`;
  }

  function buildPhases(settings) {
    const phases = [];
    for (let part = 1; part <= settings.parts; part += 1) {
      phases.push({
        type: "work",
        ordinal: part,
        durationMs: settings.workMinutes * 60_000
      });
      if (part < settings.parts) {
        phases.push({
          type: "break",
          ordinal: part,
          durationMs: settings.breakMinutes * 60_000
        });
      }
    }
    return phases;
  }

  function currentPhase() {
    return state.phases[state.phaseIndex];
  }

  function showOnly(view) {
    elements.setupView.hidden = view !== elements.setupView;
    elements.timerView.hidden = view !== elements.timerView;
    elements.completeView.hidden = view !== elements.completeView;
  }

  function startSession() {
    state.settings = readSettings();
    elements.partsInput.value = state.settings.parts;
    elements.workInput.value = state.settings.workMinutes;
    elements.breakInput.value = state.settings.breakMinutes;
    state.phases = buildPhases(state.settings);
    state.phaseIndex = 0;

    unlockAudio();
    showOnly(elements.timerView);
    beginCurrentPhase();
  }

  function beginCurrentPhase() {
    const phase = currentPhase();
    state.status = "running";
    state.remainingMs = phase.durationMs;
    state.deadline = Date.now() + state.remainingMs;
    elements.pause.textContent = "Pause";
    elements.runningControls.hidden = false;
    elements.continueControls.hidden = true;
    renderPhase();
    startTicking();
  }

  function renderPhase() {
    const phase = currentPhase();
    const isBreak = phase.type === "break";
    elements.card.classList.toggle("break-mode", isBreak);
    elements.phaseLabel.textContent = isBreak
      ? `BREAK AFTER PERIOD ${phase.ordinal}`
      : `WORK PERIOD ${phase.ordinal} OF ${state.settings.parts}`;
    elements.progressLabel.textContent = isBreak
      ? `Next: work period ${phase.ordinal + 1} of ${state.settings.parts}`
      : state.settings.parts === 1
        ? "One focused period"
        : `${state.settings.parts - phase.ordinal} work period${state.settings.parts - phase.ordinal === 1 ? "" : "s"} remaining after this one`;
    renderRemaining();
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderRemaining() {
    const formatted = formatTime(state.remainingMs);
    elements.countdown.textContent = formatted;
    document.title = state.status === "setup"
      ? "Work Session Timer"
      : `${formatted} · ${currentPhase()?.type === "break" ? "Break" : "Work"}`;
  }

  function startTicking() {
    stopTicking();
    tick();
    state.intervalId = window.setInterval(tick, 250);
  }

  function stopTicking() {
    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
  }

  function tick() {
    if (state.status !== "running") return;
    state.remainingMs = Math.max(0, state.deadline - Date.now());
    renderRemaining();
    if (state.remainingMs <= 0) finishPhase();
  }

  function finishPhase() {
    stopTicking();
    state.status = "waiting";
    state.remainingMs = 0;
    renderRemaining();
    playAlarm();

    const isLastPhase = state.phaseIndex === state.phases.length - 1;

    if (state.settings.automaticAdvance) {
      if (isLastPhase) {
        completeSession();
      } else {
        state.phaseIndex += 1;
        beginCurrentPhase();
      }
      return;
    }

    elements.runningControls.hidden = true;
    elements.continueControls.hidden = false;
    elements.continueButton.textContent = isLastPhase ? "Finish session" : "Continue";
    elements.progressLabel.textContent = isLastPhase
      ? "Final work period complete"
      : `${currentPhase().type === "work" ? "Work period" : "Break"} complete · waiting for you`;
    elements.continueButton.focus();
  }

  function togglePause() {
    if (state.status === "running") {
      state.remainingMs = Math.max(0, state.deadline - Date.now());
      state.status = "paused";
      stopTicking();
      elements.pause.textContent = "Resume";
      elements.progressLabel.textContent = "Paused";
      renderRemaining();
      return;
    }

    if (state.status === "paused") {
      state.status = "running";
      state.deadline = Date.now() + state.remainingMs;
      elements.pause.textContent = "Pause";
      renderPhase();
      startTicking();
    }
  }

  function restartPhase() {
    state.remainingMs = currentPhase().durationMs;
    state.status = "running";
    state.deadline = Date.now() + state.remainingMs;
    elements.pause.textContent = "Pause";
    elements.runningControls.hidden = false;
    elements.continueControls.hidden = true;
    renderPhase();
    startTicking();
  }

  function advancePhase() {
    if (state.phaseIndex >= state.phases.length - 1) {
      completeSession();
      return;
    }
    state.phaseIndex += 1;
    beginCurrentPhase();
  }

  function completeSession() {
    stopTicking();
    state.status = "complete";
    elements.card.classList.remove("break-mode");
    showOnly(elements.completeView);
    document.title = "Session complete · Work Timer";
    elements.newSession.focus();
  }

  function stopSession() {
    stopTicking();
    state.status = "setup";
    state.phases = [];
    state.phaseIndex = 0;
    elements.card.classList.remove("break-mode");
    showOnly(elements.setupView);
    document.title = "Work Session Timer";
    updateSummary();
    elements.start.focus();
  }

  function unlockAudio() {
    elements.alarm.load();

    if (!state.alarmPrimingPromise) {
      const originalVolume = elements.alarm.volume;
      elements.alarm.volume = 0;
      elements.alarm.currentTime = 0;

      state.alarmPrimingPromise = elements.alarm.play()
        .then(() => new Promise((resolve) => window.setTimeout(resolve, 100)))
        .then(() => {
          elements.alarm.pause();
          elements.alarm.currentTime = 0;
          elements.alarm.volume = originalVolume;
          return true;
        })
        .catch(() => {
          elements.alarm.pause();
          elements.alarm.currentTime = 0;
          elements.alarm.volume = originalVolume;
          state.alarmPrimingPromise = null;
          return false;
        });
    }

    if (!state.audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) state.audioContext = new AudioContext();
    }

    if (state.audioContext?.state === "suspended") {
      state.audioContext.resume().catch(() => {});
    }

    if (state.audioContext) {
      const silentSource = state.audioContext.createBufferSource();
      silentSource.buffer = state.audioContext.createBuffer(1, 1, state.audioContext.sampleRate);
      silentSource.connect(state.audioContext.destination);
      silentSource.start();
    }

    if (state.audioContext && !state.alarmLoadPromise) {
      const alarmUrl = new URL(elements.alarm.getAttribute("src"), document.baseURI);
      state.alarmLoadPromise = fetch(alarmUrl, { cache: "reload" })
        .then((response) => {
          if (!response.ok) throw new Error(`Alarm request failed: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((audioData) => state.audioContext.decodeAudioData(audioData))
        .then((buffer) => {
          state.alarmBuffer = buffer;
          return buffer;
        })
        .catch(() => null);
    }
  }

  async function playAlarm() {
    if (state.alarmPrimingPromise) {
      await state.alarmPrimingPromise;
    }

    try {
      elements.alarm.currentTime = 0;
      await elements.alarm.play();
      return;
    } catch {
      // Try the decoded Web Audio copy before using the generated fallback tone.
    }

    const context = state.audioContext;

    if (context) {
      if (context.state === "suspended") {
        await context.resume().catch(() => {});
      }

      if (state.alarmLoadPromise) {
        await state.alarmLoadPromise;
      }

      if (state.alarmBuffer && context.state === "running") {
        const source = context.createBufferSource();
        source.buffer = state.alarmBuffer;
        source.connect(context.destination);
        source.start();
        return;
      }
    }

    await playFallbackTone();
  }

  async function playFallbackTone() {
    const context = state.audioContext;
    if (!context) return;

    if (context.state === "suspended") {
      await context.resume().catch(() => {});
    }

    if (context.state !== "running") return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.65);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.7);
  }

  [elements.partsInput, elements.workInput, elements.breakInput, elements.autoAdvanceInput].forEach((input) => {
    input.addEventListener("input", updateSummary);
    input.addEventListener("change", updateSummary);
  });
  elements.start.addEventListener("click", startSession);
  elements.pause.addEventListener("click", togglePause);
  elements.restart.addEventListener("click", restartPhase);
  elements.skip.addEventListener("click", advancePhase);
  elements.stop.addEventListener("click", stopSession);
  elements.continueButton.addEventListener("click", advancePhase);
  elements.stopWaiting.addEventListener("click", stopSession);
  elements.newSession.addEventListener("click", stopSession);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.status === "running") tick();
  });

  updateSummary();

  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
