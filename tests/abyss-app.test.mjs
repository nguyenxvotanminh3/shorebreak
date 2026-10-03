// App-level checks execute the production entrypoint, event handlers and fixed-step
// frame loop with real Three geometry/world/life/simulation. DOM, WebGL renderer,
// AudioContext and asynchronously loaded creature/arm meshes are explicit stand-ins.
// These are not browser, pixel, shader-compilation, actual asset-load or GPU tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { terrainHeight } from '../dist/abyss-world.js';
import { makeLocations } from '../dist/abyss-sim.js';
import { createAbyssLife } from '../dist/abyss-life.js';
import {ISLAND_SAFE_PATH,sampleIslandTerrain} from '../dist/abyss-island-terrain.js';

let nextRig = 0;
class Element extends EventTarget {
  constructor(tag = 'div', document = null) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.id = ''; this.children = []; this.parentElement = null; this.hidden = false;
    this.open = false; this.style = {}; this.dataset = {}; this.value = '';
    this.checked = false; this.disabled = false; this.width = 1280; this.height = 720;
    this.textContent = ''; this.attributes = new Map(); this.captured = new Set();
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, force) { const on = force ?? !classes.has(name); on ? classes.add(name) : classes.delete(name); return on; },
    };
    Object.defineProperty(this, 'className', {
      get: () => [...classes].join(' '),
      set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
    });
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  matches(selector) {
    return selector.split(',').some(part => {
      const s = part.trim();
      if (s === '[data-input]') return this.dataset.input !== undefined;
      if (s === '[data-close]') return this.dataset.close !== undefined;
      if (s === 'dialog[open]') return this.tagName === 'DIALOG' && this.open;
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      if (s.startsWith('#')) return this.id === s.slice(1);
      return this.tagName === s.toUpperCase();
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setPointerCapture(id) { this.captured.add(id); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Event('close')); }
  getContext() { return null; }
}

function parseDocument(html) {
  const document = new EventTarget(), root = new Element('root', document), stack = [root];
  const voidTags = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'source']);
  for (const match of html.matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)) {
    const [raw, tag, attributes] = match;
    if (raw.startsWith('</')) { while (stack.length > 1) { const node = stack.pop(); if (node.tagName === tag.toUpperCase()) break; } continue; }
    const element = new Element(tag, document);
    for (const attr of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const name = attr[1], value = attr[2] ?? '';
      element.attributes.set(name, value);
      if (name === 'id') element.id = value;
      if (name === 'class') element.className = value;
      if (name === 'hidden') element.hidden = true;
      if (name === 'value') element.value = value;
      if (name.startsWith('data-')) element.dataset[name.slice(5)] = value;
    }
    stack.at(-1).append(element);
    if (!voidTags.has(tag.toLowerCase())) stack.push(element);
  }
  document.querySelectorAll = selector => root.querySelectorAll(selector);
  document.querySelector = selector => root.querySelector(selector);
  document.getElementById = id => root.querySelector('#' + id);
  document.createElement = tag => new Element(tag, document);
  document.body = document.querySelector('body'); document.activeElement = document.body;
  document.hidden = false; document.pointerLockElement = null;
  document.exitPointerLock = () => { document.pointerLockElement = null; document.dispatchEvent(new Event('pointerlockchange')); };
  return document;
}

class Renderer {
  constructor({ canvas }) { this.domElement = canvas; this.info = { render: { calls: 0, triangles: 0 } }; this.ratio = 1; this.shadowMap = { enabled:false, type:THREE.PCFShadowMap, autoUpdate:true, needsUpdate:false }; }
  setPixelRatio(ratio) { this.ratio = ratio; }
  setSize(width, height) { this.domElement.width = width * this.ratio; this.domElement.height = height * this.ratio; }
  render(scene, camera) {
    this.scene = scene; this.camera = camera; scene.updateMatrixWorld(true);
    let calls = 0, triangles = 0;
    scene.traverseVisible(node => { if (node.isMesh) { calls++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); } });
    Object.assign(this.info.render, { calls, triangles });
    // Emulate only consumption of scheduled passes, not shadow rendering.
    scene.traverse(node => { if(node.isLight && node.shadow) node.shadow.needsUpdate=false; });
    this.shadowMap.needsUpdate=false;
  }
}

