(() => {
  const defaults = { name: 'INLINE PLANK', prepare: 5, work: 50, rest: 15, rounds: 4, cooldown: 0 };
  const defaultColors = { prepare: 'yellow', work: 'green', rest: 'red', rounds: 'blue', cooldown: 'blue' };
  const labels = { prepare: 'PREPARE', work: 'WORK', rest: 'REST', cooldown: 'COOLDOWN', done: 'WORKOUT COMPLETE' };
  const colors = { prepare: 'yellow', work: 'green', rest: 'red', cooldown: 'blue', done: 'yellow' };
  const $ = (id) => document.getElementById(id);
  const app = $('timerApp');
  const nameInput = $('workoutName');
  const phaseLabel = $('phaseLabel');
  const countdown = $('countdown');
  const totalTime = $('totalTime');
  const nextLabel = $('nextLabel');
  const nextTime = $('nextTime');
  const nextSection = $('nextSection');
  const roundsLeft = $('roundsLeft');
  const playButton = $('playButton');
  const playCaption = $('playCaption');
  const announcement = $('announcement');
  const toast = $('toast');
  const storageKey = 'sporttimer-home-v5';
  let config = { ...defaults };
  let phases = [];
  let phaseIndex = 0;
  let phaseDeadline = 0;
  let pausedRemaining = null;
  let running = false;
  let timerId = 0;
  let toastId = 0;
  let audioContext = null;
  let scheduledSounds = [];
  let wakeLock = null;
  let audioBlocked = false;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.config) {
      config = { ...defaults, ...saved.config };
    } else {
      for (const previousKey of ['sporttimer-home-v4', 'sporttimer-home-v3', 'sporttimer-home-v2', 'sporttimer-home-v1']) {
        const previous = JSON.parse(localStorage.getItem(previousKey) || 'null');
        if (typeof previous?.config?.name === 'string') {
          config.name = previous.config.name;
          break;
        }
      }
    }
    if (typeof config.name !== 'string') config.name = defaults.name;
  } catch { /* Keep the defaults when local storage is unavailable. */ }
  config.colors = { ...defaultColors, ...config.colors };
  nameInput.value = config.name;

  const sec = (value) => Math.max(0, Math.round(Number(value) || 0));
  const format = (seconds) => {
    const safe = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  };

  function buildPhases() {
    const list = [];
    if (sec(config.prepare) > 0) list.push({ type: 'prepare', seconds: sec(config.prepare), round: 1 });
    for (let round = 1; round <= Math.max(1, sec(config.rounds)); round += 1) {
      if (sec(config.work) > 0) list.push({ type: 'work', seconds: sec(config.work), round });
      if (round < Math.max(1, sec(config.rounds)) && sec(config.rest) > 0) list.push({ type: 'rest', seconds: sec(config.rest), round });
    }
    list.push({ type: 'cooldown', seconds: sec(config.cooldown), round: Math.max(1, sec(config.rounds)) });
    return list;
  }

  function currentRemaining(now = Date.now()) {
    if (!running) return pausedRemaining ?? phases[phaseIndex]?.seconds ?? 0;
    return Math.max(0, (phaseDeadline - now) / 1000);
  }

  function totalRemaining(now = Date.now()) {
    if (!phases.length || phaseIndex >= phases.length) return 0;
    const current = currentRemaining(now);
    return current + phases.slice(phaseIndex + 1).reduce((sum, phase) => sum + phase.seconds, 0);
  }

  function nextPhase(index) {
    return phases[index + 1] || null;
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ config, running, phaseIndex, phaseDeadline, pausedRemaining, savedAt: Date.now() }));
    } catch { /* The timer remains usable if storage is blocked. */ }
  }

  function render(now = Date.now()) {
    const phase = phases[phaseIndex] || { type: 'done', seconds: 0, round: 0 };
    const remaining = currentRemaining(now);
    const currentType = running || phaseIndex < phases.length ? phase.type : 'done';
    app.dataset.phase = currentType;
    app.style.setProperty('--phase', `var(--${config.colors[currentType] || 'yellow'})`);
    roundsLeft.style.color = `var(--${config.colors.rounds})`;
    phaseLabel.textContent = labels[currentType] || labels.done;
    countdown.textContent = format(remaining);
    totalTime.textContent = format(totalRemaining(now));
    const next = currentType === 'done' ? null : nextPhase(phaseIndex);
    nextSection.classList.toggle('is-empty', !next);
    nextSection.dataset.phase = next?.type || 'done';
    nextSection.style.backgroundColor = next ? `var(--${config.colors[next.type]})` : '';
    nextLabel.textContent = next ? labels[next.type] : 'ALL DONE';
    nextTime.textContent = next ? format(next.seconds) : '—';
    roundsLeft.textContent = currentType === 'done' ? '0' : String(Math.max(0, sec(config.rounds) - (phase.type === 'work' || phase.type === 'rest' ? phase.round - 1 : phase.type === 'cooldown' ? sec(config.rounds) : 0)));
    $('phaseHint').textContent = currentType === 'prepare' ? 'GET READY' : currentType === 'done' ? 'GREAT WORK' : '';
    playCaption.textContent = currentType === 'done' ? 'DONE' : running ? 'PAUSE' : phaseIndex > 0 ? 'RESUME' : 'START';
    playButton.setAttribute('aria-label', currentType === 'done' ? '训练完成' : running ? '暂停训练' : phaseIndex > 0 ? '继续训练' : '开始训练');
    app.classList.toggle('is-running', running);
  }

  function cancelScheduledSounds() {
    if (!audioContext) return;
    for (const sound of scheduledSounds) {
      try { sound.stop(audioContext.currentTime); } catch { /* It may already have played. */ }
      try { sound.disconnect(); } catch { /* Already disconnected. */ }
    }
    scheduledSounds = [];
  }

  function beep(at, type, finalSecond = false) {
    if (!audioContext || at < audioContext.currentTime) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = type === 'work' ? (finalSecond ? 900 : 640) : type === 'rest' ? 430 : 760;
    const duration = finalSecond ? 0.28 : 0.12;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(finalSecond ? 0.23 : 0.13, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    scheduledSounds.push(oscillator);
  }

  function prepareAudioSchedule(startAt) {
    if (!audioContext) return;
    cancelScheduledSounds();
    const timeline = [];
    let cursor = startAt;
    for (let i = phaseIndex; i < phases.length; i += 1) {
      const phase = phases[i];
      const duration = i === phaseIndex ? currentRemaining(Date.now()) : phase.seconds;
      if (duration <= 0) continue;
      const startsNow = i === phaseIndex && cursor <= audioContext.currentTime + 0.1;
      if (!startsNow) beep(cursor, phase.type, true);
      const countdownCues = duration > 5 ? 5 : duration > 3 ? 3 : 0;
      if (countdownCues > 0) {
        for (let n = countdownCues; n >= 1; n -= 1) {
          const cueAt = cursor + duration - n;
          if (cueAt > audioContext.currentTime + 0.03) beep(cueAt, phase.type, n === 1);
        }
      }
      cursor += duration;
    }
  }

  async function enableAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === 'suspended') await audioContext.resume();
      audioBlocked = audioContext.state !== 'running';
    } catch {
      audioBlocked = true;
    }
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || !running) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); }
    catch { wakeLock = null; }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try { await wakeLock.release(); } catch { /* System may release it first. */ }
    wakeLock = null;
  }

  function start() {
    if (phaseIndex >= phases.length) reset(false);
    if (!phases.length || phaseIndex >= phases.length) return;
    running = true;
    const now = Date.now();
    const firstDuration = pausedRemaining ?? phases[phaseIndex].seconds;
    phaseDeadline = now + firstDuration * 1000;
    pausedRemaining = null;
    enableAudio().then(() => {
      if (running) {
        prepareAudioSchedule(audioContext.currentTime);
        if (audioBlocked) showToast('浏览器未允许播放声音，请再次点击开始');
      }
    });
    timerId = window.setInterval(tick, 100);
    requestWakeLock();
    render();
    save();
  }

  function pause() {
    if (!running) return;
    tick();
    if (!running) return;
    pausedRemaining = currentRemaining();
    phaseDeadline = Date.now() + pausedRemaining * 1000;
    running = false;
    window.clearInterval(timerId);
    timerId = 0;
    cancelScheduledSounds();
    releaseWakeLock();
    render();
    save();
  }

  function finish() {
    announcement.textContent = '训练完成';
    reset(false);
  }

  function tick() {
    if (!running) return;
    const now = Date.now();
    let moved = false;
    while (phaseIndex < phases.length && now >= phaseDeadline) {
      phaseIndex += 1;
      moved = true;
      pausedRemaining = null;
      while (phaseIndex < phases.length && phases[phaseIndex].seconds === 0) phaseIndex += 1;
      if (phaseIndex >= phases.length) { finish(); return; }
      phaseDeadline += phases[phaseIndex].seconds * 1000;
      announcement.textContent = `${labels[phases[phaseIndex].type]}，${format(phases[phaseIndex].seconds)}`;
    }
    if (moved) {
      save();
    }
    render(now);
  }

  function reset(showMessage = true) {
    running = false;
    window.clearInterval(timerId);
    timerId = 0;
    cancelScheduledSounds();
    releaseWakeLock();
    phases = buildPhases();
    phaseIndex = 0;
    pausedRemaining = null;
    while (phaseIndex < phases.length && phases[phaseIndex].seconds === 0) phaseIndex += 1;
    phaseDeadline = 0;
    if (phaseIndex >= phases.length) phaseIndex = phases.length - 1;
    render();
    save();
    if (showMessage) showToast('训练已重置');
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastId);
    toastId = window.setTimeout(() => toast.classList.remove('visible'), 2100);
  }

  playButton.addEventListener('click', () => running ? pause() : start());
  $('resetButton').addEventListener('click', () => reset());
  const intervalsPage = $('intervalsPage');
  const pickerPage = $('pickerPage');
  let draftConfig = null;
  let editingType = null;
  let editingColor = null;
  const wheels = [...pickerPage.querySelectorAll('.picker-wheel')];
  function renderIntervals() {
    for (const type of ['prepare', 'work', 'rest', 'cooldown']) {
      const value = format(sec(draftConfig[type]));
      $(`setting${type[0].toUpperCase()}${type.slice(1)}`).textContent = value.startsWith('00:') ? value.slice(2) : value;
    }
    $('settingRounds').textContent = String(sec(draftConfig.rounds));
    intervalsPage.querySelectorAll('[data-interval]').forEach((button) => {
      button.querySelector('.interval-dot').style.backgroundColor = `var(--${draftConfig.colors[button.dataset.interval]})`;
    });
  }
  function openIntervals() {
    draftConfig = { ...config, colors: { ...config.colors } };
    renderIntervals();
    intervalsPage.hidden = false;
    $('intervalsCancel').focus({ preventScroll: true });
  }
  function closeIntervals() {
    intervalsPage.hidden = true;
    $('timeSettingsButton').focus({ preventScroll: true });
  }
  $('timeSettingsButton').addEventListener('click', openIntervals);
  $('intervalsCancel').addEventListener('click', closeIntervals);
  $('intervalsSave').addEventListener('click', () => {
    const changed = ['prepare', 'work', 'rest', 'rounds', 'cooldown'].some((type) => config[type] !== draftConfig[type] || config.colors[type] !== draftConfig.colors[type]);
    if (changed) {
      config = { ...draftConfig, name: config.name, colors: { ...draftConfig.colors } };
      reset(false);
    }
    closeIntervals();
  });
  function wheelValue(wheel) {
    const list = wheel.querySelector('.wheel-list');
    const row = list.querySelector('.wheel-option');
    const min = Number(list.getAttribute('aria-valuemin'));
    const max = Number(list.getAttribute('aria-valuemax'));
    return Math.max(min, Math.min(max, min + Math.round(list.scrollTop / row.offsetHeight)));
  }
  function refreshWheel(wheel) {
    const list = wheel.querySelector('.wheel-list');
    const value = wheelValue(wheel);
    list.setAttribute('aria-valuenow', value);
    list.setAttribute('aria-valuetext', String(value).padStart(2, '0'));
    list.querySelectorAll('.wheel-option').forEach((option) => {
      const distance = Math.abs(Number(option.dataset.value) - value);
      option.classList.toggle('is-selected', distance === 0);
      option.classList.toggle('is-distant', distance >= 2);
    });
  }
  function scrollWheel(wheel, value, behavior = 'auto') {
    const list = wheel.querySelector('.wheel-list');
    const row = list.querySelector('.wheel-option');
    const min = Number(list.getAttribute('aria-valuemin'));
    const max = Number(list.getAttribute('aria-valuemax'));
    list.scrollTo({ top: (Math.max(min, Math.min(max, value)) - min) * row.offsetHeight, behavior });
    refreshWheel(wheel);
  }
  function setPickerColor(color) {
    editingColor = color;
    pickerPage.querySelectorAll('[data-color]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === color)));
  }
  function openPicker(type) {
    editingType = type;
    $('pickerTitle').textContent = labels[type] || 'ROUNDS';
    const isRounds = type === 'rounds';
    wheels.forEach((wheel) => { wheel.hidden = (wheel.dataset.wheel === 'rounds') !== isRounds; });
    setPickerColor(draftConfig.colors[type]);
    pickerPage.hidden = false;
    if (isRounds) {
      scrollWheel(wheels.find((wheel) => wheel.dataset.wheel === 'rounds'), sec(draftConfig.rounds));
    } else {
      scrollWheel(wheels.find((wheel) => wheel.dataset.wheel === 'minutes'), Math.floor(sec(draftConfig[type]) / 60));
      scrollWheel(wheels.find((wheel) => wheel.dataset.wheel === 'seconds'), sec(draftConfig[type]) % 60);
    }
    $('pickerBack').focus({ preventScroll: true });
  }
  function closePicker() {
    pickerPage.hidden = true;
    intervalsPage.querySelector(`[data-interval="${editingType}"]`).focus({ preventScroll: true });
  }
  intervalsPage.querySelectorAll('[data-interval]').forEach((button) => {
    button.addEventListener('click', () => openPicker(button.dataset.interval));
  });
  $('pickerBack').addEventListener('click', closePicker);
  $('pickerDone').addEventListener('click', () => {
    const selected = (name) => wheelValue(wheels.find((wheel) => wheel.dataset.wheel === name));
    const value = editingType === 'rounds' ? selected('rounds') : selected('minutes') * 60 + selected('seconds');
    if (editingType === 'work' && value === 0) { showToast('WORK 时间至少为 1 秒'); return; }
    draftConfig[editingType] = value;
    draftConfig.colors[editingType] = editingColor;
    renderIntervals();
    closePicker();
  });
  pickerPage.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => setPickerColor(button.dataset.color)));
  wheels.forEach((wheel) => {
    const list = wheel.querySelector('.wheel-list');
    const min = Number(list.getAttribute('aria-valuemin'));
    const max = Number(list.getAttribute('aria-valuemax'));
    const options = document.createDocumentFragment();
    for (let value = min; value <= max; value += 1) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'wheel-option';
      option.tabIndex = -1;
      option.dataset.value = value;
      option.textContent = String(value).padStart(2, '0');
      option.addEventListener('click', () => scrollWheel(wheel, value, 'smooth'));
      options.appendChild(option);
    }
    list.appendChild(options);
    list.addEventListener('scroll', () => refreshWheel(wheel), { passive: true });
    list.addEventListener('keydown', (event) => {
      const changes = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
      if (event.key in changes) { event.preventDefault(); scrollWheel(wheel, wheelValue(wheel) + changes[event.key], 'smooth'); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); scrollWheel(wheel, event.key === 'Home' ? min : max, 'smooth'); }
    });
  });
  document.querySelectorAll('[data-placeholder]').forEach((button) => {
    button.addEventListener('click', () => showToast(button.dataset.placeholder));
  });
  nameInput.addEventListener('change', () => {
    config.name = nameInput.value.trim() || defaults.name;
    nameInput.value = config.name;
    save();
  });
  nameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') nameInput.blur(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (running) {
        tick();
        requestWakeLock();
        if (audioContext?.state === 'suspended') audioContext.resume().then(() => prepareAudioSchedule(audioContext.currentTime));
      }
      render();
    } else {
      save();
    }
  });
  window.addEventListener('pagehide', save);

  phases = buildPhases();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && Number.isInteger(saved.phaseIndex)) {
      phaseIndex = Math.min(Math.max(0, saved.phaseIndex | 0), phases.length - 1);
      if (!saved.running && Number.isFinite(saved.pausedRemaining)) pausedRemaining = Math.max(0, saved.pausedRemaining);
      if (saved.running && Number.isFinite(saved.phaseDeadline)) {
        phaseDeadline = saved.phaseDeadline;
        running = true;
        timerId = window.setInterval(tick, 100);
        if (phaseDeadline <= Date.now()) tick();
        else requestWakeLock();
      }
    }
  } catch { /* Start from the opening phase. */ }
  while (phaseIndex < phases.length && phases[phaseIndex].seconds === 0) phaseIndex += 1;
  if (phaseIndex >= phases.length) { phaseIndex = phases.length - 1; running = false; }
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
