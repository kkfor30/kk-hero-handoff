import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../templates/hero-intro.js', import.meta.url), 'utf8');
const { createHeroIntro, fitRect, mixRect, timeline } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class Element extends EventTarget {
  constructor() {
    super(); this.dataset = {}; this.inert = false; this.removed = false;
    this.style = { setProperty(k,v) { this[k] = v; } };
    const set = new Set();
    this.classList = { add: (...v) => v.forEach(x => set.add(x)), remove: (...v) => v.forEach(x => set.delete(x)),
      contains: v => set.has(v) };
  }
  setAttribute() {}
  removeAttribute() {}
  append(el) { this.child = el; }
  remove() { this.removed = true; }
}
function environment(settings = {}) {
  let now = 0, next = 0;
  const callbacks = new Map(), events = [], videos = [], overlays = [];
  const root = new Element(), image = new Element(), ui = new Element();
  image.matches = () => true;
  image.complete = !settings.imageLoading; image.naturalWidth = image.complete ? 1440 : 0;
  image.decode = () => settings.decodeError ? Promise.reject(new Error('decode-error')) : Promise.resolve();
  let rect = { left: 800, top: 200, width: 400, height: 300 };
  image.getBoundingClientRect = () => rect;
  root.querySelector = () => image;
  root.querySelectorAll = () => [ui];
  root.dataset.introSrc = 'intro.mp4';
  ui.inert = !!settings.inert;
  const reduced = new Element(); reduced.matches = !!settings.reduced;
  const win = new Element(); win.visualViewport = null;
  for (const name of ['hero-intro:ready','hero-intro:started','hero-intro:error','hero-intro:skipped'])
    win.addEventListener(name, e => events.push({ name, reason: e.detail.reason }));
  globalThis.window = win;
  globalThis.CustomEvent = class extends Event { constructor(name, options) { super(name); this.detail = options.detail; } };
  globalThis.matchMedia = () => reduced;
  globalThis.location = { pathname: '/demo', search: settings.replay ? '?intro=replay' : '' };
  globalThis.sessionStorage = { getItem: () => settings.seen ? '1' : null, setItem() {} };
  globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  globalThis.getComputedStyle = () => ({ transform: 'none' });
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = cb => { callbacks.set(++next, cb); return next; };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  globalThis.document = { body: { append() {} }, createElement(tag) {
    const el = new Element();
    if (tag === 'video') {
      el.duration = settings.duration || 6; el.videoWidth = 1024; el.videoHeight = 768; el.readyState = 0;
      let time = 0;
      Object.defineProperty(el, 'currentTime', { get: () => time, set: t => {
        time = t; queueMicrotask(() => el.dispatchEvent(new Event('seeked')));
      } });
      el.load = () => {
        if (!settings.videoLoading) {
          el.readyState = 2; queueMicrotask(() => el.dispatchEvent(new Event('loadeddata')));
        }
      };
      el.play = () => settings.playPending ? new Promise(() => {}) : settings.autoplayError ? Promise.reject(new Error('autoplay')) : Promise.resolve();
      if (settings.frameCallback) {
        el.requestVideoFrameCallback = cb => { el.frameCallback = cb; return 1; };
        el.cancelVideoFrameCallback = () => { el.frameCallback = null; };
      }
      el.pause = () => {};
      videos.push(el);
    } else overlays.push(el);
    return el;
  } };
  const tick = (ms, time) => {
    now += ms;
    if (time !== undefined && videos[0]) videos[0].currentTime = time;
    const current = [...callbacks.values()]; callbacks.clear(); current.forEach(cb => cb(now));
  };
  return { root, ui, image, reduced, win, events, videos, overlays, tick,
    setRect: value => { rect = value; },
    options: { handoffTime: 5.9, once: false } };
}
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };

