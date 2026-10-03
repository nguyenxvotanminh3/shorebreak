// Real Three geometry/material and numerical plume checks. No renderer or GPU
// shader compilation is implied by this suite; visual QA is a separate step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import { createInkClouds, INK_CLOUD_LIMITS } from '../dist/abyss-ink-cloud.js';

const ORIGIN = { x: 12, y: -24, z: -37 }, DIRECTION = { x: 0, y: -.2, z: 1 };
const EYE = { x: 12, y: -23, z: -27 };
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const finite = values => { for (const value of values) assert.ok(Number.isFinite(value), `Nonfinite ${value}`); };
function rig(t) {
  const scene = new THREE.Scene(), ink = createInkClouds(scene), mesh = ink.root.children[0];
  t.after(() => ink.dispose());
  return { scene, ink, mesh };
}
function emit(ink, id = 'test', origin = ORIGIN, direction = DIRECTION) {
  assert.equal(ink.emit({ origin, direction, id, time: 18 }), true);
}
function advance(ink, duration, hz = 60, tier = 'high', observer = EYE) {
  const count = Math.round(duration * hz), dt = duration / count;
  for (let i = 0; i < count; i++) ink.update(dt, 18 + i * dt, observer, tier);
}
function buffers(mesh) { return Object.values(mesh.geometry.attributes).flatMap(a => [a, a.array]); }
function pointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

test('two clouds share one bounded instanced quad and depth-tested, texture-free pigment material', t => {
  const { scene, ink, mesh } = rig(t);
  assert.equal(scene.children.length, 1); assert.equal(ink.root.children.length, 1);
  assert.equal(mesh.geometry.isInstancedBufferGeometry, true);
  assert.equal(mesh.geometry.attributes.position.count, 4); assert.equal(mesh.geometry.index.count, 6);
  assert.equal(mesh.geometry.attributes.inkCenter.count, 48);
  assert.equal(mesh.geometry.attributes.inkPuff.count, 48);
  assert.equal(mesh.geometry.attributes.inkNoise.count, 48);
  assert.equal(mesh.geometry.instanceCount, 0); assert.equal(mesh.visible, false);
  assert.equal(mesh.material.transparent, true); assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.material.forceSinglePass, true);
  assert.equal(mesh.material.blending, THREE.NormalBlending); assert.equal(mesh.material.fog, true);
  assert.equal(mesh.material.side, THREE.FrontSide);
  assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
  assert.ok(!Object.values(mesh.material.uniforms).some(u => u.value?.isTexture));
  assert.equal(ink.stats, INK_CLOUD_LIMITS); assert.ok(Object.isFrozen(ink.stats));
  assert.ok(Object.isFrozen(ink.stats.puffsPerCloud));
  assert.deepEqual(ink.stats.puffsPerCloud, { low: 12, medium: 18, high: 24 });
  assert.equal(ink.stats.maxDrawCalls, 1); assert.equal(ink.stats.maxTriangles, 96);
  assert.equal(ink.stats.textures, 0); assert.equal(ink.stats.renderTargets, 0);
});

test('shader places puffs in world/view space with opaque-depth occlusion and soft curling edges', t => {
  const { mesh } = rig(t), material = mesh.material;
  assert.match(material.vertexShader, /viewMatrix \* vec4\(inkCenter, 1\.\)/);
  assert.match(material.vertexShader, /projectionMatrix \* mvPosition/);
  assert.doesNotMatch(material.vertexShader, /modelMatrix|gl_Position\s*=\s*vec4/);
  assert.match(material.fragmentShader, /inkNoise/); assert.match(material.fragmentShader, /curl/);
  assert.match(material.fragmentShader, /smoothstep/); assert.match(material.fragmentShader, /discard/);
  assert.match(material.fragmentShader, /vec3\(\.0018, \.0032, \.006\)/);
  assert.match(material.fragmentShader, /fog_fragment/);
  assert.match(material.fragmentShader, /tonemapping_fragment/);
  assert.match(material.fragmentShader, /colorspace_fragment/);
  assert.doesNotMatch(material.fragmentShader, /gl_FragDepth|sampler2D|gl_FragCoord/);
});

test('emission copies a finite world anchor, normalizes direction and reports the release time', t => {
  const { ink } = rig(t), origin = { ...ORIGIN }, direction = { x: 0, y: 0, z: 10 };
  emit(ink, 'one', origin, direction);
  origin.x = 1000; direction.z = -100;
  const c = ink.snapshot().clouds[0];
  assert.deepEqual(c.origin, ORIGIN); assert.deepEqual(c.direction, { x: 0, y: 0, z: 1 });
  assert.deepEqual(c.center, ORIGIN); assert.equal(c.releasedAt, 18); assert.equal(c.age, 0);
  assert.ok(c.lifetime >= 9.6 && c.lifetime <= 11.2);
  assert.equal(ink.snapshot().activeClouds, 1); assert.equal(ink.snapshot().instances, 18);
});