async function app(t, { coarse = false, storage = new Map(), pointerLock = 'denied' } = {}) {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const document = parseDocument(html), window = new EventTarget(), gains = [], writes = [], requestedAssets = [];
  const get = id => { const element = document.getElementById(id); assert.ok(element, `actual HTML contains #${id}`); return element; };
  const parameter = () => ({ value: 0, target: 0, setTargetAtTime(value) { this.target = value; }, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.target = value; } });
  window.AudioContext = class {
    constructor() { this.sampleRate = 100; this.currentTime = 0; this.destination = {}; }
    createGain() { const node = { gain: parameter(), connect() {} }; gains.push(node); return node; }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { frequency: parameter(), connect() {} }; }
    createOscillator() { return { frequency: parameter(), connect() {}, start() {}, stop() {} }; }
    resume() {}
  };
  let captureCalls = 0;
  if (pointerLock !== 'unsupported') get('ocean').requestPointerLock = () => {
    captureCalls++;
    if (pointerLock === 'denied') return Promise.reject(new Error('Pointer lock denied by test fixture'));
    document.pointerLockElement = get('ocean'); document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
  let now = 1000, nextFrame = null, renderer,life;
  const globals = {
    window, document, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
    performance: { now: () => now },
    requestAnimationFrame: callback => { nextFrame = callback; return 1; },
    matchMedia: query => ({ matches: query === '(pointer:coarse)' ? coarse : false }),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); writes.push({ key, value }); } },
    __TEST_ABYSS_LIFE__: (scene,options) => {life=createAbyssLife(scene,options);return life;},
    __TEST_ABYSS_THREE__: { ...THREE, WebGLRenderer: class extends Renderer { constructor(options) { super(options); renderer = this; } } },
  };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  // Bitmap decoding is an explicit stand-in, like this suite's GLB meshes.
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => new THREE.DataTexture(new Uint8Array([128,96,64,128]),1,1));
  const loader = t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    requestedAssets.push(url);
    const scene = new THREE.Group(); scene.name = 'TEST fixture for ' + url;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2), new THREE.MeshStandardMaterial());
    mesh.name = 'FixtureMesh'; scene.add(mesh);
    // Arm fixtures must supply all authored clips, otherwise entrypoint tests can
    // silently exercise only the arms loader error path and miss integration bugs.
    const animations = url.endsWith('diver-arms.glb') ? ['idle', 'swim', 'sprint', 'scan'].map((name, index) =>
      new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('FixtureMesh.rotation[x]', [0, .5, 1], [0, (index + 1) * .1, 0])])) : [];
    return { scene, animations };
  });
  t.after(() => {
    loader.mock.restore();
    renderer?.scene?.traverse(node => { node.geometry?.dispose(); for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) material.dispose(); });
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  let source = await readFile(new URL('../dist/abyss.js', import.meta.url), 'utf8');
  source = source.replace("import * as THREE from './vendor/three.module.js';", 'const THREE = globalThis.__TEST_ABYSS_THREE__;');
  source = source.replace("import { createAbyssLife } from './abyss-life.js';",'const createAbyssLife = globalThis.__TEST_ABYSS_LIFE__;');
  source = source.replace(/from '(\.\/[^']+)'/g, (_match, path) => `from '${new URL('../dist/' + path.slice(2), import.meta.url).href}'`);
  await import('data:text/javascript;base64,' + Buffer.from(source + `\n//# sourceURL=abyss-app-${++nextRig}.mjs`).toString('base64'));
  const fire = (target, type, fields = {}) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event); return event;
  };
  const frame = (count = 1, milliseconds = 1000 / 60) => { for (let i = 0; i < count; i++) { now += milliseconds; assert.equal(typeof nextFrame, 'function'); nextFrame(now); } };
  const click = id => fire(get(id), 'click');
  const key = (type, code, repeat = false, target = get('ocean')) => fire(window, type, { code, repeat, target });
  const state = () => window.__ABYSS_DEBUG.snapshot();
  const pointer = (target, type, id, x = 100, y = 100) => fire(target, type, { pointerId: id, clientX: x, clientY: y });
  const touch = action => document.querySelectorAll('[data-input]').find(element => element.dataset.input === action);
  const turnTo = (yaw, pitch) => {
    const current = state(), factor = Number(get('sensitivity').value) * .000035;
    pointer(get('ocean'), 'pointerdown', 909, 0, 0);
    pointer(get('ocean'), 'pointermove', 909, (current.yaw - yaw) / factor, (current.pitch - pitch) / factor);
    pointer(get('ocean'), 'pointerup', 909);
  };
  const travelTo = target => {
    key('keydown', 'KeyW');
    for (let i = 0; i < 2400; i++) {
      const { position } = state(), dx = target.x - position.x, dy = target.y - position.y, dz = target.z - position.z;
      if (Math.hypot(dx, dy, dz) < .5) { key('keyup', 'KeyW'); frame(45); return; }
      turnTo(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      frame();
    }
    key('keyup', 'KeyW'); assert.fail('Keyboard/drag route did not reach ' + JSON.stringify(target) + '; actual ' + JSON.stringify(state().position));
  };
  return { life, document, window, get, fire, frame, click, key, state, pointer, touch, turnTo, travelTo, renderer, life, gains, storage, writes, requestedAssets, captures: () => captureCalls };
}