test('矩形计算保持画幅，回位起终点准确，短视频时序可用', () => {
  const r = fitRect(4/3, { width: 1200, height: 800 });
  assert.equal(r.width/r.height,4/3);
  assert.equal(r.left+r.width/2,600);
  assert.deepEqual(mixRect(r,r,1),r);
  assert.equal(timeline(5,5.9,1.15,1).reveal,true);
  assert.equal(timeline(0.2,0.2,1.15,1).progress,1);
});
test('尾部提前显示 UI，淡出后就绪，没有 ended 后双重等待', async () => {
  const env = environment();
  const c = createHeroIntro(env.root,env.options); await c.start();
  env.tick(100,5); assert(env.root.classList.contains('hi-reveal')); assert.equal(env.ui.inert,true);
  env.tick(900,5.9); await flush(); assert.equal(c.state,'handoff');
  env.tick(160); assert.equal(c.state,'ready'); assert.equal(env.ui.inert,false);
  assert.equal(env.events.filter(e=>e.name==='hero-intro:ready').length,1);
  assert(env.overlays[0].removed);
});
test('滚动导致目标改变，下一帧回位坐标重新计算', async () => {
  const env=environment(); const c=createHeroIntro(env.root,env.options); await c.start();
  env.setRect({left:200,top:50,width:400,height:300});
  env.tick(100,5.9); await flush();
  assert.equal(env.overlays[0].style.left,'200px'); assert.equal(env.overlays[0].style.top,'50px');
  c.destroy();
});
test('长视频持续进展不会被固定总时限中断', async () => {
  const env=environment({duration:40}); const c=createHeroIntro(env.root,{...env.options,handoffTime:39.9}); await c.start();
  for(let t=1;t<=25;t++) env.tick(1000,t);
  assert.equal(c.state,'playing'); c.destroy();
});
test('无进展超时恢复页面并仅发一次就绪', async () => {
  const env=environment(); const c=createHeroIntro(env.root,env.options); await c.start();
  env.tick(5100,0); assert.equal(c.state,'ready');
  assert(env.events.some(e=>e.reason==='playback-stalled')); c.skip();
  assert.equal(env.events.filter(e=>e.name==='hero-intro:ready').length,1);
});
for (const [name,settings] of [['减弱动态',{reduced:true}],['自动播放失败',{autoplayError:true}],
  ['图像解码失败',{decodeError:true}],['session已播放',{seen:true}]]) {
  test(name+'恢复页面，保留原有 inert', async () => {
    const env=environment({...settings,inert:true});
    const c=createHeroIntro(env.root,{...env.options,once:true}); await c.start();
    assert.equal(c.state,'ready'); assert.equal(env.ui.inert,true);
    assert.equal(env.events.filter(e=>e.name==='hero-intro:ready').length,1);
  });
}
test('静态图未就绪时不开始播放，超时后恢复', async () => {
  const env=environment({imageLoading:true}); const c=createHeroIntro(env.root,{...env.options,loadTimeoutMs:10});
  const pending=c.start(); await flush();
  assert.equal(c.state,'loading'); assert.equal(env.events.length,0); await pending;
  assert.equal(c.state,'ready');
});
test('交接中切换减弱动态仍可清理', async () => {
  const env=environment(); const c=createHeroIntro(env.root,env.options); await c.start();
  env.tick(100,5.9); await flush(); assert.equal(c.state,'handoff');
  const e=new Event('change'); e.matches=true; env.reduced.dispatchEvent(e);
  assert.equal(c.state,'ready'); assert(env.overlays[0].removed);
});
test('销毁后异步加载不能重新启动，重播绕过 session', async () => {
  const env=environment({seen:true,replay:true});
  const c=createHeroIntro(env.root,{...env.options,once:true}); await c.start();
  assert.equal(c.state,'playing'); c.destroy(); env.tick(1000,5.9);
  assert.equal(c.state,'disposed'); assert.equal(env.events.filter(e=>e.name==='hero-intro:ready').length,0);
});
test('错误目标画幅降级而不拉伸', async () => {
  const env=environment(); env.setRect({left:0,top:0,width:400,height:100});
  const c=createHeroIntro(env.root,env.options); await c.start();
  assert.equal(c.state,'ready'); assert(env.events.some(e=>e.reason==='target-aspect-mismatch'));
});
test('解码帧达到接管点后定位选定帧，释放逐帧回调', async () => {
  const env=environment({frameCallback:true}); const c=createHeroIntro(env.root,env.options); await c.start();
  env.tick(100,5); env.tick(900,5.95);
  assert.notEqual(c.state,'handoff');
  env.videos[0].frameCallback(1000,{mediaTime:5.95}); await flush();
  assert.equal(env.videos[0].currentTime,5.9); assert.equal(c.state,'handoff');
  env.tick(160); assert.equal(c.state,'ready'); assert.equal(env.videos[0].frameCallback,null);
});
test('交接中 pagehide 清理视频，重复事件不重复完成', async () => {
  const env=environment(); const c=createHeroIntro(env.root,env.options); await c.start();
  env.tick(100,5.9); await flush(); env.win.dispatchEvent(new Event('pagehide'));
  assert.equal(c.state,'ready'); assert(env.overlays[0].removed);
  env.win.dispatchEvent(new Event('pagehide'));
  assert.equal(env.events.filter(e=>e.name==='hero-intro:ready').length,1);
});
test('play Promise 不完成也能超时恢复', async () => {
  const env=environment({playPending:true}); const c=createHeroIntro(env.root,{...env.options,loadTimeoutMs:10});
  await c.start(); assert.equal(c.state,'ready'); assert(env.overlays[0].removed);
});
test('加载中销毁取消所有等待，不重新播放', async () => {
  const env=environment({videoLoading:true}); const c=createHeroIntro(env.root,env.options);
  const pending=c.start(); c.destroy(); await pending;
  assert.equal(c.state,'disposed'); assert.equal(env.events.length,0);
});
