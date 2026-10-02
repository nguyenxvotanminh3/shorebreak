import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createAbyssWorld, terrainHeight } from '../dist/abyss-world.js';
import { createDiveInput } from '../dist/abyss-input.js';
import {
  FIXED_STEP, LIMITS, LANDMARKS, createDive, startDive, stepDive,
  clearMotion, triggerSonar, recoverDiver, makeLocations, distance,
  restoreProgress, serializableProgress,
} from '../dist/abyss-sim.js';

const flatWorld = () => ({ terrain: () => -100, locations: [], colliders: [], threats: [] });
const playing = (overrides = {}) => Object.assign(createDive(), { status: 'playing', pitch: 0, y: -12 }, overrides);
function advance(state, seconds, input = {}, world = flatWorld()) {
  const steps = Math.round(seconds / FIXED_STEP);
  for (let n = 0; n < steps; n++) stepDive(state, input, FIXED_STEP, world);
}
const close = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b} by more than ${epsilon}`);

test('dive start resets expedition state and snapshots do not alias saved arrays', () => {
  const state = playing({ scans: ['glass'], banked: ['glass'], completed: true, rescues: 9 });
  startDive(state);
  assert.equal(state.status, 'playing');
  assert.equal(state.oxygen, LIMITS.oxygen);
  assert.deepEqual(state.scans, []);
  assert.deepEqual(state.banked, []);
  assert.equal(state.completed, false);
  assert.equal(state.rescues, 0);
  const save = { version: 1, banked: ['glass', 'unknown', 'glass', 'rift'], deepest: 51.8 };
  restoreProgress(state, save);
  assert.deepEqual(state.banked, ['glass', 'rift']);
  save.banked.length = 0;
  const result = serializableProgress(state);
  assert.equal(result.deepest, 52);
  result.banked.push('bell');
  assert.deepEqual(state.banked, ['glass', 'rift']);
  state.scans.push('bell');
  assert.deepEqual(state.banked, ['glass', 'rift']);
  restoreProgress(state, { version: 2, banked: ['bell'] });
  assert.deepEqual(state.banked, ['glass', 'rift']);
});

test('movement follows yaw and pitch, normalizes diagonals, and sprint costs oxygen', () => {
  const forward = playing(), diagonal = playing(), sprint = playing();
  advance(forward, 4, { forward: 1 });
  advance(diagonal, 4, { forward: 1, right: 1, up: 1 });
  advance(sprint, 4, { forward: 1, sprint: 1 });
  close(Math.hypot(forward.vx, forward.vy, forward.vz), LIMITS.swim, 1e-6);
  close(Math.hypot(diagonal.vx, diagonal.vy, diagonal.vz), LIMITS.swim, 1e-6);
  close(Math.hypot(sprint.vx, sprint.vy, sprint.vz), LIMITS.sprint, 1e-6);
  assert.ok(sprint.distanceSwum > forward.distanceSwum * 1.5);
  assert.ok(sprint.oxygen < forward.oxygen);
  const turned = playing({ yaw: Math.PI / 2 });
  advance(turned, 1, { forward: 1 });
  assert.ok(turned.x < -4);
  close(turned.z, 18);
  const upward = playing({ pitch: Math.PI / 4 });
  advance(upward, 1, { forward: 1 });
  assert.ok(upward.y > -9 && upward.z < 15);
  const empty = playing({ oxygen: 7 });
  advance(empty, 1, { forward: 1, sprint: 1 });
  assert.equal(empty.sprinting, false);
});

test('fixed-step movement agrees across 30, 60, 120 Hz and jittered render schedules', () => {
  // Matches the bounded accumulator contract in abyss.js; it does not render pixels.
  const run = schedule => {
    const state = playing({ y: -30 });
    let accumulator = 0;
    for (const raw of schedule) {
      accumulator += Math.min(Math.max(raw, 0), .06);
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 6) {
        stepDive(state, { forward: 1, right: 1, sprint: 1 }, FIXED_STEP, flatWorld());
        accumulator -= FIXED_STEP;
        steps++;
      }
      if (steps === 6) accumulator = 0;
    }
    return state;
  };
  const states = [30, 60, 120].map(hz => run(Array(hz * 10).fill(1 / hz)));
  states.push(run(Array.from({ length: 200 }, () => [.01, .03, .01]).flat()));
  for (const state of states.slice(1)) {
    close(state.time, states[0].time, FIXED_STEP + 1e-8);
    assert.ok(distance(state, states[0]) <= LIMITS.sprint * FIXED_STEP + 1e-7);
    close(state.oxygen, states[0].oxygen, .02);
    close(state.vx, states[0].vx, 1e-8);
  }
});

test('zero time and pause freeze every simulation field; clearMotion clears held scan intent', () => {
  const state = playing({ vx: 3, vy: -2, vz: 1, scanTarget: 'glass', scanProgress: .4, sprinting: true });
  triggerSonar(state);
  const snapshot = structuredClone(state);
  for (const dt of [0, -1]) stepDive(state, { forward: 1, scan: 1, turn: 1 }, dt, flatWorld());
  assert.deepEqual(state, snapshot);
  state.status = 'paused';
  const paused = structuredClone(state);
  advance(state, 5, { forward: 1, up: 1, scan: 1 });
  assert.deepEqual(state, paused);
  assert.equal(triggerSonar(state), false);
  clearMotion(state);
  assert.deepEqual([state.vx, state.vy, state.vz, state.scanProgress], [0, 0, 0, 0]);
  assert.equal(state.scanTarget, null);
  assert.equal(state.sprinting, false);
});

test('ascent reaches the surface, refills oxygen and health, and respects surface/floor bounds', () => {
  const state = playing({ y: -35, oxygen: 30, health: 70 });
  advance(state, 9, { up: 1 });
  assert.equal(state.y, .5);
  assert.equal(state.inAir, true);
  assert.ok(state.oxygen > 70);
  assert.ok(state.health > 90 && state.health < 100);
  advance(state, 5);
  assert.equal(state.oxygen, LIMITS.oxygen);
  assert.equal(state.health, 100);
  advance(state, 25, { down: 1 });
  close(state.y, -100 + LIMITS.radius);
  assert.equal(state.inAir, false);
  assert.ok(state.deepest >= 99);
});

test('world bounds and collision pushout are finite, including exact cylinder center', () => {
  const state = playing({ x: LIMITS.world - .1, z: LIMITS.minZ + .1 });
  advance(state, 2, { right: 1, forward: 1 });
  assert.equal(state.x, LIMITS.world);
  assert.equal(state.z, LIMITS.minZ);
  const solid = { x: 0, y: -12, z: 18, height: 6, radius: 2 };
  Object.assign(state, { x: 0, y: -12, z: 18 });
  clearMotion(state);
  stepDive(state, {}, FIXED_STEP, { ...flatWorld(), colliders: [solid] });
  close(Math.hypot(state.x - solid.x, state.z - solid.z), solid.radius + LIMITS.radius);
  for (const value of [state.x, state.y, state.z, state.distanceSwum]) assert.ok(Number.isFinite(value));
});

test('collision pushout onto a rising slope reapplies the terrain floor', () => {
  const state = playing();
  const world = { ...flatWorld(), terrain: x => -20 + x * 5, colliders: [{ x: 0, y: -12, z: 18, height: 6, radius: 2 }] };
  stepDive(state, {}, FIXED_STEP, world);
  assert.ok(state.x >= 2.65);
  assert.ok(state.y >= world.terrain(state.x, state.z) + LIMITS.radius - 1e-9);
});

test('scan requires a sustained hold, proximity and facing; release and target changes reset progress', () => {
  const world = { ...flatWorld(), locations: [
    { id: 'glass', name: 'Glass', note: 'first', x: 0, y: -12, z: 14 },
    { id: 'bell', name: 'Bell', note: 'second', x: 4, y: -12, z: 18 },
  ] };
  const state = playing();
  advance(state, 1.1, { scan: 1 }, world);
  assert.equal(state.scanTarget, 'glass');
  assert.ok(state.scanProgress > .4 && state.scanProgress < .5);
  assert.deepEqual(state.scans, []);
  advance(state, .4, {}, world);
  assert.equal(state.scanProgress, 0);
  assert.equal(state.scanTarget, null);
  advance(state, .8, { scan: 1 }, world);
  state.yaw = -Math.PI / 2;
  stepDive(state, { scan: 1 }, FIXED_STEP, world);
  assert.equal(state.scanTarget, 'bell');
  close(state.scanProgress, FIXED_STEP / 2.5);
  state.yaw = Math.PI;
  advance(state, 3, { scan: 1 }, world);
  assert.deepEqual(state.scans, []);
  assert.equal(state.scanTarget, null);
  state.yaw = 0;
  state.z = 24;
  advance(state, 3, { scan: 1 }, world);
  assert.deepEqual(state.scans, []);
  state.z = 18;
  advance(state, 2.6, { scan: 1 }, world);
  assert.deepEqual(state.scans, ['glass']);
  assert.equal(state.message.kind, 'scan');
  advance(state, 3, { scan: 1 }, world);
  assert.deepEqual(state.scans, ['glass'], 'a held scan must not duplicate a sample');
});

test('rescue discards only unbanked samples and damage cooldown prevents repeated immediate hits', () => {
  const state = playing({ scans: ['glass', 'bell'], banked: ['glass'], oxygen: 0, health: .1 });
  stepDive(state, {}, FIXED_STEP, flatWorld());
  assert.equal(state.rescues, 1);
  assert.deepEqual(state.scans, ['glass']);
  assert.deepEqual(state.banked, ['glass']);
  assert.notEqual(state.scans, state.banked);
  assert.equal(state.oxygen, LIMITS.oxygen);
  assert.equal(state.health, 100);
  assert.equal(state.message.kind, 'rescue');
  const threat = { x: 0, y: -12, z: 18, radius: 3 };
  const hit = playing();
  const world = { ...flatWorld(), threats: [threat, { ...threat }] };
  stepDive(hit, {}, FIXED_STEP, world);
  assert.equal(hit.health, 75);
  assert.equal(hit.threat, 1);
  stepDive(hit, {}, FIXED_STEP, world);
  assert.equal(hit.health, 75);
  assert.ok(hit.injuryCooldown > 3.9);
  recoverDiver(hit);
  assert.equal(hit.injuryCooldown, 5);
});

test('three samples upload only beside the surface buoy and complete once', () => {
  const state = playing({ scans: LANDMARKS.map(p => p.id), x: 20, y: -.5 });
  stepDive(state, {}, FIXED_STEP, flatWorld());
  assert.deepEqual(state.banked, []);
  assert.equal(state.completed, false);
  state.x = 0;
  state.y = -4;
  stepDive(state, {}, FIXED_STEP, flatWorld());
  assert.deepEqual(state.banked, []);
  state.y = -.6;
  stepDive(state, {}, FIXED_STEP, flatWorld());
  assert.deepEqual(state.banked, ['glass', 'bell', 'rift']);
  assert.notEqual(state.scans, state.banked);
  assert.equal(state.completed, true);
  assert.equal(state.message.kind, 'complete');
  state.message = null;
  advance(state, 1);
  assert.equal(state.message, null);
  recoverDiver(state);
  assert.equal(state.completed, true);
  assert.deepEqual(state.scans, ['glass', 'bell', 'rift']);
});

test('sonar cooldown survives repeated trigger attempts and resets after nine seconds', () => {
  const state = playing();
  assert.equal(triggerSonar(state), true);
  assert.equal(triggerSonar(state), false);
  advance(state, 6.1);
  assert.equal(state.sonar, 0);
  assert.ok(state.sonarCooldown > 2.8);
  assert.equal(triggerSonar(state), false);
  advance(state, 3);
  assert.equal(triggerSonar(state), true);
});

test('keyboard aliases, opposing directions and touch pointer ownership remain independent', () => {
  const input = createDiveInput();
  assert.equal(input.key('NotAKey', true), false);
  for (const code of ['ControlLeft', 'ControlRight', 'KeyC']) assert.equal(input.key(code, true), true);
  input.key('ControlLeft', false);
  input.key('KeyC', false);
  assert.equal(input.read().down, 1);
  input.key('ControlRight', false);
  assert.equal(input.read().down, undefined);
  input.key('ShiftLeft', true);
  input.key('ShiftRight', true);
  input.key('ShiftLeft', false);
  assert.equal(input.read().sprint, 1);
  input.key('KeyE', true);
  input.pointer(10, 'scan', true);
  input.pointer(11, 'scan', true);
  input.pointer(10, 'scan', false);
  input.key('KeyE', false);
  assert.equal(input.read().scan, 1);
  input.pointer(11, 'scan', false);
  input.pointer(11, 'scan', false);
  assert.equal(input.read().scan, undefined);
  input.key('ArrowLeft', true);
  input.key('ArrowRight', true);
  input.key('ArrowUp', true);
  assert.equal(input.read().turn, 0);
  assert.equal(input.read().tilt, 1);
  input.key('ArrowRight', false);
  assert.equal(input.read().turn, 1);
  input.pointer(12, 'forward', true);
  input.pointer(12, 'up', true);
  assert.equal(input.read().forward, undefined);
  assert.equal(input.read().up, 1);
  input.clear();
  assert.deepEqual(input.read(), { turn: 0, tilt: 0 });
});

// A simple keyboard-speed pilot proves reachability through actual terrain/colliders.
// It may change view direction but never teleports or modifies oxygen/health.
function swimTo(state, destination, world, maxSeconds = 75) {
  for (let n = 0; n < maxSeconds / FIXED_STEP; n++) {
    const dx = destination.x - state.x, dy = destination.y - state.y, dz = destination.z - state.z;
    if (Math.hypot(dx, dy, dz) < .3) { clearMotion(state); return; }
    state.yaw = Math.atan2(-dx, -dz);
    state.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    stepDive(state, { forward: 1 }, FIXED_STEP, world);
    assert.equal(state.rescues, 0, 'route exhausted air or collided lethally');
    assert.ok(state.y >= world.terrain(state.x, state.z) + LIMITS.radius - .05);
  }
  assert.fail(`Unreachable waypoint ${JSON.stringify(destination)} from ${JSON.stringify({ x: state.x, y: state.y, z: state.z })}`);
}

test('all three objectives are reachable, scannable and bankable through the real world', () => {
  const habitat = createAbyssWorld(new THREE.Scene());
  try {
    const world = { terrain: terrainHeight, colliders: habitat.colliders, airBell: habitat.airBell, locations: makeLocations(terrainHeight), threats: [] };
    const state = playing({ x: 0, y: -3.2, z: 18 });
    for (const target of world.locations) {
      swimTo(state, { x: state.x, y: -.5, z: state.z }, world);
      swimTo(state, { x: target.x, y: -.5, z: target.z + 4 }, world);
      swimTo(state, { x: target.x, y: target.y, z: target.z + 4 }, world);
      state.yaw = Math.atan2(-(target.x - state.x), -(target.z - state.z));
      state.pitch = Math.atan2(target.y - state.y, Math.hypot(target.x - state.x, target.z - state.z));
      advance(state, 2.7, { scan: 1 }, world);
      assert.ok(state.scans.includes(target.id), `${target.id} did not scan from its clear approach`);
      swimTo(state, { x: state.x, y: -.5, z: state.z }, world);
      swimTo(state, { x: 0, y: -.5, z: 18 }, world);
      advance(state, .1, {}, world);
      assert.ok(state.banked.includes(target.id));
    }
    assert.equal(state.completed, true);
    assert.equal(state.rescues, 0);
    assert.equal(state.banked.length, 3);
    assert.ok(state.distanceSwum > 800);
  } finally { habitat.dispose(); }
});

test('diving bell has a clear bottom entrance and replenishes oxygen inside its real collision geometry', () => {
  const habitat = createAbyssWorld(new THREE.Scene());
  try {
    const air = habitat.airBell;
    const world = { terrain: terrainHeight, colliders: habitat.colliders, airBell: air, locations: [], threats: [] };
    const state = playing({ x: air.x, y: air.y - 4.5, z: air.z, oxygen: 20 });
    assert.ok(state.y > terrainHeight(state.x, state.z) + LIMITS.radius);
    advance(state, .1, {}, world);
    assert.equal(state.inAir, false);
    swimTo(state, { x: air.x, y: air.y, z: air.z }, world, 10);
    assert.ok(distance(state, air) < .3);
    assert.equal(state.inAir, true);
    advance(state, 7, {}, world);
    assert.equal(state.oxygen, LIMITS.oxygen);
    assert.equal(state.rescues, 0);
    assert.ok(state.y < -20, 'this must be a submerged air pocket, not surface recovery');
  } finally { habitat.dispose(); }
});