test('clouds expand and slowly advect away from the release point without following the emitter', t => {
  const { ink, mesh } = rig(t); emit(ink);
  advance(ink, .5); const early = ink.snapshot().clouds[0], earlyRadius = mesh.geometry.attributes.inkPuff.getX(0);
  advance(ink, 4); const late = ink.snapshot().clouds[0];
  assert.ok(late.radialRadius > early.radialRadius * 1.7);
  assert.ok(late.axialRadius > early.axialRadius);
  assert.ok(late.center.z > early.center.z); assert.deepEqual(late.origin, ORIGIN);
  assert.ok(mesh.geometry.attributes.inkPuff.getX(0) > earlyRadius);
  assert.ok(pointDistance(late.center, ORIGIN) < 5);
});

test('tiers cap active instances at 24/36/48 while preserving one shared draw', t => {
  const { ink, mesh } = rig(t); emit(ink, 'first'); emit(ink, 'second', { x: -5, y: -16, z: -48 });
  const geometry = mesh.geometry, material = mesh.material, allocations = buffers(mesh);
  for (const [tier, expected] of [['low', 24], ['medium', 36], ['high', 48]]) {
    ink.update(.01, 18, EYE, tier);
    assert.equal(mesh.geometry.instanceCount, expected); assert.equal(ink.snapshot().drawCalls, 1);
    assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
    assert.deepEqual(buffers(mesh), allocations);
  }
  ink.update(.01, 18, EYE, 'invalid-tier'); assert.equal(mesh.geometry.instanceCount, 48);
});

test('pool rejects duplicate active IDs and replaces the oldest emission at its fixed capacity', t => {
  const { ink } = rig(t); emit(ink, 'first'); advance(ink, .5); emit(ink, 'second');
  assert.equal(ink.emit({ id: 'second', origin: ORIGIN, direction: DIRECTION }), false);
  emit(ink, 'third');
  assert.equal(ink.snapshot().activeClouds, 2);
  assert.deepEqual(ink.snapshot().clouds.map(c => c.id).sort(), ['second', 'third']);
  assert.ok(ink.snapshot().instances <= 48);
});

test('density is world-local, bounded, strongest in the core, and has compact spatial support', t => {
  const { ink } = rig(t); emit(ink); advance(ink, 1.2);
  const c = ink.snapshot().clouds[0], point = { ...c.center };
  close(ink.sampleDensity(point), 1);
  const outer = { x: point.x + c.radialRadius * .72, y: point.y, z: point.z };
  assert.ok(ink.sampleDensity(outer) > 0 && ink.sampleDensity(outer) < .7);
  assert.equal(ink.sampleDensity({ x: point.x + 50, y: point.y, z: point.z }), 0);
  const before = JSON.stringify(ink.snapshot());
  for (let i = 0; i < 50; i++) {
    const d = ink.sampleDensity({ x: point.x + i * .1, y: point.y, z: point.z });
    assert.ok(d >= 0 && d <= 1);
  }
  assert.equal(JSON.stringify(ink.snapshot()), before, 'sampling does not mutate cloud state');
});

test('density and physical cloud shape are independent of quality and observer location', t => {
  const a = rig(t).ink, b = rig(t).ink; emit(a); emit(b);
  advance(a, 2.5, 60, 'low', { x: -500, y: 80, z: 200 });
  advance(b, 2.5, 60, 'high', { x: 500, y: -180, z: -200 });
  assert.deepEqual(a.snapshot().clouds, b.snapshot().clouds);
  const center = a.snapshot().clouds[0].center;
  for (let x = -5; x < 5; x += .25) {
    const point = { x: center.x + x, y: center.y, z: center.z };
    close(a.sampleDensity(point), b.sampleDensity(point));
  }
});

test('overlapping cloud density combines without exceeding one', t => {
  const { ink } = rig(t); emit(ink, 'one'); emit(ink, 'two'); advance(ink, 2);
  const center = ink.snapshot().clouds[0].center;
  close(ink.sampleDensity(center), 1);
  const point = { x: center.x + 1.2, y: center.y, z: center.z };
  assert.ok(ink.sampleDensity(point) > 0 && ink.sampleDensity(point) <= 1);
});

