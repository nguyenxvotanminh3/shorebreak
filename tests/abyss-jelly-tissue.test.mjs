// Real Three resources and the actual PNG, with injected texture-load outcomes.
// These tests do not create a GPU renderer or claim rendered visual acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as THREE from '../dist/vendor/three.module.js';
import { createJellyfishColony } from '../dist/abyss-jellyfish.js';

const STEP = 1 / 60, NEAR = { x: -10, y: -22, z: -24 }, FAR = { x: 1000, y: 1000, z: 1000 };
const DEFAULT_URL = './assets/abyss/jelly-tissue-atlas-512.png';
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function texture() {
  // Deliberately starts with different settings to verify DATA configuration.
  const value = new THREE.DataTexture(new Uint8Array([51, 96, 150, 110]), 1, 1);
  value.colorSpace = THREE.SRGBColorSpace; value.flipY = false; value.premultiplyAlpha = true;
  value.wrapS = THREE.ClampToEdgeWrapping; value.wrapT = THREE.RepeatWrapping;
  value.minFilter = THREE.NearestFilter; value.magFilter = THREE.NearestFilter;
  value.generateMipmaps = false; value.anisotropy = 1;
  return value;
}
function inventory(root) {
  const meshes = [], materials = new Set(), geometry = new Map();
  root.traverse(node => {
    if (!node.isMesh) return;
    meshes.push(node); materials.add(node.material);
    geometry.set(node.geometry, [node.geometry.index, node.geometry.index.array,
      ...Object.values(node.geometry.attributes).flatMap(attribute => [attribute, attribute.array])]);
  });
  return { meshes, materials: [...materials], geometry };
}
function rig(t, options = {}) {
  const pending = deferred(), calls = [], events = [], scene = new THREE.Scene();
  const colony = createJellyfishColony(scene, {
    textureLoader: { loadAsync(url) { calls.push(url); return pending.promise; } },
    onAsset: event => events.push(event), ...options
  });
  const resources = inventory(colony.root);
  t.after(() => colony.dispose());
  return { colony, scene, pending, calls, events, ...resources };
}
function show(colony, tier = 'high') {
  colony.update(STEP, colony.snapshot().time + STEP, NEAR, tier);
}
function assertFallback(materials) {
  for (const material of materials) {
    assert.equal(material.uniforms.uTissue.value, null);
    assert.equal(material.uniforms.uTissueReady.value, 0);
  }
}
function countDisposals(resource) {
  const result = { count: 0 };
  resource.addEventListener('dispose', () => result.count++);
  return result;
}

// Decode PNG scanlines independently of a browser image loader. This verifies
// channel layout/orientation and tile gutters, not Three's GPU texture upload.
function decodePNG(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [], idat = [];
  let offset = 8, width = 0, height = 0;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length);
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    assert.ok(end <= bytes.length);
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(end - 4), `${type} CRC`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data.length, 13); assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0], '8-bit, noninterlaced RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') { assert.equal(length, 0); assert.equal(end, bytes.length); }
    chunks.push(type); offset = end;
  }
  assert.equal(chunks[0], 'IHDR'); assert.equal(chunks.at(-1), 'IEND'); assert.ok(idat.length > 0);
  const stride = width * 4, raw = inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(width * height * 4);
  assert.equal(raw.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= 4 ? rgba[at - 4] : 0, b = y ? rgba[at - stride] : 0;
      const c = x >= 4 && y ? rgba[at - stride - 4] : 0, p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2)
        : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      rgba[at] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, rgba, chunks };
}

test('actual original atlas has exact bytes/hash, valid RGBA PNG chunks and non-color tissue channels', async () => {
  const bytes = await readFile(new URL('../dist/assets/abyss/jelly-tissue-atlas-512.png', import.meta.url));
  assert.equal(bytes.length, 261387);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '1e9dbf1e6fe231e0291f2610b534da132aa5d10f4854cf1d1833dcd3074c2673');
  const { width, height, rgba, chunks } = decodePNG(bytes);
  assert.equal(width, 512); assert.equal(height, 512); assert.ok(!chunks.includes('sRGB'));
  const extrema = Array.from({ length: 4 }, () => [255, 0]);
  for (let i = 0; i < rgba.length; i++) {
    const channel = extrema[i % 4]; channel[0] = Math.min(channel[0], rgba[i]); channel[1] = Math.max(channel[1], rgba[i]);
  }
  assert.deepEqual(extrema, [[0, 209], [0, 199], [20, 245], [46, 198]], 'A stores partial thickness, not an opaque background');
  const row = y => rgba.subarray(y * width * 4, (y + 1) * width * 4);
  for (let y = 0; y < 4; y++) assert.deepEqual(row(y), row(4), 'top trail gutter');
  for (let y = 124; y < 128; y++) assert.deepEqual(row(y), row(123), 'trail side of intertile gutter');
  for (let y = 128; y < 132; y++) assert.deepEqual(row(y), row(132), 'bell side of intertile gutter');
  for (let y = 508; y < 512; y++) assert.deepEqual(row(y), row(507), 'bottom bell gutter');
  // PNG row 405 is in the bell after standalone TextureLoader flipY. Four
  // separated green-channel features validate the original internal rosettes.
  const starts = []; let active = false;
  for (let x = 0; x < width; x++) {
    const next = rgba[(405 * width + x) * 4 + 1] > 100;
    if (next && !active) starts.push(x);
    active = next;
  }
  assert.deepEqual(starts, [27, 155, 283, 411]);
});

