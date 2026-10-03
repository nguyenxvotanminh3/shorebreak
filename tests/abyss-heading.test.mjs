// Camera-relative heading checks use the shipped THREE camera and the production
// movement/input code. No browser, physical keyboard, GPU or pixel-quality claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { createDiveInput } from '../dist/abyss-input.js';
import { createDive, startDive, clearMotion, recoverDiver, stepDive, FIXED_STEP, LIMITS, INTERIOR_MOTION } from '../dist/abyss-sim.js';
import { createAbyssWorld, terrainHeight } from '../dist/abyss-world.js';
import { createDeepBasin, DEEP_BOUNDS } from '../dist/abyss-deep-zone.js';

const source = await readFile(new URL('../dist/abyss.js', import.meta.url), 'utf8');
const cameraOrder = source.match(/camera\.rotation\.set\(state\.pitch,state\.yaw,0,'([^']+)'\)/)?.[1];
assert.equal(cameraOrder, 'YXZ', 'tests must follow the production gameplay camera Euler order');
const camera = new THREE.PerspectiveCamera();
const yaws = [-Math.PI, -2.1, -Math.PI / 2, -.7, 0, .53, Math.PI / 2, 2.7, Math.PI, 919.18591709];
const pitches = [-1.48, -.8, -.22, 0, .63, 1.48];
const keySets = [
  ['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['Space'], ['KeyC'],
  ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyS', 'KeyA'], ['KeyS', 'KeyD'],
  ['KeyW', 'Space'], ['KeyW', 'KeyC'], ['KeyS', 'Space'], ['KeyS', 'KeyC'],
  ['KeyA', 'Space'], ['KeyD', 'KeyC'],
  ['KeyW', 'KeyA', 'Space'], ['KeyS', 'KeyD', 'KeyC'],
  ['KeyW', 'KeyS'], ['KeyA', 'KeyD'], ['Space', 'KeyC'],
  ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'KeyC'],
];
const bounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
const flat = () => ({ terrain: () => -300, locations: [], colliders: [], threats: [] });
const worlds = [
  ['legacy ocean', flat],
  ['optional outdoor contract', () => ({ ...flat(), bounds, boxColliders: [], sampleEnvironment: () => null })],
  ['flooded indoor contract', () => ({ ...flat(), bounds, boxColliders: [], sampleEnvironment: () => ({ indoors: true, floorY: -300, ceilingY: 40, waterLevel: 10 }) })],
];
const diver = overrides => Object.assign(createDive(), { status: 'playing', x: 0, y: -100, z: 0, yaw: 0, pitch: 0 }, overrides);
const position = s => new THREE.Vector3(s.x, s.y, s.z);
const velocity = s => new THREE.Vector3(s.vx, s.vy, s.vz);
const close = (a, b, message = '', tolerance = 2e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`);
function axes(s) {
  camera.rotation.set(s.pitch, s.yaw, 0, cameraOrder);
  camera.updateMatrixWorld(true);
  return {
    forward: camera.getWorldDirection(new THREE.Vector3()),
    right: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(),
  };
}
function controls(keys) {
  const input = createDiveInput();
  keys.forEach(key => input.key(key, true));
  return input.read();
}
function desired(s, input, walking = false) {
  const { forward, right } = axes(s);
  if (walking) { forward.y = 0; forward.normalize(); }
  const target = forward.multiplyScalar((input.forward || 0) - (input.back || 0))
    .addScaledVector(right, (input.right || 0) - (input.left || 0));
  if (!walking) target.y += (input.up || 0) - (input.down || 0);
  if (target.length() > 1) target.normalize();
  if (target.length() < 1e-8) target.set(0, 0, 0);
  return target;
}
function advance(s, input = {}, world = flat(), seconds = 2) {
  for (let n = 0; n < Math.round(seconds / FIXED_STEP); n++) stepDive(s, input, FIXED_STEP, world);
}

for (const [name, makeWorld] of worlds) {
  test(`${name}: W/S/A/D, diagonals and rise match actual camera axes across 60 headings`, () => {
    const world = makeWorld(), seconds = 2, ticks = Math.round(seconds / FIXED_STEP);
    const decay = Math.exp(-4.8 * FIXED_STEP);
    const distanceGain = FIXED_STEP * (ticks - decay * (1 - decay ** ticks) / (1 - decay));
    for (const yaw of yaws) for (const pitch of pitches) for (const keys of keySets) for (const sprint of [false, true]) {
      const s = diver({ yaw, pitch }), input = { ...controls(keys), sprint }, start = position(s);
      const target = desired(s, input), sprintActive = sprint && target.length() > .1;
      target.multiplyScalar(sprintActive ? LIMITS.sprint : LIMITS.swim);
      advance(s, input, world, seconds);
      const label = `${name}; yaw=${yaw}; pitch=${pitch}; keys=${keys}; sprint=${sprint}`;
      assert.ok(velocity(s).distanceTo(target.clone().multiplyScalar(1 - Math.exp(-4.8 * seconds))) < 3e-11, label);
      assert.ok(position(s).sub(start).distanceTo(target.clone().multiplyScalar(distanceGain)) < 3e-10, label);
      assert.ok(velocity(s).length() <= (sprint ? LIMITS.sprint : LIMITS.swim) + 1e-10, label);
      if (keys.length === 1 && (keys[0] === 'KeyW' || keys[0] === 'KeyS')) {
        close(velocity(s).dot(axes(s).right), 0, `no unintended strafe: ${label}`);
      }
    }
  });
}

test('dry walking follows horizontal camera heading without a left bias at any look pitch', () => {
  const floor = -102, world = { ...flat(), bounds, sampleEnvironment: () => ({ indoors: true, floorY: floor, ceilingY: -90, waterLevel: floor - 1 }) };
  for (const yaw of yaws) for (const pitch of pitches) for (const keys of keySets) {
    const s = diver({ yaw, pitch, y: floor + INTERIOR_MOTION.eyeHeight, eyeHeight: INTERIOR_MOTION.eyeHeight, movementMode: 'walk' });
    const input = controls(keys), target = desired(s, input, true).multiplyScalar(INTERIOR_MOTION.walk * (1 - Math.exp(-4.8 * 2)));
    advance(s, input, world);
    assert.equal(s.movementMode, 'walk');
    assert.ok(velocity(s).distanceTo(target) < 3e-11, `yaw=${yaw}; pitch=${pitch}; keys=${keys}`);
    close(s.y, floor + INTERIOR_MOTION.eyeHeight, 'grounded height');
  }
});

test('W to S reversal and release remain collinear with the actual viewing direction', () => {
  for (const [, makeWorld] of worlds) for (const yaw of yaws) for (const pitch of pitches) {
    const world = makeWorld(), s = diver({ yaw, pitch }), { forward, right } = axes(s);
    advance(s, controls(['KeyW']), world);
    for (let n = 0; n < 180; n++) {
      stepDive(s, controls(['KeyS']), FIXED_STEP, world);
      close(velocity(s).dot(right), 0, 'reversal introduces no strafe');
      close(velocity(s).clone().cross(forward).length(), 0, 'reversal is collinear');
    }
    assert.ok(velocity(s).dot(forward) < -5.7);
    advance(s, {}, world, .4);
    assert.deepEqual(velocity(s).toArray(), [0, 0, 0]);
    const rest = position(s).toArray();
    advance(s, {}, world);
    assert.deepEqual(position(s).toArray(), rest);
  }
});

test('heading changes steer owned forward drive immediately without inventing lateral speed', () => {
  for (const [, makeWorld] of worlds) {
    const world = makeWorld(), samples = [];
    for (const sign of [-1, 1]) {
      const s = diver(); advance(s, { forward: 1 }, world);
      s.yaw = sign * Math.PI / 2;
      stepDive(s, { forward: 1 }, FIXED_STEP, world);
      const lateral = velocity(s).dot(axes(s).right);
      samples.push(lateral);
      close(lateral, 0, 'owned movement follows the new heading');
      assert.ok(velocity(s).dot(axes(s).forward) > 5.7, 'turning retains the earned forward speed');
      advance(s, { forward: 1 }, world, 1.5);
      close(velocity(s).dot(axes(s).right), 0, 'fixed-heading movement stays aligned');
    }
    close(samples[0], -samples[1], 'opposite turns remain symmetric');
  }
});

test('continuous left/right turning keeps W velocity aligned with the actual camera', () => {
  for (const [, makeWorld] of worlds) {
    const samples = [-1, 1].map(turn => {
      const s = diver(); advance(s, { forward: 1, turn }, makeWorld());
      const basis = axes(s), v = velocity(s);
      return { lateral: v.dot(basis.right), forward: v.dot(basis.forward) };
    });
    // Before active-drive steering this was -/+1.563 m/s after two seconds.
    close(samples[0].lateral, 0, 'right turn does not slide left');
    close(samples[1].lateral, 0, 'left turn does not slide right');
    close(samples[0].lateral, -samples[1].lateral, 'turning symmetry');
    close(samples[0].forward, samples[1].forward, 'forward symmetry');
  }
});

test('pitch, strafe, diagonals and world-up combinations stay aligned with requested camera-relative motion', () => {
  for (const [, makeWorld] of worlds) for (const keys of keySets.slice(0, 18)) for (const sign of [-1, 1]) {
    const world = makeWorld(), s = diver({ pitch: -.3, yaw: .9 }), input = { ...controls(keys), turn: sign * .7, tilt: sign * .3 };
    for (let n = 0; n < 180; n++) {
      stepDive(s, input, FIXED_STEP, world);
      const wanted = desired(s, input), v = velocity(s);
      close(v.clone().cross(wanted).length(), 0, `input=${keys}; turn/tilt=${sign}`, 5e-10);
      assert.ok(v.dot(wanted) >= -1e-10);
      assert.ok(v.length() <= LIMITS.swim + 1e-9);
    }
  }
});

test('simultaneous direction reversal and view change preserve ordinary braking instead of flipping momentum', () => {
  for (const [, makeWorld] of worlds) {
    const s = diver(), world = makeWorld(); advance(s, { forward: 1 }, world);
    const before = velocity(s); stepDive(s, { back: 1, turn: .1 }, FIXED_STEP, world);
    const target = desired(s, { back: 1 }).multiplyScalar(LIMITS.swim), blend = 1 - Math.exp(-4.8 * FIXED_STEP);
    assert.ok(velocity(s).distanceTo(before.lerp(target, blend)) < 1e-12);
    assert.ok(s.vz < -5, 'a tiny mouse turn must not snap a forward-to-backward reversal');
  }
});

test('neutral coasting never rotates with the view and retains the previous release arithmetic', () => {
  for (const [, makeWorld] of worlds) {
    const world = makeWorld(), still = diver(), turning = diver();
    advance(still, { forward: 1, right: 1 }, world); advance(turning, { forward: 1, right: 1 }, world);
    for (let n = 0; n < 90; n++) {
      stepDive(still, {}, FIXED_STEP, world);
      stepDive(turning, { turn: 1, tilt: -.5 }, FIXED_STEP, world);
      assert.deepEqual(velocity(turning).toArray(), velocity(still).toArray());
      assert.deepEqual(position(turning).toArray(), position(still).toArray());
    }
    assert.deepEqual(velocity(turning).toArray(), [0, 0, 0]);
  }
});

test('arbitrary parallel, sideways and vertical impulses retain world direction during active turning', () => {
  for (const [, makeWorld] of worlds) for (const impulse of [[-3, 0, 0], [0, 0, -3], [0, 0, 8], [2, 4, -1]]) {
    const world = makeWorld(), baseline = diver(), external = diver();
    advance(baseline, { forward: 1 }, world, .5); advance(external, { forward: 1 }, world, .5);
    external.vx += impulse[0]; external.vy += impulse[1]; external.vz += impulse[2];
    const difference = new THREE.Vector3(...impulse);
    for (let n = 0; n < 90; n++) {
      const input = { forward: 1, turn: -.7, tilt: .25 };
      stepDive(baseline, input, FIXED_STEP, world); stepDive(external, input, FIXED_STEP, world);
      difference.multiplyScalar(Math.exp(-4.8 * FIXED_STEP));
      assert.ok(velocity(external).sub(velocity(baseline)).distanceTo(difference) < 1e-11, `impulse=${impulse}; tick=${n}`);
    }
  }
});

test('real creature-hit impulse is excluded from steering ownership on the following turning step', () => {
  const world = flat(), baseline = diver(), hit = diver();
  advance(baseline, { forward: 1 }, world, .5); advance(hit, { forward: 1 }, world, .5);
  stepDive(baseline, { forward: 1 }, FIXED_STEP, world);
  const withThreat = { ...world, threats: [{ x: hit.x + 1, y: hit.y, z: hit.z, radius: 2 }] };
  stepDive(hit, { forward: 1 }, FIXED_STEP, withThreat);
  assert.equal(hit.health, 75);
  const impulse = velocity(hit).sub(velocity(baseline));
  const input = { forward: 1, turn: 1, tilt: .5 };
  stepDive(baseline, input, FIXED_STEP, world); stepDive(hit, input, FIXED_STEP, world);
  assert.ok(velocity(hit).sub(velocity(baseline)).distanceTo(impulse.multiplyScalar(Math.exp(-4.8 * FIXED_STEP))) < 1e-12);
});

test('collision-resolved velocity stays world-space rather than being captured as input steering', () => {
  for (const [, makeWorld] of worlds) {
    const world = makeWorld(); world.colliders = [{ x: 1.2, y: -100, z: -4, radius: 2, height: 20 }];
    const s = diver(); let contact = false;
    for (let n = 0; n < 180; n++) {
      stepDive(s, { forward: 1 }, FIXED_STEP, world);
      if (Math.abs(s.vx) > .01) { contact = true; break; }
    }
    assert.ok(contact, 'must exercise an actual oblique collider response');
    const before = velocity(s); world.colliders = []; s.yaw = -.8;
    const target = desired(s, { forward: 1 }).multiplyScalar(LIMITS.swim), blend = 1 - Math.exp(-4.8 * FIXED_STEP);
    stepDive(s, { forward: 1 }, FIXED_STEP, world);
    assert.ok(velocity(s).distanceTo(before.lerp(target, blend)) < 1e-12, 'contact velocity is not rotated');
  }
});

test('pause, clearMotion, new dive and recovery never retain hidden steering momentum', () => {
  for (const reset of [clearMotion, startDive, recoverDiver]) {
    const s = diver(), world = flat(); advance(s, { forward: 1, turn: .4 }, world);
    s.status = 'paused'; const paused = structuredClone(s);
    stepDive(s, { forward: 1, turn: 1 }, FIXED_STEP, world); assert.deepEqual(s, paused);
    reset(s); s.status = 'playing'; s.y = -100; s.yaw += .8;
    const target = desired(s, { forward: 1 }).multiplyScalar(LIMITS.swim * (1 - Math.exp(-4.8 * FIXED_STEP)));
    stepDive(s, { forward: 1 }, FIXED_STEP, world);
    assert.ok(velocity(s).distanceTo(target) < 1e-12, 'first movement after reset earns only one acceleration step');
  }
});

test('walking gravity is never rotated by active heading correction', () => {
  const world = { ...flat(), sampleEnvironment: () => ({ indoors: true, floorY: -200, ceilingY: 10, waterLevel: -250 }) };
  const straight = diver({ movementMode: 'walk', eyeHeight: INTERIOR_MOTION.eyeHeight, vy: -3 });
  const turning = diver({ movementMode: 'walk', eyeHeight: INTERIOR_MOTION.eyeHeight, vy: -3 });
  for (let n = 0; n < 180; n++) {
    stepDive(straight, { forward: 1 }, FIXED_STEP, world);
    stepDive(turning, { forward: 1, turn: 1, tilt: .3 }, FIXED_STEP, world);
    assert.equal(turning.vy, straight.vy); assert.equal(turning.y, straight.y);
    close(velocity(turning).dot(axes(turning).right), 0, 'walking steering has no lateral lag');
  }
});

test('active steering agrees across 30/60/120 Hz and legacy/optional world contracts', () => {
  const run = (schedule, world) => {
    const s = diver({ yaw: .4, pitch: -.3 }); let accumulator = 0;
    for (const dt of schedule) {
      accumulator += Math.min(dt, .06); let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 6) {
        const input = s.time < 2 ? { forward: 1, turn: -.6, tilt: .2 } : s.time < 4 ? { forward: 1, right: 1, turn: .5, tilt: -.2 } : {};
        stepDive(s, input, FIXED_STEP, world); accumulator -= FIXED_STEP; steps++;
      }
      if (steps === 6) accumulator = 0;
    }
    return s;
  };
  const schedules = [30, 60, 120].map(hz => Array(hz * 6).fill(1 / hz));
  schedules.push(Array.from({ length: 120 }, () => [.01, .03, .01]).flat());
  const reference = run(schedules[0], worlds[0][1]());
  for (const schedule of schedules) for (const [, makeWorld] of worlds) {
    const s = run(schedule, makeWorld());
    assert.ok(position(s).distanceTo(position(reference)) < 1e-9);
    assert.deepEqual(velocity(s).toArray(), [0, 0, 0]);
    close(s.yaw, reference.yaw); close(s.pitch, reference.pitch);
    close(s.time, reference.time, 'fixed-step elapsed time', FIXED_STEP + 1e-8);
  }
});

test('legacy and optional outdoor paths retain exact state agreement throughout active steering and release', () => {
  const ocean = worlds[0][1](), optional = worlds[1][1]();
  const a = diver({ yaw: .2, pitch: -.4 }), b = diver({ yaw: .2, pitch: -.4 });
  for (let n = 0; n < 900; n++) {
    const input = n < 300 ? { forward: 1, right: .4, up: .2, sprint: 1, turn: -.15, tilt: .04 }
      : n < 600 ? { back: .5, left: .8, turn: .1, tilt: -.1 } : { turn: -.1, tilt: .1 };
    stepDive(a, input, FIXED_STEP, ocean); stepDive(b, input, FIXED_STEP, optional);
    assert.deepEqual(a, b, `exact legacy/optional agreement at tick ${n}`);
  }
});

test('keyboard and touch own movement independently and cannot manufacture an unheld left input', () => {
  const input = createDiveInput();
  input.key('KeyW', true);
  assert.deepEqual(input.read(), { forward: 1, turn: 0, tilt: 0 });
  input.pointer(7, 'forward', true); input.pointer(8, 'left', true);
  input.key('KeyA', true); input.key('KeyA', false);
  assert.equal(input.read().left, 1, 'held touch continues left after keyboard release');
  input.pointer(8, 'left', false);
  assert.equal(input.read().left, undefined);
  input.pointer(7, 'forward', false);
  assert.equal(input.read().forward, 1, 'keyboard W survives touch release');
  input.pointer(9, 'left', true); input.pointer(9, 'right', true);
  input.pointer(9, 'left', false);
  assert.equal(input.read().left, undefined);
  assert.equal(input.read().right, 1, 'old pointer cancellation cannot clear a newer owner');
  input.pointer(9, 'right', false);
  const s = diver({ yaw: .8, pitch: -.3 }); advance(s, input.read());
  close(velocity(s).dot(axes(s).right), 0, 'only W remains');
  input.clear(); assert.deepEqual(input.read(), { turn: 0, tilt: 0 });
});

test('oblique cylinder contact can deflect held W both left and right, while clear water cannot', () => {
  for (const [, makeWorld] of worlds) {
    const samples = [-1, 1].map(side => {
      const world = makeWorld(); world.colliders = [{ x: side * 1.2, y: -100, z: -4, radius: 2, height: 20 }];
      const s = diver(); advance(s, { forward: 1 }, world, 1);
      return s;
    });
    assert.ok(samples[0].x > .1 && samples[1].x < -.1, 'obstacle side determines contact deflection');
    close(samples[0].x, -samples[1].x, 'mirrored cylinder displacement');
    close(samples[0].z, samples[1].z, 'mirrored cylinder progress');
  }
});

test('world-edge and box contact retain tangent motion that differs from the viewing heading', () => {
  const s = diver({ yaw: Math.PI / 4 }), world = { ...flat(), bounds: { ...bounds, minX: 0 } };
  advance(s, { forward: 1 }, world);
  close(s.x, 0, 'left world bound');
  assert.ok(velocity(s).dot(axes(s).right) > 2, 'rightward relative slide comes from blocked world X');
  const reverse = diver({ yaw: -Math.PI / 4 }), other = { ...flat(), bounds: { ...bounds, maxX: 0 } };
  advance(reverse, { forward: 1 }, other);
  close(reverse.x, 0, 'right world bound');
  assert.ok(velocity(reverse).dot(axes(reverse).right) < -2, 'leftward relative slide comes from blocked world X');
  const boxWorld = { ...flat(), boxColliders: [{ minX: -3, maxX: -2, minY: -110, maxY: -90, minZ: -100, maxZ: 100 }] };
  const wall = diver({ yaw: Math.PI / 4 }); advance(wall, { forward: 1 }, boxWorld);
  close(wall.x, -2 + LIMITS.radius, 'box face');
  assert.ok(velocity(wall).dot(axes(wall).right) > 2, 'contact removes the normal, preserves the tangent');
});

test('terrain floor/surface constraints cannot create a horizontal left bias while swimming', () => {
  for (const [, makeWorld] of worlds) for (const pitch of [-.8, .8]) {
    const world = makeWorld(); world.terrain = (x, z) => -100 + .2 * x + .1 * z;
    // Use outdoor samples so this test exercises the actual variable floor.
    delete world.sampleEnvironment;
    const s = diver({ y: pitch < 0 ? -100 + LIMITS.radius : .5, yaw: .71, pitch });
    advance(s, { forward: 1 }, world);
    close(velocity(s).dot(axes(s).right), 0, 'vertical clamping has no camera-right component');
  }
});

test('creature hits can inject either lateral sign, then cooldown and fixed-heading damping remove it', () => {
  for (const side of [-1, 1]) {
    const world = flat(); world.threats = [{ x: side, y: -100, z: 0, radius: 2 }];
    const s = diver(); stepDive(s, { forward: 1 }, FIXED_STEP, world);
    close(s.vx, -side * 2, 'hit knockback direction');
    assert.equal(s.health, 75); assert.equal(s.injuryCooldown, 4);
    world.threats = [];
    advance(s, { forward: 1 }, world);
    assert.ok(Math.abs(s.vx) < .0002, 'continued forward input damps away hit impulse');
    assert.equal(s.health, 75);
  }
});

test('actual buoy departure with held W has no lateral displacement for 20 seconds at three pitches', () => {
  const scene = new THREE.Scene(), reef = createAbyssWorld(scene), basin = createDeepBasin(scene, { terrain: terrainHeight });
  try {
    const world = { terrain: terrainHeight, colliders: [...reef.colliders, ...basin.colliders], bounds: DEEP_BOUNDS, locations: [], threats: [] };
    // Threats are deliberately excluded: this isolates the shipped terrain and
    // static collider route, not creature difficulty or actual browser input.
    for (const pitch of [-.22, 0, -.6]) {
      const s = Object.assign(createDive(), { status: 'playing', pitch });
      for (let n = 0; n < 1800; n++) {
        stepDive(s, { forward: 1 }, FIXED_STEP, world);
        assert.equal(s.x, 0); assert.equal(s.vx, 0);
      }
    }
  } finally { reef.dispose(); basin.dispose(); }
});