test('puffs sort back to front with stable instance storage', t => {
  const { ink, mesh } = rig(t); emit(ink, 'one'); emit(ink, 'two', { x: 14, y: -24, z: -31 });
  advance(ink, 1.5);
  const points = mesh.geometry.attributes.inkCenter;
  let previous = Infinity;
  for (let i = 0; i < mesh.geometry.instanceCount; i++) {
    const distance = Math.hypot(points.getX(i) - EYE.x, points.getY(i) - EYE.y, points.getZ(i) - EYE.z);
    assert.ok(distance <= previous + 1e-5); previous = distance;
  }
});

test('dt zero freezes age, shader phase, attributes, visibility and absolute clock changes', t => {
  const { ink, mesh } = rig(t); emit(ink); advance(ink, 1.3);
  const before = ink.snapshot(), p = mesh.geometry.attributes.inkCenter.array.slice();
  const puff = mesh.geometry.attributes.inkPuff.array.slice(), noise = mesh.geometry.attributes.inkNoise.array.slice();
  const version = mesh.geometry.attributes.inkCenter.version;
  for (let i = 0; i < 20; i++) ink.update(0, 9999 + i, { x: i, y: i, z: i }, 'low');
  assert.deepEqual(ink.snapshot(), before); assert.deepEqual(mesh.geometry.attributes.inkCenter.array, p);
  assert.deepEqual(mesh.geometry.attributes.inkPuff.array, puff); assert.deepEqual(mesh.geometry.attributes.inkNoise.array, noise);
  assert.equal(mesh.geometry.attributes.inkCenter.version, version);
});

test('absolute-time jumps cannot prematurely expire clouds and resumed dt advances normally', t => {
  const { ink } = rig(t); emit(ink); ink.update(.1, 100000, EYE, 'high');
  close(ink.snapshot().clouds[0].age, .1);
  ink.update(.1, -400, EYE, 'high'); close(ink.snapshot().clouds[0].age, .2);
  ink.update(20, 900000, EYE, 'high');
  assert.equal(ink.snapshot().activeClouds, 0); assert.equal(ink.snapshot().instances, 0);
});

test('fade is gradual and the cloud fully expires within the 9.6–11.2 second budget', t => {
  const { ink, mesh } = rig(t); emit(ink); advance(ink, 2);
  const early = ink.snapshot().clouds[0].strength; advance(ink, 5);
  const late = ink.snapshot().clouds[0];
  assert.ok(late.strength > 0 && late.strength < early * .6);
  advance(ink, 4.5);
  assert.equal(ink.snapshot().activeClouds, 0); assert.equal(mesh.visible, false);
  assert.equal(mesh.geometry.instanceCount, 0); assert.equal(ink.sampleDensity(late.center), 0);
});

test('analytic age and cloud shape agree across 30/60/120 Hz', t => {
  const states = [];
  for (const hz of [30, 60, 120]) {
    const { ink } = rig(t); emit(ink); advance(ink, 4.2, hz); states.push(ink.snapshot().clouds[0]);
  }
  for (const c of states) {
    close(c.age, states[0].age); close(c.strength, states[0].strength);
    close(c.radialRadius, states[0].radialRadius); close(c.axialRadius, states[0].axialRadius);
    assert.ok(pointDistance(c.center, states[0].center) < 1e-8);
  }
});

test('optional bend keeps initial nozzle alignment before gently turning toward its target', t => {
  const { ink } = rig(t), bend = { x: 1, y: 0, z: 1 };
  assert.equal(ink.emit({ origin: ORIGIN, direction: { x: 0, y: 0, z: 1 }, bendDirection: bend }), true);
  bend.x = -90;
  ink.update(.19, 0, EYE); const start = ink.snapshot().clouds[0];
  assert.deepEqual(start.plumeDirection, start.direction); close(start.center.x, ORIGIN.x + .105 * .19);
  ink.update(.5, 0, EYE); const middle = ink.snapshot().clouds[0];
  assert.ok(middle.plumeDirection.x > 0 && middle.plumeDirection.x < Math.SQRT1_2);
  ink.update(.7, 0, EYE); const end = ink.snapshot().clouds[0];
  close(end.plumeDirection.x, Math.SQRT1_2); close(end.plumeDirection.z, Math.SQRT1_2);
  assert.deepEqual(end.direction, { x: 0, y: 0, z: 1 });
  close(ink.sampleDensity(end.center), 1);
});