test('shared shader samples exact bell/trail DATA tiles and retains restrained opacity, water depth and fog', t => {
  const { materials } = rig(t), [bell, trails] = materials;
  assert.equal(bell.fragmentShader, trails.fragmentShader);
  const shader = bell.fragmentShader;
  assert.match(shader, /uniform sampler2D uTissue;/); assert.match(shader, /uniform float uTissueReady;/);
  assert.match(shader, /if \(uTissueReady > \.5\)/);
  assert.match(shader, /float tissueV = clamp\(vJellyUv.y, 0\., 1\.\)/);
  assert.match(shader, /\(4\.5 \+ 375\.0 \* tissueV\) \/ 512\.0/);
  assert.match(shader, /\(388\.5 \+ 119\.0 \* tissueV\) \/ 512\.0/);
  assert.match(shader, /texture2D\(uTissue, vec2\(fract\(vJellyUv.x\), mix\(trailV, bellV, uBell\)\)\)/);
  assert.equal((shader.match(/texture2D\(/g) || []).length, 1);
  assert.match(shader, /\.32 \* tissue.g/); assert.match(shader, /\.075 \* tissue.r/);
  assert.match(shader, /float bellAlpha = clamp\([\s\S]*?\.12, \.70\)/);
  assert.match(shader, /float trailAlpha = clamp\([\s\S]*?\.24, \.73\)/);
  assert.match(shader, /alpha = mix\(trailAlpha, bellAlpha, uBell\)/);
  const absorption = shader.indexOf('tint *= exp(');
  assert.ok(absorption > shader.indexOf('alpha = mix(trailAlpha'));
  assert.ok(shader.indexOf('gl_FragColor') > absorption);
  assert.ok(shader.indexOf('tonemapping_fragment') < shader.indexOf('colorspace_fragment'));
  assert.ok(shader.indexOf('colorspace_fragment') < shader.indexOf('fog_fragment'));
  assert.equal(bell.uniforms.uBell.value, 1); assert.equal(trails.uniforms.uBell.value, 0);
  assert.equal(bell.uniforms.uTissue, trails.uniforms.uTissue);
  assert.equal(bell.uniforms.uTissueReady, trails.uniforms.uTissueReady);
  assertFallback(materials);
});

test('atlas request is lazy until first positive visible update and pending requests never duplicate', async t => {
  const { colony, calls, events, materials, pending } = rig(t);
  assert.deepEqual(calls, []);
  for (const dt of [0, -1, NaN, Infinity]) colony.update(dt, 10, NEAR);
  for (let frame = 1; frame <= 20; frame++) colony.update(STEP, frame * STEP, FAR, 'high');
  assert.equal(colony.snapshot().visible, 0); assert.deepEqual(calls, []);
  show(colony); assert.ok(colony.snapshot().visible > 0); assert.deepEqual(calls, [DEFAULT_URL]);
  for (let i = 0; i < 50; i++) show(colony, ['high', 'medium', 'low'][i % 3]);
  assert.deepEqual(calls, [DEFAULT_URL]); assert.deepEqual(events, []); assertFallback(materials);
  pending.resolve(texture()); await flush();
  assert.deepEqual(events, [{ id: 'jelly-tissue', status: 'ready' }]);
});

test('read-only tissue status reports lifecycle separately from the untouched motion snapshot', async t => {
  const r = rig(t), failed = rig(t);
  assert.equal(r.colony.tissueStatus, 'idle'); assert.ok(!Object.hasOwn(r.colony.snapshot(), 'tissueStatus'));
  assert.equal(Object.getOwnPropertyDescriptor(r.colony, 'tissueStatus').set, undefined);
  assert.throws(() => { r.colony.tissueStatus = 'ready'; }, TypeError);
  show(r.colony); assert.equal(r.colony.tissueStatus, 'loading');
  r.pending.resolve(texture()); await flush(); assert.equal(r.colony.tissueStatus, 'ready');
  show(failed.colony); failed.pending.reject(new Error('offline')); await flush();
  assert.equal(failed.colony.tissueStatus, 'error'); assertFallback(failed.materials);
  r.colony.dispose(); failed.colony.dispose();
  assert.equal(r.colony.tissueStatus, 'disposed'); assert.equal(failed.colony.tissueStatus, 'disposed');
});

test('successful injected atlas is DATA-configured once and shared by every existing mesh/material', async t => {
  const url = '/test/original-tissue.png', r = rig(t, { tissueURL: url }), atlas = texture();
  const versions = r.materials.map(material => material.version);
  show(r.colony); r.pending.resolve(atlas); await flush();
  assert.deepEqual(r.calls, [url]); assert.equal(atlas.colorSpace, THREE.NoColorSpace);
  assert.equal(atlas.flipY, true); assert.equal(atlas.premultiplyAlpha, false);
  assert.equal(atlas.wrapS, THREE.RepeatWrapping); assert.equal(atlas.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(atlas.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(atlas.magFilter, THREE.LinearFilter);
  assert.equal(atlas.generateMipmaps, true); assert.equal(atlas.anisotropy, 2); assert.equal(atlas.version, 1);
  for (const mesh of r.meshes) {
    assert.equal(mesh.material.uniforms.uTissue.value, atlas); assert.equal(mesh.material.uniforms.uTissueReady.value, 1);
    assert.equal(mesh.material.forceSinglePass, true); assert.equal(mesh.material.depthWrite, false);
  }
  assert.deepEqual(r.materials.map(material => material.version), versions, 'uniform arrival does not rebuild shader materials');
  assert.equal(r.meshes.length, 8); assert.equal(r.materials.length, 2); assert.equal(r.geometry.size, 8);
  assert.equal(r.colony.stats.maxDrawCalls, 8); assert.equal(r.colony.stats.vertices, 6876);
  assert.equal(r.colony.stats.maxTriangles, 12672);
});

test('loaded atlas, geometry, UVs, attributes and materials retain identity across culling, tiers and clock reset', async t => {
  const r = rig(t), atlas = texture(), uvCopies = [...r.geometry.keys()].map(g => g.attributes.uv.array.slice());
  show(r.colony); r.pending.resolve(atlas); await flush();
  const textureVersion = atlas.version;
  for (let i = 0; i < 600; i++) r.colony.update(STEP, (i + 2) * STEP, i % 100 < 50 ? NEAR : FAR, ['high', 'medium', 'low'][i % 3]);
  r.colony.update(STEP, STEP, NEAR, 'high');
  const after = inventory(r.colony.root);
  assert.deepEqual(after.meshes, r.meshes); assert.deepEqual(after.materials, r.materials);
  let index = 0;
  for (const [geometry, attributes] of r.geometry) {
    after.geometry.get(geometry).forEach((attribute, i) => assert.equal(attribute, attributes[i]));
    assert.deepEqual(geometry.attributes.uv.array, uvCopies[index++]);
  }
  assert.equal(atlas.version, textureVersion); assert.deepEqual(r.calls, [DEFAULT_URL]);
  assert.equal(r.events.length, 1);
});

test('successful tissue loading and failed fallback have identical fixed-step motion, topology and live poses', async t => {
  const a = rig(t), b = rig(t);
  show(a.colony); show(b.colony); a.pending.resolve(texture()); b.pending.reject(new Error('offline')); await flush();
  for (let frame = 2; frame <= 400; frame++) {
    const tier = ['high', 'medium', 'low'][Math.floor(frame / 47) % 3], observer = frame % 100 < 70 ? NEAR : FAR;
    a.colony.update(STEP, frame * STEP, observer, tier); b.colony.update(STEP, frame * STEP, observer, tier);
  }
  assert.deepEqual(a.colony.snapshot(true), b.colony.snapshot(true));
  for (let i = 0; i < a.meshes.length; i++) {
    const ga = a.meshes[i].geometry, gb = b.meshes[i].geometry;
    assert.deepEqual(ga.index.array, gb.index.array); assert.deepEqual(ga.drawRange, gb.drawRange);
    assert.deepEqual(ga.boundingSphere, gb.boundingSphere); assert.deepEqual(ga.boundingBox, gb.boundingBox);
    for (const name of Object.keys(ga.attributes)) assert.deepEqual(ga.attributes[name].array, gb.attributes[name].array);
  }
});

test('async load failure keeps procedural fallback and movement without retries on reentry or reset', async t => {
  const r = rig(t); show(r.colony); const before = r.colony.snapshot().time;
  r.pending.reject(new Error('tissue unavailable')); await flush(); assertFallback(r.materials);
  assert.deepEqual(r.events, [{ id: 'jelly-tissue', status: 'error', message: 'tissue unavailable' }]);
  r.colony.update(STEP, before + STEP, FAR); show(r.colony, 'low');
  r.colony.update(STEP, STEP, NEAR, 'high'); show(r.colony);
  assert.ok(r.colony.snapshot().time > before); assert.deepEqual(r.calls, [DEFAULT_URL]); assert.equal(r.events.length, 1);
});

test('synchronous loader failures and invalid loader results are contained as fallback errors', async t => {
  for (const [loader, message] of [
    [{ loadAsync() { throw new Error('sync error'); } }, 'sync error'],
    [{ loadAsync: async () => null }, 'Jelly tissue loader must return a Three texture']
  ]) {
    const r = rig(t, { textureLoader: loader });
    assert.doesNotThrow(() => show(r.colony)); await flush(); assertFallback(r.materials);
    assert.equal(r.events.length, 1); assert.equal(r.events[0].status, 'error');
    assert.equal(r.events[0].message, message);
    show(r.colony); assert.equal(r.events.length, 1);
  }
});

test('disposal before first visibility performs no asset request and releases original resources once', t => {
  const r = rig(t), watched = [...r.materials, ...r.geometry.keys()].map(countDisposals);
  r.colony.dispose(); r.colony.dispose(); show(r.colony);
  assert.deepEqual(r.calls, []); assert.deepEqual(r.events, []); assertFallback(r.materials);
  assert.equal(r.scene.children.length, 0); assert.ok(watched.every(item => item.count === 1));
});

test('ready atlas is disposed exactly once alongside shared materials and clears all sampler references', async t => {
  const r = rig(t), atlas = texture(), watched = [atlas, ...r.materials, ...r.geometry.keys()].map(countDisposals);
  show(r.colony); r.pending.resolve(atlas); await flush(); r.colony.dispose(); r.colony.dispose(); show(r.colony);
  assert.ok(watched.every(item => item.count === 1)); assertFallback(r.materials);
  assert.equal(r.events.length, 1); assert.equal(r.events[0].status, 'ready'); assert.equal(r.scene.children.length, 0);
});

test('late texture arrival after disposal is released once without reviving uniforms, meshes or notifications', async t => {
  const r = rig(t), atlas = texture(), watched = countDisposals(atlas);
  show(r.colony); r.colony.dispose(); r.colony.dispose(); r.pending.resolve(atlas); await flush();
  r.colony.dispose(); show(r.colony); await flush();
  assert.equal(watched.count, 1); assertFallback(r.materials); assert.deepEqual(r.events, []);
  assert.equal(r.colony.tissueStatus, 'disposed');
  assert.equal(r.scene.children.length, 0); assert.equal(r.colony.root.children.length, 0);
  assert.deepEqual(r.calls, [DEFAULT_URL]);
});

test('late rejection after disposal stays contained and does not emit stale asset errors', async t => {
  const r = rig(t); show(r.colony); r.colony.dispose(); r.pending.reject(new Error('late network error')); await flush();
  assertFallback(r.materials); assert.deepEqual(r.events, []); assert.equal(r.scene.children.length, 0);
  assert.equal(r.colony.tissueStatus, 'disposed');
});

test('throwing asset observers cannot break ready/error fallback or resource cleanup', async t => {
  for (const success of [true, false]) {
    let calls = 0;
    const r = rig(t, { onAsset() { calls++; throw new Error('observer failure'); } }), atlas = texture(), watched = countDisposals(atlas);
    show(r.colony);
    if (success) r.pending.resolve(atlas); else r.pending.reject(new Error('asset failure'));
    await flush(); assert.equal(calls, 1);
    if (success) assert.equal(r.materials[0].uniforms.uTissue.value, atlas); else assertFallback(r.materials);
    r.colony.dispose(); assertFallback(r.materials);
    assert.equal(watched.count, success ? 1 : 0);
    if (!success) atlas.dispose();
  }
});

test('observer-triggered disposal during ready notification releases the atlas without reviving it', async t => {
  let colony;
  const r = rig(t, { onAsset() { colony.dispose(); } }), atlas = texture(), watched = countDisposals(atlas);
  colony = r.colony; show(colony); r.pending.resolve(atlas); await flush(); colony.dispose();
  assert.equal(watched.count, 1); assertFallback(r.materials); assert.equal(r.scene.children.length, 0);
});

test('independent colonies own their injected textures without cross-disposal', async t => {
  const a = rig(t), b = rig(t), atlasA = texture(), atlasB = texture();
  const countA = countDisposals(atlasA), countB = countDisposals(atlasB);
  show(a.colony); show(b.colony); a.pending.resolve(atlasA); b.pending.resolve(atlasB); await flush();
  a.colony.dispose(); assert.equal(countA.count, 1); assert.equal(countB.count, 0);
  assert.equal(b.materials[0].uniforms.uTissue.value, atlasB); b.colony.dispose(); assert.equal(countB.count, 1);
});