function unchangedPosition(a, b, tolerance = 1e-8) {
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tolerance, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

// Keep top-level tests sequential: each rig temporarily supplies browser globals.
test('entrypoint starts real world, executes WASD/vertical/look/F/Q and denies pointer lock safely', async t => {
  const a = await app(t);
  assert.equal(a.state().status, 'menu'); assert.equal(a.get('loading').hidden, true);
  assert.equal(a.state().arms.status, 'ready'); assert.equal(a.state().arms.visible, false);
  assert.ok(a.renderer.scene === undefined); a.frame(2);
  assert.ok(a.renderer.scene.children.length > 15); assert.ok(a.state().render.triangles > 10000);
  a.click('start'); await Promise.resolve(); a.frame(3);
  assert.equal(a.state().status, 'playing'); assert.equal(a.get('welcome').hidden, true);
  assert.equal(a.get('hud').hidden, false); assert.equal(a.get('look-hint').hidden, false);
  assert.equal(a.state().pointerLocked, false); assert.equal(a.captures(), 1);
  assert.equal(a.document.activeElement, a.get('ocean'));
  assert.equal(a.state().arms.visible, true); assert.equal(a.state().assets['diver-arms'], 'ready');
  assert.equal(a.requestedAssets.filter(url => url.endsWith('diver-arms.glb')).length, 1);
  for (const [code, axis, sign] of [['KeyW', 'z', -1], ['KeyS', 'z', 1], ['KeyA', 'x', -1], ['KeyD', 'x', 1], ['Space', 'y', 1], ['KeyC', 'y', -1]]) {
    a.turnTo(0, 0); const before = a.state().position;
    assert.equal(a.key('keydown', code).defaultPrevented, true); a.frame(35);
    assert.ok(a.state().arms.weights.swim > .5, code + ' changes the actual-velocity arm blend');
    a.key('keyup', code); a.frame(30);
    assert.ok((a.state().position[axis] - before[axis]) * sign > .5, code + ' moves in expected direction');
  }
  const before = a.state(); a.key('keydown', 'ArrowLeft'); a.key('keydown', 'ArrowUp'); a.frame(30);
  a.key('keyup', 'ArrowLeft'); a.key('keyup', 'ArrowUp');
  assert.ok(a.state().yaw > before.yaw); assert.ok(a.state().pitch > before.pitch);
  a.pointer(a.get('ocean'), 'pointerdown', 7, 10, 10); const look = a.state();
  a.pointer(a.get('ocean'), 'pointermove', 8, 500, 500); assert.equal(a.state().yaw, look.yaw);
  a.pointer(a.get('ocean'), 'pointermove', 7, 30, 25); assert.ok(a.state().yaw < look.yaw); assert.ok(a.state().pitch < look.pitch);
  a.pointer(a.get('ocean'), 'pointercancel', 7); const canceled = a.state();
  a.pointer(a.get('ocean'), 'pointermove', 7, 800, 800); assert.equal(a.state().yaw, canceled.yaw);
  a.key('keydown', 'KeyF'); assert.equal(a.state().flashlight, false);
  a.key('keydown', 'KeyF', true); assert.equal(a.state().flashlight, false); a.key('keyup', 'KeyF');
  a.click('flashlight'); assert.equal(a.state().flashlight, true);
  a.key('keydown', 'KeyQ'); assert.equal(a.state().sonarCooldown, 9); a.frame(30);
  const cooling = a.state().sonarCooldown; a.key('keydown', 'KeyQ', true); a.click('sonar');
  assert.equal(a.state().sonarCooldown, cooling); assert.equal(a.get('sonar').disabled, true);
  a.key('keyup', 'KeyQ'); a.frame(550); assert.equal(a.state().sonarCooldown, 0);
  a.click('sonar'); assert.equal(a.state().sonarCooldown, 9);
  const formInput = a.state(); a.key('keydown', 'KeyW', false, a.get('sensitivity')); a.frame(30);
  assert.ok(a.state().time > formInput.time);
  unchangedPosition(a.state().position, formInput.position, 1e-5); // Form keys cannot swim.
  assert.ok(a.requestedAssets.some(url => url.endsWith('shark-lod.glb')));
  assert.equal(a.state().assets['shark:low'], 'ready');
});

test('pause/resume, dialogs, Escape, blur, visibility and home freeze and clear production state', async t => {
  const a = await app(t, { pointerLock: 'granted' });
  a.click('start'); a.frame(20); assert.equal(a.state().pointerLocked, true);
  const initialPitch = a.state().pitch;
  a.fire(a.document, 'mousemove', { movementX: 20, movementY: -10 });
  assert.ok(a.state().yaw < 0); assert.ok(a.state().pitch > initialPitch);
  a.click('sound'); a.frame(); assert.ok(a.gains[0].gain.target > 0);
  a.key('keydown', 'KeyW'); a.frame(30); a.key('keydown', 'KeyP');
  const paused = a.state(); a.frame(120);
  assert.equal(a.state().status, 'paused'); assert.equal(a.state().time, paused.time);
  unchangedPosition(a.state().position, paused.position); assert.equal(a.state().oxygen, paused.oxygen);
  assert.deepEqual(a.state().arms, paused.arms, 'pause freezes the complete arm controller');
  assert.equal(a.state().arms.visible, true);
  assert.equal(a.gains[0].gain.target, 0); assert.equal(a.state().pointerLocked, false);
  assert.equal(a.get('pause-dialog').open, true);
  a.key('keyup', 'KeyW'); a.key('keydown', 'KeyP'); a.frame(35);
  assert.equal(a.state().status, 'playing'); unchangedPosition(a.state().position, paused.position);
  a.click('settings-open'); const settings = a.state(); a.frame(90);
  assert.equal(a.state().time, settings.time); assert.equal(a.get('settings-dialog').open, true);
  a.fire(a.get('settings-dialog').querySelector('[data-close]'), 'click'); a.frame(2);
  assert.equal(a.state().status, 'playing'); assert.equal(a.get('settings-dialog').open, false);
  a.click('help-open'); a.key('keydown', 'Escape'); assert.equal(a.state().status, 'paused');
  const cancelHelp = a.fire(a.get('help-dialog'), 'cancel'); assert.equal(cancelHelp.defaultPrevented, true);
  assert.equal(a.state().status, 'playing');
  a.key('keydown', 'Escape'); assert.equal(a.get('pause-dialog').open, true);
  a.fire(a.get('pause-dialog'), 'cancel'); assert.equal(a.state().status, 'playing');
  a.key('keydown', 'KeyD'); a.frame(10); a.fire(a.window, 'blur'); assert.equal(a.state().status, 'paused');
  a.key('keyup', 'KeyD'); a.click('resume'); const afterBlur = a.state(); a.frame(35); unchangedPosition(a.state().position, afterBlur.position);
  a.document.hidden = true; a.fire(a.document, 'visibilitychange'); assert.equal(a.state().status, 'paused');
  a.document.hidden = false; a.click('resume'); a.document.exitPointerLock(); assert.equal(a.state().status, 'paused');
  a.click('home'); a.frame(60); assert.equal(a.state().status, 'menu'); assert.equal(a.get('welcome').hidden, false);
  assert.equal(a.state().arms.visible, false);
  assert.equal(a.get('hud').hidden, true); assert.equal(a.get('pause').hidden, true);
  assert.equal(a.document.body.classList.contains('playing'), false);
  a.click('help-open'); a.get('help-dialog').close(); assert.equal(a.state().status, 'menu');
});

test('settings tiers change real world resolution, save options and auto quality degrades only after sustained load', async t => {
  const storage = new Map([['shorebreak-abyss-settings', JSON.stringify({ quality: 'high', sensitivity: 80, volume: 0, reducedMotion: true })]]);
  const a = await app(t, { storage }); a.frame();
  assert.equal(a.state().quality, 'high'); assert.equal(a.renderer.ratio, 1.6); assert.equal(a.get('volume').value, 0);
  assert.equal(a.get('reduced-motion').checked, true);
  for (const [tier, ratio] of [['low', .8], ['medium', 1.2], ['high', 1.6]]) {
    a.get('quality').value = tier; a.fire(a.get('quality'), 'change'); a.frame();
    assert.equal(a.state().quality, tier); assert.equal(a.renderer.ratio, ratio); assert.equal(a.get('ocean').width, 1280 * ratio);
    assert.equal(JSON.parse(storage.get('shorebreak-abyss-settings')).quality, tier);
  }
  a.get('sensitivity').value = '125'; a.fire(a.get('sensitivity'), 'input');
  a.get('volume').value = '23'; a.fire(a.get('volume'), 'input');
  a.get('reduced-motion').checked = false; a.fire(a.get('reduced-motion'), 'change');
  assert.deepEqual(JSON.parse(storage.get('shorebreak-abyss-settings')), { quality: 'high', sensitivity: 125, volume: 23, reducedMotion: false });
  a.get('quality').value = 'auto'; a.fire(a.get('quality'), 'change'); assert.equal(a.state().quality, 'medium');
  a.click('start'); a.frame(20, 55); assert.equal(a.state().quality, 'medium');
  a.frame(150, 55); assert.equal(a.state().quality, 'low'); assert.equal(a.renderer.ratio, .8);
  a.click('pause'); a.click('home'); assert.equal(a.get('settings-dialog').open, false);
  a.get('quality').value = 'high'; a.fire(a.get('quality'), 'change'); a.click('start'); a.frame(160, 55);
  assert.equal(a.state().quality, 'high', 'explicit high must not silently auto-degrade');
  globalThis.innerWidth = 900; globalThis.innerHeight = 600; a.fire(a.window, 'resize');
  assert.equal(a.renderer.camera.aspect, 1.5); assert.equal(a.get('ocean').width, 900 * 1.6);
});

test('touch cancel/lost capture preserve independent keyboard and multiple-pointer movement sources', async t => {
  const a = await app(t, { coarse: true }); a.click('start'); a.frame(3);
  assert.equal(a.get('touch-controls').hidden, false); assert.equal(a.captures(), 0);
  assert.equal(a.state().quality, 'low'); assert.equal(a.get('look-hint').hidden, true);
  a.turnTo(0, 0); a.key('keydown', 'KeyW'); a.pointer(a.touch('forward'), 'pointerdown', 1);
  a.pointer(a.touch('forward'), 'pointercancel', 1); const keyboard = a.state().position.z; a.frame(40);
  assert.ok(a.state().position.z < keyboard - 1, 'canceling touch does not cancel keyboard');
  a.key('keyup', 'KeyW'); a.pointer(a.touch('right'), 'pointerdown', 2); a.pointer(a.touch('right'), 'pointerdown', 3);
  a.pointer(a.touch('right'), 'lostpointercapture', 2); const multiple = a.state().position.x; a.frame(40);
  assert.ok(a.state().position.x > multiple + 1, 'losing one pointer retains the other pointer');
  a.pointer(a.touch('right'), 'pointerup', 3); a.frame(150); const released = a.state().position; a.frame(30);
  unchangedPosition(a.state().position, released, 1e-5);
  a.pointer(a.touch('down'), 'pointerdown', 4); a.click('pause'); a.click('resume'); const resumed = a.state().position; a.frame(45);
  unchangedPosition(a.state().position, resumed);
  assert.equal(a.touch('down').classList.contains('held'), false);
  a.pointer(a.touch('down'), 'pointerup', 4);
});

test('E scan uses real travel/targeting, cancellation and independent keyboard/touch sources; buoy saves and continue restores', async t => {
  const a = await app(t); a.click('start'); a.frame(3);
  const p = makeLocations(terrainHeight)[0];
  a.travelTo({ x: p.x, y: -3.2, z: p.z + 4 });
  a.travelTo({ x: p.x, y: p.y, z: p.z + 4 });
  const faceTarget = () => { const q = a.state().position; a.turnTo(Math.atan2(-(p.x - q.x), -(p.z - q.z)), Math.atan2(p.y - q.y, Math.hypot(p.x - q.x, p.z - q.z))); };
  faceTarget(); a.frame(15); assert.equal(a.get('interaction').hidden, false);
  a.key('keydown', 'KeyE'); a.frame(60); assert.equal(a.state().scans.length, 0); assert.ok(parseFloat(a.get('scan-progress').style.width) > 25);
  assert.equal(a.state().arms.pose, 'scan'); assert.ok(a.state().arms.weights.scan > .99);
  a.key('keyup', 'KeyE'); a.frame(60); assert.equal(parseFloat(a.get('scan-progress').style.width), 0);
  assert.equal(a.state().arms.pose, 'idle'); assert.ok(a.state().arms.weights.scan < .002);
  a.key('keydown', 'KeyE'); a.pointer(a.touch('scan'), 'pointerdown', 5); a.frame(50);
  a.pointer(a.touch('scan'), 'pointercancel', 5); a.frame(110); a.key('keyup', 'KeyE');
  assert.deepEqual(a.state().scans, [p.id]); assert.deepEqual(a.state().banked, []);
  assert.equal(a.storage.has('shorebreak-abyss-progress'), false, 'unbanked sample never reaches storage');
  a.travelTo({ x: p.x, y: -.5, z: p.z + 4 }); a.travelTo({ x: 0, y: -.5, z: 18 }); a.frame(20);
  assert.deepEqual(a.state().banked, [p.id]);
  const save = JSON.parse(a.storage.get('shorebreak-abyss-progress'));
  assert.equal(save.version, 1); assert.deepEqual(save.banked, [p.id]); assert.ok(save.deepest > 10);
  a.click('pause'); a.click('home'); assert.equal(a.get('continue').hidden, false);
  a.click('continue'); a.frame(3); assert.deepEqual(a.state().scans, [p.id]); assert.deepEqual(a.state().banked, [p.id]);
  a.click('pause'); a.click('home'); a.click('start'); a.frame(3); assert.deepEqual(a.state().scans, []); assert.deepEqual(a.state().banked, []);
});

test('preexisting progress restores on continue and malformed stored data cannot crash startup', async t => {
  const storage = new Map([['shorebreak-abyss-settings', 'not json'], ['shorebreak-abyss-progress', JSON.stringify({ version: 1, banked: ['bell', 'bell', 'made-up'], deepest: 900 })]]);
  const a = await app(t, { storage, pointerLock: 'unsupported' });
  assert.equal(a.get('continue').hidden, false); a.click('continue'); a.frame(3);
  assert.equal(a.state().status, 'playing'); assert.deepEqual(a.state().banked, ['bell']); assert.deepEqual(a.state().scans, ['bell']);
  assert.equal(a.get('look-hint').hidden, false);
  a.click('pause'); a.click('rescue'); a.frame(3); assert.deepEqual(a.state().banked, ['bell']); assert.deepEqual(a.state().scans, ['bell']);
});

test('regression: continuing a completed save immediately restores the free-exploration objective', async t => {
  const storage = new Map([['shorebreak-abyss-progress', JSON.stringify({ version: 1, banked: ['glass', 'bell', 'rift'], deepest: 64 })]]);
  const a = await app(t, { storage, pointerLock: 'unsupported' });
  a.click('continue'); a.frame(3);
  assert.deepEqual(a.state().banked, ['glass', 'bell', 'rift']);
  assert.equal(a.get('mission-count').textContent, '03 / 03');
  assert.equal(a.get('objective').textContent, 'Khảo sát hoàn tất · Tự do khám phá');
  assert.equal(a.get('notice').querySelector('b').textContent, 'DÂY NỐI ĐÃ SẴN SÀNG', 'loading completed progress does not replay the completion notice');
  a.click('pause'); a.click('home'); a.click('start'); a.frame(3);
  assert.equal(a.get('objective').textContent, 'Thu ba mẫu dữ liệu và trở về phao', 'a fresh dive still resets completion');
});

test('regression: repeated movement key after blur/resume must not resurrect the cleared hold', async t => {
  const a = await app(t); a.click('start'); a.key('keydown', 'KeyW'); a.frame(20); a.fire(a.window, 'blur');
  a.click('resume'); const before = a.state().position; a.key('keydown', 'KeyW', true); a.frame(35);
  unchangedPosition(a.state().position, before);
  a.key('keyup', 'KeyW'); a.key('keydown', 'KeyW'); a.frame(30); assert.ok(a.state().position.z < before.z - 1);
});

test('regression: starting a fresh dive restores the flashlight indicator as well as its actual light', async t => {
  const a = await app(t); a.click('start'); a.key('keydown', 'KeyF'); assert.equal(a.get('flashlight').classList.contains('active'), false);
  a.click('pause'); a.click('home'); a.click('start'); a.frame();
  assert.equal(a.state().flashlight, true); assert.equal(a.get('flashlight').classList.contains('active'), true);
});

test('storage denial, pointer-lock errors and WebGL context loss keep failures contained', async t => {
  const storage = { get() { throw new Error('Storage denied'); }, set() { throw new Error('Storage quota exceeded'); } };
  const a = await app(t, { storage });
  a.get('quality').value = 'low'; a.fire(a.get('quality'), 'change');
  a.click('start'); await Promise.resolve(); a.frame(3);
  assert.equal(a.state().quality, 'low'); assert.equal(a.state().status, 'playing');
  a.fire(a.document, 'pointerlockerror'); assert.equal(a.get('look-hint').hidden, false);
  assert.equal(a.state().status, 'playing');
  a.key('keydown', 'KeyW'); a.frame(15);
  const lost = a.fire(a.get('ocean'), 'webglcontextlost');
  assert.equal(lost.defaultPrevented, true); assert.equal(a.state().status, 'paused');
  assert.equal(a.get('error').hidden, false); assert.match(a.get('error-text').textContent, /ngắt kết nối/);
  const before = a.state(); a.frame(60);
  assert.equal(a.state().time, before.time); unchangedPosition(a.state().position, before.position);
});


test('arm integration reuses one rig across starts, resets its pose, responds to sprint and honors reduced motion/portrait', async t => {
  const a = await app(t); a.frame();
  const rig = a.renderer.camera.getObjectByName('Diver / first-person arms'); assert.ok(rig);
  for (let cycle = 0; cycle < 4; cycle++) {
    a.click('start');
    assert.equal(a.state().arms.time, 0); assert.equal(a.state().arms.mixerTime, 0);
    assert.deepEqual(a.state().arms.weights, { idle: 1, swim: 0, sprint: 0, scan: 0 });
    a.frame(3); assert.equal(a.state().arms.visible, true);
    a.turnTo(0, 0); a.key('keydown', 'KeyW'); a.key('keydown', 'ShiftLeft'); a.frame(90);
    assert.equal(a.state().arms.pose, 'sprint'); assert.ok(a.state().arms.weights.sprint > .6);
    a.key('keyup', 'KeyW'); a.key('keyup', 'ShiftLeft');
    a.click('pause'); a.click('home'); a.frame(10); assert.equal(a.state().arms.visible, false);
    assert.equal(a.renderer.camera.getObjectByName('Diver / first-person arms'), rig); assert.equal(rig.children.length, 1);
  }
  assert.equal(a.requestedAssets.filter(url => url.endsWith('diver-arms.glb')).length, 1);
  a.get('reduced-motion').checked = true; a.fire(a.get('reduced-motion'), 'change'); a.click('start');
  for (let i = 0; i < 30; i++) { a.turnTo(i * .01, i * .005); a.frame(); }
  assert.deepEqual(a.state().arms.rotation, { x: 0, y: 0, z: 0 });
  globalThis.innerWidth = 390; globalThis.innerHeight = 844; a.fire(a.window, 'resize'); a.frame(120);
  assert.ok(a.state().arms.offset.z < -.17); assert.deepEqual(rig.scale.toArray(), [1, 1, 1]);
  a.key('keydown', 'KeyE'); a.frame(60); assert.equal(a.state().arms.pose, 'idle', 'held E away from a sample must not enter the scan pose');
});

test('arm movement settles to idle when held input is blocked at the surface', async t => {
  const a = await app(t); a.click('start'); a.frame(3);
  a.turnTo(0, 0); a.key('keydown', 'Space'); a.key('keydown', 'ShiftLeft'); a.frame(180);
  const blocked = a.state().position; a.frame(120);
  unchangedPosition(a.state().position, blocked);
  assert.ok(a.state().arms.speed < .001, 'collision-resolved arm speed settles despite held upward/sprint input');
  assert.ok(a.state().arms.weights.idle > .999, 'blocked input cannot keep the swim/sprint animation active');
  assert.equal(a.state().arms.pose, 'idle');
  a.key('keyup', 'Space'); a.key('keyup', 'ShiftLeft'); a.key('keydown', 'KeyC'); a.frame(60);
  assert.ok(a.state().position.y < blocked.y - 1); assert.ok(a.state().arms.weights.swim > .9, 'unblocked actual movement resumes the swim pose');
});

function assertExactPlayerRest(a, before, { emptyInput = true } = {}) {
  const current = a.state();
  assert.deepEqual(current.position, before.position, 'world position holds exactly');
  assert.deepEqual(current.velocity, { x: 0, y: 0, z: 0 }, 'simulation has no residual velocity');
  assert.deepEqual(current.resolvedVelocity, { x: 0, y: 0, z: 0 }, 'render motion has no residual velocity');
  assert.deepEqual(current.cameraPosition, current.position, 'idle camera has exactly zero bob');
  assert.deepEqual(a.renderer.camera.position.toArray(), Object.values(current.position), 'the actual render camera matches debug state');
  assert.equal(current.yaw, before.yaw);
  assert.equal(current.pitch, before.pitch);
  if (emptyInput) assert.deepEqual(current.input, { turn: 0, tilt: 0 });
}

test('drift regression: untouched menu camera never auto-pans and menu input cannot latch', async t => {
  const a = await app(t); a.frame();
  const before = a.state(), rotation = a.renderer.camera.quaternion.toArray();
  a.key('keydown', 'KeyW'); a.key('keydown', 'ArrowLeft');
  a.pointer(a.touch('up'), 'pointerdown', 21);
  for (let n = 0; n < 120; n++) {
    a.frame();
    const current = a.state();
    assert.equal(current.status, 'menu');
    assert.equal(current.time, 0);
    assert.deepEqual(current.position, before.position);
    assert.deepEqual(current.velocity, { x: 0, y: 0, z: 0 });
    assert.deepEqual(current.input, { turn: 0, tilt: 0 });
    assert.deepEqual(current.cameraPosition, before.cameraPosition);
    assert.deepEqual(a.renderer.camera.quaternion.toArray(), rotation, 'menu view cannot drift despite animated surroundings');
  }
  a.click('start'); a.frame();
  const started = a.state();
  for (let n = 0; n < 120; n++) { a.frame(); assertExactPlayerRest(a, started); }
  assert.equal(a.state().status, 'playing');
  assert.ok(a.state().time > started.time + 1.9, 'an idle dive still advances simulation time');
});

test('drift regression: sprint release reaches exact world and camera rest at 30/60/120Hz', async t => {
  for (const hz of [30, 60, 120]) await t.test(`${hz}Hz render frames`, async t => {
    const a = await app(t); a.click('start'); a.frame(); a.turnTo(0, 0);
    a.key('keydown', 'KeyW'); a.key('keydown', 'ShiftLeft');
    a.frame(hz, 1000 / hz);
    const moving = a.state();
    assert.ok(Math.hypot(...Object.values(moving.velocity)) > 8);
    assert.notEqual(moving.cameraPosition.y, moving.position.y, 'movement bob remains active before release');
    a.key('keyup', 'KeyW'); a.key('keyup', 'ShiftLeft');
    assert.deepEqual(a.state().input, { turn: 0, tilt: 0 });
    a.frame(Math.ceil(hz * .4), 1000 / hz);
    const rested = a.state();
    assertExactPlayerRest(a, rested);
    const glide = Math.hypot(rested.position.x - moving.position.x, rested.position.y - moving.position.y, rested.position.z - moving.position.z);
    assert.ok(glide > .2 && glide < .42, `short smooth release glide: ${glide}m`);
    for (let n = 0; n < hz * 2; n++) { a.frame(1, 1000 / hz); assertExactPlayerRest(a, rested); }
    assert.ok(a.state().time > rested.time + 1.9);
    assert.equal(a.state().arms.pose, 'idle');
  });
});

test('drift regression: blur and hidden-tab cancellation remove all holds and camera bob immediately', async t => {
  const a = await app(t, { coarse: true }); a.click('start'); a.frame(); a.turnTo(0, 0);
  for (const reason of ['blur', 'hidden']) {
    a.key('keydown', 'KeyW'); a.key('keydown', 'ShiftLeft');
    a.pointer(a.touch('right'), 'pointerdown', 31);
    a.frame(35);
    assert.ok(Math.hypot(...Object.values(a.state().resolvedVelocity)) > 1);
    if (reason === 'blur') a.fire(a.window, 'blur');
    else { a.document.hidden = true; a.fire(a.document, 'visibilitychange'); }
    const paused = a.state();
    assert.equal(paused.status, 'paused');
    assert.deepEqual(paused.input, { turn: 0, tilt: 0 });
    assert.deepEqual(paused.velocity, { x: 0, y: 0, z: 0 });
    assert.equal(a.touch('right').classList.contains('held'), false);
    // Camera transforms update on the next render frame, then stay fixed.
    for (let n = 0; n < 45; n++) { a.frame(); assertExactPlayerRest(a, paused); }
    assert.equal(a.state().time, paused.time);
    a.document.hidden = false; a.fire(a.document, 'visibilitychange');
    a.click('resume');
    // Late key repeats and pointer release events from before interruption must
    // not re-arm movement after the app has cleared the original owners.
    a.key('keydown', 'KeyW', true); a.key('keydown', 'ShiftLeft', true);
    a.pointer(a.touch('right'), 'lostpointercapture', 31);
    a.key('keyup', 'KeyW'); a.key('keyup', 'ShiftLeft');
    for (let n = 0; n < 90; n++) { a.frame(); assertExactPlayerRest(a, paused); }
    assert.equal(a.state().status, 'playing');
    assert.ok(a.state().time > paused.time + 1.4);
  }
});

test('drift regression: touch up, cancel and lost capture each settle world and camera exactly', async t => {
  const a = await app(t, { coarse: true }); a.click('start'); a.frame(); a.turnTo(0, 0);
  for (const [index, event] of ['pointerup', 'pointercancel', 'lostpointercapture'].entries()) {
    const button = a.touch(index === 1 ? 'right' : 'forward'), id = 40 + index;
    a.pointer(button, 'pointerdown', id); a.frame(30);
    assert.equal(button.classList.contains('held'), true);
    assert.ok(Math.hypot(...Object.values(a.state().resolvedVelocity)) > 2);
    a.pointer(button, event, id);
    a.pointer(button, 'lostpointercapture', id); // duplicate cleanup is harmless
    assert.equal(button.classList.contains('held'), false);
    assert.deepEqual(a.state().input, { turn: 0, tilt: 0 });
    a.frame(24);
    const rested = a.state();
    for (let n = 0; n < 75; n++) { a.frame(); assertExactPlayerRest(a, rested); }
  }
});

test('drift regression: blocked surface has no camera bob despite held up and sprint', async t => {
  const a = await app(t); a.click('start'); a.frame(); a.turnTo(0, 0);
  a.key('keydown', 'Space'); a.key('keydown', 'ShiftLeft'); a.frame(120);
  const blocked = a.state();
  assert.equal(blocked.position.y, .5);
  assert.equal(blocked.input.up, 1); assert.equal(blocked.input.sprint, 1);
  for (let n = 0; n < 120; n++) { a.frame(); assertExactPlayerRest(a, blocked, { emptyInput: false }); }
  a.key('keyup', 'Space'); a.key('keyup', 'ShiftLeft');
  for (let n = 0; n < 60; n++) { a.frame(); assertExactPlayerRest(a, blocked); }
});

test('entrypoint drives from buoy to rig, uses E wet-lock panels, pauses the pump, walks dry and reverses with R',async t=>{
 const a=await app(t);a.click('start');a.frame(2);
 const rigOrigin=a.state().rig.origin,point=(x,y,z)=>({x:rigOrigin[0]+x,y:rigOrigin[1]+y,z:rigOrigin[2]+z});
 // Ordinary production keyboard/drag handlers for the complete world approach.
 // Renderer/GLB/bitmap fixtures remain explicit; this is not browser pixels.
 a.travelTo({x:45,y:-6,z:-100});a.travelTo({x:45,y:-6,z:-280});
 a.travelTo(point(0,19.65,55));a.travelTo(point(0,19.65,48));a.travelTo(point(0,19.65,38.5));
 assert.equal(a.state().rescues,0);assert.equal(a.state().rig.lock.phase,'sea-open');
 a.turnTo(Math.PI/2,0);a.key('keydown','KeyE');a.frame(120);
 assert.equal(a.state().rig.lock.phase,'draining');const water=a.state().rig.lock.waterLevel;
 a.key('keydown','KeyP');const paused=a.state();a.frame(100);assert.equal(a.state().rig.lock.waterLevel,water);unchangedPosition(a.state().position,paused.position);
 a.key('keyup','KeyP');a.key('keyup','KeyE');a.key('keydown','KeyP');a.key('keyup','KeyP');a.frame(500);
 assert.equal(a.state().rig.lock.phase,'habitat-open');assert.equal(a.state().movementMode,'walk');assert.equal(a.state().grounded,true);assert.ok(a.state().oxygen>145);
 assert.equal(a.state().torch.intensity,140);assert.equal(a.get('sonar').disabled,true);a.key('keydown','KeyQ');a.key('keyup','KeyQ');assert.equal(a.state().sonarCooldown,0);assert.equal(a.state().sonar.blockedReason,'dry');
 assert.match(a.get('controls-hint').textContent,/đi bộ/);assert.match(a.get('temperature').textContent,/KHOANG KHÔ/);
 a.travelTo(point(0,19.65,31));assert.equal(a.state().movementMode,'walk');
 a.travelTo(point(0,19.65,38.5));a.turnTo(-Math.PI/2,0);a.key('keydown','KeyE');a.frame();a.key('keyup','KeyE');a.frame(200);
 assert.equal(a.state().rig.lock.phase,'filling');a.key('keydown','KeyR');a.key('keyup','KeyR');a.frame(500);
 assert.equal(a.state().rig.lock.phase,'habitat-open');assert.equal(a.state().movementMode,'walk');
 a.turnTo(-Math.PI/2,0);a.key('keydown','KeyE');a.frame(650);a.key('keyup','KeyE');
 assert.equal(a.state().rig.lock.phase,'sea-open');assert.equal(a.state().movementMode,'swim');
 a.travelTo(point(0,19.65,48));assert.equal(a.state().rig.inside,false);assert.equal(a.state().rescues,0);
 a.key('keydown','KeyP');a.key('keyup','KeyP');a.click('home');a.click('start');a.frame();
 assert.equal(a.state().rig.lock.phase,'sea-open');unchangedPosition(a.state().position,{x:0,y:-3.2,z:18});
});

test('sonar entrypoint reveals only arrived finite-range returns with distances, fades them and resets',async t=>{
 const a=await app(t);a.click('start');a.frame();
 assert.equal(a.state().build,'dynamic-sea-v8');assert.equal(a.get('build-id').textContent,'dynamic-sea-v8');
 a.key('keydown','KeyQ');a.key('keyup','KeyQ');
 const start=a.state();assert.equal(start.sonar.range,140);assert.equal(start.sonar.echoes.length,0);assert.ok(start.sonar.pendingCount>0);
 assert.equal(start.sonar.pulse.timeExpanded,true);assert.equal(start.sonar.pulse.origin.x,start.position.x);
 assert.match(a.get('sonar-status').textContent,/HỒI ÂM/);
 a.frame(150);const arrived=a.state();
 assert.ok(arrived.sonar.echoes.some(e=>e.id==='glass'));assert.ok(arrived.sonar.echoes.every(e=>e.range<=140&&e.arrivalAt<=arrived.time));
 assert.ok(!arrived.sonar.echoes.some(e=>e.id==='rig'||e.id==='rift'),'far targets do not bypass range');
 assert.deepEqual(arrived.scans,[]);assert.deepEqual(arrived.banked,[]);
 const rows=a.get('sonar-echoes').children.filter(r=>!r.hidden);assert.ok(rows.length>0&&rows.length<=3);
 assert.ok(rows.some(r=>/m · .* · sâu .* m/.test(r.children[1].textContent)));
 const marker=a.get('waypoints').children.find(r=>r.children[0].textContent==='GIÀN KHOAN / 07');assert.equal(marker.hidden,true);
 a.key('keydown','KeyP');a.key('keyup','KeyP');const frozen=a.state().sonar;a.frame(100);
 assert.deepEqual(a.state().sonar,frozen,'pause cannot age, move or consume echoes');
 a.click('resume');a.frame(480);assert.equal(a.state().sonar.echoes.length,0);assert.match(a.get('sonar-help').textContent,/Không còn hồi âm/);
 a.key('keydown','Space');a.frame(100);a.key('keyup','Space');a.frame(20);
 assert.equal(a.get('sonar').disabled,true);assert.match(a.get('sonar-status').textContent,/NGẬP NƯỚC/);
 a.click('sonar');assert.equal(a.state().sonarCooldown,0);assert.equal(a.state().sonar.blockedReason,'dry');
 a.key('keydown','KeyP');a.key('keyup','KeyP');a.click('home');a.click('start');a.frame();
 assert.equal(a.state().sonar.pulse.emittedAt,null);assert.equal(a.state().sonar.echoes.length,0);assert.equal(a.state().sonarCooldown,0);
});

test('torch entrypoint has one world-occluded camera-aligned beam, bounded tiers and neutral arm hook',async t=>{
 const a=await app(t);a.click('start');a.frame(3);await Promise.resolve();a.frame(5);
 const lights=[];a.renderer.scene.traverse(n=>{if(n.isSpotLight)lights.push(n);});assert.equal(lights.length,1);
 const torch=lights[0];assert.equal(torch.castShadow,true);assert.equal(a.renderer.shadowMap.enabled,true);
 assert.deepEqual(torch.position.toArray(),[0,.035,-.12]);assert.equal(torch.decay,2);assert.equal(torch.intensity,320);
 assert.ok(a.state().torch.casters>0);assert.ok(a.state().torch.receivers>=a.state().torch.casters);
 const arms=a.renderer.camera.getObjectByName('Diver / first-person arms');let materials=0;
 arms.traverse(n=>{if(n.isMesh){materials++;assert.match(n.material.customProgramCacheKey(),/abyss-flashlight-arms-r170-v1/);assert.equal(n.castShadow,false);}});assert.ok(materials>0);
 for(const [tier,size,range] of [['low',256,30],['medium',512,38],['high',768,46]]){
  a.get('quality').value=tier;a.fire(a.get('quality'),'change');a.frame(10);
  assert.equal(a.state().torch.mapSize,size);assert.equal(a.state().torch.distance,range);
 }
 a.turnTo(1.1,-.7);a.frame(10);
 const aim=a.renderer.camera.getWorldDirection(new THREE.Vector3());assert.ok(aim.distanceTo(new THREE.Vector3(...a.state().torch.direction))<1e-12);
 a.key('keydown','KeyF');a.key('keyup','KeyF');a.frame();assert.equal(torch.visible,false);const updates=a.state().torch.updatesRequested;a.frame(60);assert.equal(a.state().torch.updatesRequested,updates);
 a.click('flashlight');a.frame(10);assert.equal(torch.visible,true);assert.ok(a.state().torch.updatesRequested>updates);
 a.key('keydown','KeyP');a.key('keyup','KeyP');const paused=a.state().torch.updatesRequested;a.frame(60);assert.equal(a.state().torch.updatesRequested,paused);
});

test('real held W plus continuous look-right no longer creates camera-left swimming lag',async t=>{
 const a=await app(t);a.click('start');a.turnTo(0,0);a.key('keydown','KeyW');a.frame(90);
 a.key('keydown','ArrowRight');a.frame(120);const moving=a.state();
 assert.ok(Math.hypot(moving.velocity.x,moving.velocity.z)>5.7);assert.ok(Math.abs(moving.lateralSpeed)<1e-10);
 assert.ok(Math.abs(moving.resolvedLateralSpeed)<1e-10);assert.equal(!!moving.input.left,false);
 a.key('keyup','ArrowRight');a.key('keyup','KeyW');a.frame(30);assert.deepEqual(a.state().velocity,{x:0,y:0,z:0});
});

test('local ink reduces only scene visibility, preserves HUD/input/health, freezes and clears outside',async t=>{
 const a=await app(t);a.click('start');a.frame(3);const before=a.state(),position=before.position;
 // Direct effect injection is explicit: this checks app visibility composition,
 // while actual-creature emission/escape is tested with real GLBs separately.
 a.life.inkClouds.emit({origin:position,direction:{x:1,y:0,z:0},id:'app-fixture'});a.frame(36);
 assert.ok(a.state().inkVisibility>.1);assert.ok(Number(a.get('ink-veil').style.opacity)>.1);
 assert.equal(a.get('hud').hidden,false);assert.equal(a.get('oxygen').hidden,false);assert.equal(a.state().health,before.health);
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),css=await readFile(new URL('../dist/abyss.css',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="ink-veil"')<html.indexOf('id="hud"'));assert.match(css,/#ink-veil\{[^}]*pointer-events:none/);
 a.key('keydown','KeyP');a.key('keyup','KeyP');const frozen=a.state();a.frame(100);assert.equal(a.state().inkVisibility,frozen.inkVisibility);assert.deepEqual(a.state().creatures.ink,frozen.creatures.ink);
 a.click('resume');a.key('keydown','KeyA');a.frame(120);a.key('keyup','KeyA');a.frame(120);
 assert.ok(a.state().position.x<position.x-4,'world control still works inside ink');assert.equal(a.state().inkVisibility,0);
 assert.equal(a.state().health,100);assert.deepEqual(a.state().scans,[]);
 a.key('keydown','KeyP');a.key('keyup','KeyP');a.click('home');assert.equal(Number(a.get('ink-veil').style.opacity),0);
 a.click('start');a.frame();assert.equal(a.state().creatures.ink.activeClouds,0);assert.equal(a.state().inkVisibility,0);
});


test('production controls reach the island sand, climb its actual trail and return to swimming',async t=>{
 const a=await app(t);a.click('start');a.frame(2);const height=(p)=>sampleIslandTerrain(p.x,p.z,terrainHeight);
 const water=ISLAND_SAFE_PATH[0];a.travelTo({x:water.x,y:-.2,z:water.z});
 let walked=false,waded=false;
 for(let i=0;i<ISLAND_SAFE_PATH.length;i+=5){const p=ISLAND_SAFE_PATH[i];a.travelTo({x:p.x,y:Math.max(-.2,height(p)+1.65),z:p.z});walked||=a.state().movementMode==='walk';waded||=a.state().wading;}
 const peak=ISLAND_SAFE_PATH.at(-1);a.travelTo({x:peak.x,y:height(peak)+1.65,z:peak.z});
 assert.equal(walked,true);assert.equal(a.state().movementMode,'walk');assert.ok(a.state().position.y>54);assert.equal(a.state().grounded,true);assert.equal(a.get('depth-label').textContent,'CAO ĐỘ');assert.match(a.get('biome').textContent,/ĐỈNH NÚI/);assert.ok(a.state().islandSky.air>.99);assert.equal(a.state().arms.visible,true);assert.ok(a.state().arms.weights.swim<.01);assert.ok(a.state().arms.offset.y<-.07);
 const rest=a.state().position;a.frame(120);unchangedPosition(a.state().position,rest);
 for(let i=ISLAND_SAFE_PATH.length-1;i>=0;i-=5){const p=ISLAND_SAFE_PATH[i];a.travelTo({x:p.x,y:Math.max(-.2,height(p)+1.65),z:p.z});}
 a.travelTo({x:water.x-12,y:-1.5,z:water.z-15});assert.equal(a.state().movementMode,'swim');assert.equal(a.state().rescues,0);assert.equal(a.state().scans.length,0);
});


test('sea presentation follows game time, pauses, resets and cannot move an idle diver',async t=>{
 const a=await app(t);a.frame(120);a.click('start');a.frame(2);
 const initial=a.state();assert.equal(initial.build,'dynamic-sea-v8');assert.ok(initial.sea.time<.1);
 const position=initial.position;a.frame(600);const later=a.state();
 unchangedPosition(later.position,position);assert.deepEqual(later.velocity,{x:0,y:0,z:0});
 assert.ok(later.sea.time>9);assert.equal(a.get('sea-state').textContent,({Calm:'BIỂN ÊM',Moderate:'SÓNG VỪA',Rough:'BIỂN ĐỘNG'}[later.sea.label]));
 a.click('pause');const sea=a.state().sea,sky=a.state().islandSky;a.frame(120);
 assert.deepEqual(a.state().sea,sea);assert.deepEqual(a.state().islandSky,sky);
 a.get('quality').value='low';a.fire(a.get('quality'),'change');a.frame(2);assert.deepEqual(a.state().sea,sea);
 a.click('resume');a.frame(5);assert.ok(a.state().sea.time>sea.time);
 a.click('pause');a.click('home');a.frame(40);a.click('start');a.frame(2);
 assert.ok(a.state().sea.time<.1);assert.ok(a.state().sea.severity<.001);
 unchangedPosition(a.state().position,{x:0,y:-3.2,z:18});
});