test('vertical, zero and opposite-bend directions remain finite and do not hard-reverse', t => {
  const { ink, mesh } = rig(t);
  for (const direction of [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 0 }]) {
    ink.reset();
    assert.equal(ink.emit({ origin: ORIGIN, direction, bendDirection: { x: -direction.x, y: -direction.y, z: -direction.z } }), true);
    advance(ink, 2);
    const c = ink.snapshot().clouds[0];
    close(Math.hypot(c.direction.x, c.direction.y, c.direction.z), 1);
    close(Math.hypot(c.plumeDirection.x, c.plumeDirection.y, c.plumeDirection.z), 1);
    assert.ok(c.direction.x * c.plumeDirection.x + c.direction.y * c.plumeDirection.y + c.direction.z * c.plumeDirection.z > 0);
    for (const attribute of Object.values(mesh.geometry.attributes)) finite(attribute.array);
  }
});

test('malformed inputs cannot produce nonfinite geometry or density', t => {
  const { ink, mesh } = rig(t);
  for (const event of [null, {}, { origin: ORIGIN }, { origin: ORIGIN, direction: { x: Infinity, y: 0, z: 1 } },
    { origin: { x: NaN, y: 0, z: 0 }, direction: DIRECTION },
    { origin: { x: 1e308, y: 0, z: 0 }, direction: DIRECTION },
    { origin: ORIGIN, direction: { x: 1e308, y: 1e308, z: 1e308 } }]) assert.equal(ink.emit(event), false);
  emit(ink);
  for (const dt of [NaN, Infinity, -1, 0]) ink.update(dt, Infinity, null, null);
  ink.update(.1, NaN, { x: Infinity, y: 0, z: 0 }, 'nope');
  for (const attribute of Object.values(mesh.geometry.attributes)) finite(attribute.array);
  for (const point of [null, {}, { x: NaN, y: 0, z: 0 }, { x: Infinity, y: 0, z: 0 }]) assert.equal(ink.sampleDensity(point), 0);
});

test('long repeated sessions preserve geometry, materials, attributes and hard pool limits', t => {
  const { ink, mesh } = rig(t), geometry = mesh.geometry, material = mesh.material, original = buffers(mesh);
  for (let i = 0; i < 2400; i++) {
    if (i % 19 === 0) emit(ink, i);
    ink.update(1 / 60, i / 60, EYE, i % 3 === 0 ? 'low' : i % 3 === 1 ? 'medium' : 'high');
    assert.ok(mesh.geometry.instanceCount <= 48);
  }
  assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
  const after = buffers(mesh); after.forEach((value, i) => assert.equal(value, original[i]));
  for (const attribute of Object.values(mesh.geometry.attributes)) finite(attribute.array);
});

test('reset empties all clouds, clears density and allows deterministic reuse', t => {
  const { ink, mesh } = rig(t); emit(ink); advance(ink, 2); const before = ink.snapshot().clouds[0];
  ink.reset(); assert.equal(ink.snapshot().activeClouds, 0); assert.equal(ink.snapshot().time, 0);
  assert.equal(ink.sampleDensity(before.center), 0); assert.equal(mesh.visible, false);
  assert.ok(mesh.geometry.attributes.inkCenter.array.every(value => value === 0));
  emit(ink); advance(ink, 2); assert.deepEqual(ink.snapshot().clouds[0], before);
});

test('disposal frees resources exactly once and all late calls are harmless', t => {
  const { ink, mesh, scene } = rig(t); let geometries = 0, materials = 0;
  mesh.geometry.addEventListener('dispose', () => geometries++);
  mesh.material.addEventListener('dispose', () => materials++);
  emit(ink); advance(ink, 1); ink.dispose();
  const before = ink.snapshot();
  ink.dispose(); ink.reset(); ink.update(1, 99, EYE);
  assert.equal(ink.emit({ origin: ORIGIN, direction: DIRECTION }), false);
  assert.equal(ink.sampleDensity(ORIGIN), 0); assert.deepEqual(ink.snapshot(), before);
  assert.equal(scene.children.length, 0); assert.equal(geometries, 1); assert.equal(materials, 1);
  assert.equal(before.disposed, true); assert.equal(before.activeClouds, 0); assert.equal(before.drawCalls, 0);
});

test('runtime motion and sampling contain no per-frame vector, array or GPU-resource creation', () => {
  const source = readFileSync(new URL('../dist/abyss-ink-cloud.js', import.meta.url), 'utf8');
  for (const [begin, end] of [['function refreshCloud', 'function pack'], ['function pack', 'function emit'],
    ['function update', 'function sampleDensity'], ['function sampleDensity', 'function reset']]) {
    const part = source.slice(source.indexOf(begin), source.indexOf(end));
    assert.doesNotMatch(part, /new\s|\.map\(|\.filter\(|\.sort\(|\.slice\(/, `${begin} must reuse storage`);
  }
});
