import * as THREE from './vendor/three.module.js';
import { createAbyssWorld, terrainHeight as baseTerrain } from './abyss-world.js';
import { createIslandWorld } from './abyss-island-world.js';
import { createIslandSky } from './abyss-island-sky.js';
import { sampleIslandTerrain } from './abyss-island-terrain.js';
import { SEA_CYCLE_SECONDS, SEA_REVIEW_TIMES } from './abyss-sea-state.js';

const $ = id => document.getElementById(id);
const canvas = $('view'), viewport = $('viewport');
const stateButtons = [...document.querySelectorAll('[data-state]')];
const viewButtons = [...document.querySelectorAll('[data-view]')];
const controls = [...document.querySelectorAll('button,select')];
const events = new AbortController();
const terrain = (x, z) => sampleIslandTerrain(x, z, baseTerrain);
// These are inspection poses only. Changing sea state never changes the camera.
// The deep pose is offshore so the camera remains above the actual seabed.
const views = {
  surface: { name: 'Surface', position: [20, 2.5, 60], target: [85, 1, 155], caption: 'Fixed surface view · wave shape, foam, horizon, and daylight' },
  shore: { name: 'Shore', position: [66, terrain(66, 107) + 1.75, 107], target: [-70, .5, 140], caption: 'Fixed shore view · production sand and rooted island vegetation' },
  below3: { name: 'Below 3 m', position: [20, -3, 60], target: [38, -.5, 115], caption: '3 m below mean sea level · surface underside and shallow-water light' },
  below30: { name: 'Below 30 m', position: [20, -30, -90], target: [30, -19, -155], caption: '30 m below mean sea level · attenuated sea-state influence at depth' }
};

let renderer, scene, camera, world, island, sky, resizeObserver;
let disposed = false, failed = false, frameID = 0;
let time = SEA_REVIEW_TIMES.calm, paused = true, pendingSample = true;
let selectedState = 'calm', view = 'surface', previous = performance.now(), statusAt = -Infinity;
const observer = { x: 0, y: 0, z: 0, status: 'playing', inAir: false, indoors: false };

function cleanup() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(frameID);
  events.abort();
  resizeObserver?.disconnect();
  // Each owner releases its own geometries, materials, and late-loaded assets.
  island?.dispose();
  sky?.dispose();
  world?.dispose();
  renderer?.renderLists.dispose();
  renderer?.dispose();
  renderer?.forceContextLoss();
}

function showFailure(title, message) {
  if (failed) return;
  failed = true;
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  $('error').hidden = false;
  $('view-label').textContent = 'Rendering unavailable';
  $('mode').textContent = 'Unavailable';
  controls.forEach(control => { control.disabled = true; });
  cleanup();
}

function assetReport(event) {
  if (disposed || event.status !== 'error') return;
  const warning = $('asset-warning');
  warning.hidden = false;
  warning.textContent = `Some assets could not load; production fallback geometry is active. ${event.message || ''}`;
}

function resize() {
  if (disposed || !renderer) return;
  const width = Math.max(1, viewport.clientWidth), height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setView(name) {
  view = name;
  const preset = views[name];
  camera.position.set(...preset.position);
  camera.lookAt(...preset.target);
  camera.updateMatrixWorld();
  Object.assign(observer, { x: camera.position.x, y: camera.position.y, z: camera.position.z, inAir: camera.position.y >= 0 });
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  $('view-caption').textContent = preset.caption;
  // Refresh the production world's culling even while its clock is paused.
  world.setQuality($('quality').value);
  statusAt = -Infinity;
}

function refreshPlayback() {
  $('play').textContent = paused ? 'Play cycle' : 'Pause cycle';
  $('play').setAttribute('aria-pressed', String(!paused));
  stateButtons.forEach(button => button.setAttribute('aria-pressed', String(paused && button.dataset.state === selectedState)));
  statusAt = -Infinity;
}

function setSample(name) {
  time = SEA_REVIEW_TIMES[name];
  selectedState = name;
  paused = true;
  pendingSample = true;
  previous = performance.now();
  refreshPlayback();
}

function setQuality() {
  const quality = $('quality').value;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, { low: .8, medium: 1.2, high: 1.6 }[quality]));
  world.setQuality(quality);
  resize();
  statusAt = -Infinity;
}

