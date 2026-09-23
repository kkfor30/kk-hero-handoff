// 以 type="module" 引入。每个实例显式初始化，适用于普通页面及组件挂载/卸载。
export function fitRect(aspect, viewport, margin = 0.9) {
  const width = Math.min(viewport.width * margin, viewport.height * margin * aspect);
  return { left: (viewport.left || 0) + (viewport.width - width) / 2,
    top: (viewport.top || 0) + (viewport.height - width / aspect) / 2,
    width, height: width / aspect };
}
export function mixRect(a, b, progress) {
  const p = Math.min(1, Math.max(0, progress));
  const eased = p * p * (3 - 2 * p);
  return Object.fromEntries(['left', 'top', 'width', 'height'].map(k => [k, a[k] + (b[k] - a[k]) * eased]));
}
export function timeline(time, handoff, returnSeconds, revealLead) {
  const start = Math.max(0, handoff - returnSeconds);
  return { progress: handoff > start ? Math.min(1, Math.max(0, (time - start) / (handoff - start))) : 1,
    reveal: time >= Math.max(0, handoff - revealLead), handoff: time >= handoff };
}
export function createHeroIntro(root, options = {}) {
  if (!root) throw new Error('缺少 Hero 根节点');
  const scene = options.scene || root.querySelector('[data-hero-intro-static]');
  const ui = [...root.querySelectorAll('[data-hero-intro-ui]')];
  const image = scene?.matches('img') ? scene : scene?.querySelector('img');
  const source = options.src || root.dataset.introSrc;
  const config = { returnMs: 1150, revealLeadMs: 1000, revealMs: 400,
    crossfadeMs: 160, margin: 0.9, loadTimeoutMs: 10000, stallTimeoutMs: 5000,
    once: true, ...options };
  for (const key of ['returnMs','revealLeadMs','revealMs','crossfadeMs','loadTimeoutMs','stallTimeoutMs']) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error('无效配置: ' + key);
  }
  if (!(config.margin > 0 && config.margin <= 1)) throw new Error('margin 必须在 0～1 之间');
  const abort = new AbortController();
  const signal = abort.signal;
  const originalInert = ui.map(el => el.inert);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const sessionKey = 'hero-intro:' + (config.key || location.pathname + ':' + source);
  let video, overlay, raf, vf, handoffTime, lastTime = 0, lastAdvance = 0;
  let state = 'idle', disposed = false, done = false, revealAt = null, fadeAt = null;
  const emit = (name, reason) => window.dispatchEvent(new CustomEvent(name, { detail: { root, reason } }));
  const setState = value => { state = value; root.dataset.introState = value; };
  const listen = (el, event, fn) => el.addEventListener(event, fn, { signal });
  const bounded = (promise, ms) => new Promise((resolve, reject) => {
    let timer;
    const end = (error, value) => {
      clearTimeout(timer); signal.removeEventListener('abort', cancelled);
      error ? reject(error) : resolve(value);
    };
    const cancelled = () => end(new Error('cancelled'));
    if (signal.aborted) return cancelled();
    signal.addEventListener('abort', cancelled, { once: true });
    timer = setTimeout(() => end(new Error('asset-timeout')), ms);
    Promise.resolve(promise).then(value => end(null, value), error => end(error));
  });
  const wait = (el, event, valid, ms) => new Promise((resolve, reject) => {
    let timer;
    const finish = error => {
      clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', bad);
      signal.removeEventListener('abort', cancelled); error ? reject(error) : resolve();
    };
    const ok = () => finish();
    const bad = () => finish(new Error('asset-error'));
    const cancelled = () => finish(new Error('cancelled'));
    if (signal.aborted) return cancelled();
    if (valid()) return resolve();
    el.addEventListener(event, ok, { once: true }); el.addEventListener('error', bad, { once: true });
    signal.addEventListener('abort', cancelled, { once: true });
    timer = setTimeout(() => finish(new Error('asset-timeout')), ms);
  });
  function cleanup() {
    abort.abort(); cancelAnimationFrame(raf);
    if (video && vf != null) video.cancelVideoFrameCallback?.(vf);
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    overlay?.remove();
    ui.forEach((el, i) => { el.inert = originalInert[i]; });
    root.classList.remove('hi-active', 'hi-reveal', 'hi-handoff', 'hi-loading');
    root.removeAttribute('data-intro-pending');
    clearTimeout(window.heroIntroBootstrapTimer);
  }
  function finish(reason, kind) {
    if (done || disposed) return;
    done = true; cleanup(); setState('ready');
    if (reason === 'completed' && config.once) { try { sessionStorage.setItem(sessionKey, '1'); } catch {} }
    if (kind) emit(kind, reason);
    emit('hero-intro:ready', reason);
  }
  function reveal(now) {
    if (revealAt !== null) return;
    revealAt = now; root.classList.add('hi-reveal');
  }
  function targetRect() {
    const r = scene.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) throw new Error('empty-target');
    if (Math.abs(r.width / r.height / (video.videoWidth / video.videoHeight) - 1) > 0.02)
      throw new Error('target-aspect-mismatch');
    return r;
  }
  function draw(progress) {
    const viewport = window.visualViewport;
    const v = viewport ? { left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height }
      : { width: innerWidth, height: innerHeight };
    const rect = mixRect(fitRect(video.videoWidth / video.videoHeight, v, config.margin), targetRect(), progress);
    for (const k of ['left','top','width','height']) overlay.style[k] = rect[k] + 'px';
  }
  async function beginHandoff() {
    if (done || disposed || state === 'seeking' || state === 'handoff') return;
    setState('seeking'); video.pause();
    try {
      // 与抽帧报告使用相同时间；解码到选定帧后才淡出。
      if (Math.abs(video.currentTime - handoffTime) > 0.002) {
        const seek = wait(video, 'seeked', () => false, config.loadTimeoutMs);
        video.currentTime = handoffTime; await seek;
      }
      if (done || disposed) return;
      fadeAt = performance.now(); reveal(fadeAt);
      draw(1); setState('handoff'); root.classList.add('hi-handoff');
      overlay.style.opacity = '0';
    } catch (error) { finish(error.message, 'hero-intro:error'); }
  }
  function frame(now) {
    if (done || disposed) return;
    try {
      const clock = timeline(video.currentTime, handoffTime, config.returnMs / 1000, config.revealLeadMs / 1000);
      draw(state === 'seeking' || state === 'handoff' ? 1 : clock.progress);
      if (clock.reveal) reveal(now);
      if (state === 'playing' || state === 'settling') {
        if (video.currentTime > lastTime + 0.001) { lastTime = video.currentTime; lastAdvance = now; }
        if (now - lastAdvance > config.stallTimeoutMs) return finish('playback-stalled', 'hero-intro:error');
        if (clock.progress > 0) setState('settling');
        if (clock.handoff && !video.requestVideoFrameCallback) beginHandoff();
      }
      if (state === 'handoff' && now - fadeAt >= config.crossfadeMs &&
          now - revealAt >= config.revealMs) return finish('completed');
    } catch (error) { return finish(error.message, 'hero-intro:error'); }
    raf = requestAnimationFrame(frame);
  }
  function decoded(now, metadata) {
    if (done || disposed || state === 'seeking' || state === 'handoff') return;
    if (metadata.mediaTime >= handoffTime) { beginHandoff(); return; }
    vf = video.requestVideoFrameCallback(decoded);
  }
  async function start() {
    if (state !== 'idle' || disposed) return;
    setState('loading');
    root.removeAttribute('data-intro-pending'); clearTimeout(window.heroIntroBootstrapTimer);
    if (!scene || !image || !source) return finish('missing-input', 'hero-intro:error');
    if (reduced.matches) return finish('reduced-motion', 'hero-intro:skipped');
    try {
      if (config.once && new URLSearchParams(location.search).get('intro') !== 'replay' &&
          sessionStorage.getItem(sessionKey)) return finish('already-played', 'hero-intro:skipped');
    } catch {}
    root.style.setProperty('--hi-reveal-ms', config.revealMs + 'ms');
    root.classList.add('hi-active', 'hi-loading'); ui.forEach(el => { el.inert = true; });
    listen(window, 'pagehide', () => finish('page-hidden', 'hero-intro:skipped'));
    listen(reduced, 'change', e => { if (e.matches) finish('reduced-motion', 'hero-intro:skipped'); });
    listen(root, 'hero-intro:skip', () => finish('user-skipped', 'hero-intro:skipped'));
    video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    overlay = document.createElement('div'); overlay.className = 'hero-intro-overlay';
    overlay.setAttribute('aria-hidden', 'true'); overlay.append(video); document.body.append(overlay);
    overlay.style.setProperty('--hi-crossfade-ms', config.crossfadeMs + 'ms');
    listen(video, 'error', () => finish('video-error', 'hero-intro:error'));
    listen(video, 'ended', beginHandoff);
    try {
      const loaded = wait(video, 'loadeddata', () => video.readyState >= 2, config.loadTimeoutMs);
      video.src = source; video.load();
      const preparedImage = (async () => {
        await wait(image, 'load', () => image.complete && image.naturalWidth > 0, config.loadTimeoutMs);
        if (image.decode) await image.decode();
      })();
      // decode 也必须受加载超时限制。
      await bounded(Promise.all([loaded, preparedImage]), config.loadTimeoutMs);
      if (done || disposed) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('invalid-duration');
      handoffTime = config.handoffTime;
      if (!Number.isFinite(handoffTime) || handoffTime < 0 || handoffTime >= video.duration)
        throw new Error('handoffTime-required-see-frame-report');
      const style = getComputedStyle(scene);
      if (style.transform !== 'none') throw new Error('transformed-target-needs-adapter');
      // 复制标准边缘处理；祖先 mask/filter/混合模式需由接入者先审计。
      for (const k of ['borderRadius','clipPath','maskImage','maskSize','maskPosition','maskRepeat','maskComposite'])
        overlay.style[k] = style[k];
      draw(0); setState('centered');
      await bounded(video.play(), config.loadTimeoutMs);
      if (done || disposed) return;
      root.classList.remove('hi-loading'); overlay.style.opacity = '1';
      lastAdvance = performance.now(); setState('playing'); emit('hero-intro:started', 'playing');
      raf = requestAnimationFrame(frame);
      if (video.requestVideoFrameCallback) vf = video.requestVideoFrameCallback(decoded);
    } catch (error) { finish(error.message, 'hero-intro:error'); }
  }
  return { start, skip: () => finish('user-skipped', 'hero-intro:skipped'),
    destroy: () => { if (disposed) return; cleanup(); disposed = true; setState('disposed'); },
    get state() { return state; } };
}