function refreshStatus() {
  const state = world.seaState || world.stats.seaState;
  const cycleTime = state.phase * SEA_CYCLE_SECONDS;
  const running = !paused && !document.hidden;
  $('view-label').textContent = `${views[view].name} · ${running ? 'Playing' : 'Paused'} · ${state.label}`;
  $('state-name').textContent = state.label;
  $('mode').textContent = running ? 'Live cycle' : selectedState ? 'Held sample' : 'Paused cycle';
  $('cycle-status').textContent = `${running ? 'Playing' : 'Paused at'} ${cycleTime.toFixed(2)} s`;
  $('cycle-progress').value = cycleTime;
  $('severity').textContent = `${(state.severity * 100).toFixed(1)}%`;
  $('amplitude').textContent = `±${state.amplitude.toFixed(2)} m`;
  for (const key of ['speed', 'wind', 'foam', 'cloud', 'light']) $(key).textContent = state[key].toFixed(3);
  $('depth-influence').textContent = `${(state.depthAttenuation * 100).toFixed(1)}%`;
  $('camera-height').textContent = `${camera.position.y.toFixed(2)} m`;
  $('draw-calls').textContent = renderer.info.render.calls.toLocaleString();
  $('triangles').textContent = renderer.info.render.triangles.toLocaleString();
  $('water-triangles').textContent = world.stats.surfaceTriangles.toLocaleString();
  $('normal-octaves').textContent = String(world.stats.surfaceNormalOctaves);
  $('island-assets').textContent = island.stats.status;
  $('island-instances').textContent = `${island.stats.visible} / ${island.stats.totalLimit}`;
  $('pixel-ratio').textContent = `${renderer.getPixelRatio().toFixed(2)}×`;
}

function frame(now) {
  if (disposed) return;
  const elapsed = Math.min(.05, Math.max(0, (now - previous) / 1000));
  previous = now;
  let dt = paused || document.hidden ? 0 : elapsed;
  if (pendingSample) {
    // A seek uses one positive update at the exact chosen time. Subsequent
    // frames use dt=0 so world, water, island wind, and sky hold the same sample.
    dt = 1 / 60;
    pendingSample = false;
  } else {
    time += dt;
  }
  try {
    const quality = $('quality').value;
    world.update(dt, time, observer, quality);
    island.update(dt, time, observer, quality);
    sky.update(dt, time, camera, { seaState: world.seaState, indoors: false });
    renderer.render(scene, camera);
    if (disposed) return;
    if (now - statusAt >= 100) { refreshStatus(); statusAt = now; }
    frameID = requestAnimationFrame(frame);
  } catch (error) {
    showFailure('The sea could not be drawn', `The review stopped because rendering failed. ${error.message || error}`);
  }
}

addEventListener('pagehide', cleanup, { once: true });
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .97;
  renderer.debug.onShaderError = () => {
    // Finish the current renderer call before releasing its resources.
    queueMicrotask(() => showFailure('A sea shader could not be rendered', 'WebGL 2 is available, but a production shader failed to compile on this browser or graphics device. Reload after updating the browser or graphics driver.'));
  };
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    showFailure('The graphics connection was lost', 'The browser lost its WebGL 2 graphics context. Reload this review to recreate the sea scene.');
  }, { signal: events.signal });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, .08, 360);
  scene.add(camera);
  world = createAbyssWorld(scene, { onAsset: assetReport });
  island = createIslandWorld(scene, { terrain, onAsset: assetReport });
  sky = createIslandSky(scene);
  for (const button of stateButtons) button.addEventListener('click', () => setSample(button.dataset.state), { signal: events.signal });
  for (const button of viewButtons) button.addEventListener('click', () => setView(button.dataset.view), { signal: events.signal });
  $('play').addEventListener('click', () => {
    paused = !paused;
    selectedState = null;
    previous = performance.now();
    refreshPlayback();
  }, { signal: events.signal });
  $('quality').addEventListener('change', setQuality, { signal: events.signal });
  addEventListener('resize', resize, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { previous = performance.now(); statusAt = -Infinity; }, { signal: events.signal });
  if (globalThis.ResizeObserver) { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(viewport); }
  $('cycle-duration').textContent = `${SEA_CYCLE_SECONDS} s cycle`;
  $('cycle-progress').max = SEA_CYCLE_SECONDS;
  setView(view);
  setQuality();
  refreshPlayback();
  // Read-only diagnostics for inspection; all scene controls are ordinary UI.
  Object.defineProperty(window, '__seaReview', { value: Object.freeze({ snapshot: () => ({
    disposed, failed, time, paused, pendingSample, view, quality: $('quality').value,
    camera: camera.position.toArray(), seaState: { ...world.seaState },
    draws: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    islandAssets: island.stats.status, islandInstances: island.stats.visible,
    sky: sky.snapshot()
  }) }) });
  frameID = requestAnimationFrame(frame);
} catch (error) {
  showFailure(renderer ? 'The sea could not be prepared' : 'WebGL 2 is unavailable', renderer
    ? `Scene initialization failed. ${error.message || error}`
    : 'This review needs a browser with WebGL 2 and hardware acceleration enabled. No sea scene was rendered. Enable graphics acceleration or open it in another supported browser, then reload.');
}
