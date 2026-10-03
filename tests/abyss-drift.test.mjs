import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiveInput } from '../dist/abyss-input.js';
import { createDive, startDive, stepDive, clearMotion, recoverDiver, FIXED_STEP, LIMITS } from '../dist/abyss-sim.js';

const flatWorld = () => ({ terrain: () => -100, locations: [], colliders: [], threats: [] });
const playing = overrides => Object.assign(createDive(), { status: 'playing', y: -40, pitch: 0 }, overrides);
const position = s => [s.x, s.y, s.z];
const velocity = s => [s.vx, s.vy, s.vz];
const speed = s => Math.hypot(...velocity(s));
function advance(s, seconds, controls = {}, world = flatWorld()) {
  for (let n = 0; n < Math.round(seconds / FIXED_STEP); n++) stepDive(s, controls, FIXED_STEP, world);
}
const close = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function holdStill(s, world = flatWorld(), controls = {}, seconds = 10) {
  const before = position(s), travelled = s.distanceSwum;
  advance(s, seconds, controls, world);
  assert.deepEqual(position(s), before, 'settled position must remain bit-for-bit unchanged');
  assert.deepEqual(velocity(s), [0, 0, 0]);
  assert.equal(s.distanceSwum, travelled);
}

test('untouched diver holds exact position with no passive buoyancy or current', () => {
  const s = playing({ pitch: -.22, yaw: .8 });
  holdStill(s, flatWorld(), {}, 30);
  assert.ok(s.oxygen < LIMITS.oxygen, 'oxygen still advances while resting');
  assert.equal(s.time > 29.9, true);
});

test('released swim and sprint decelerate smoothly then settle in under 0.32 seconds', () => {
  for (const sprint of [false, true]) {
    const s = playing();
    advance(s, 2, { forward: 1, sprint });
    const release = position(s), initialSpeed = speed(s);
    stepDive(s, {}, FIXED_STEP, flatWorld());
    assert.ok(speed(s) > initialSpeed * .75 && speed(s) < initialSpeed, 'release eases down instead of snapping');
    let elapsed = FIXED_STEP, previous = speed(s);
    while (speed(s) > 0 && elapsed < 1) {
      stepDive(s, {}, FIXED_STEP, flatWorld());
      assert.ok(speed(s) < previous, 'braking is strictly monotonic');
      previous = speed(s);
      elapsed += FIXED_STEP;
    }
    assert.ok(elapsed < .32, `settled after ${elapsed}s`);
    const glide = Math.hypot(s.x - release[0], s.y - release[1], s.z - release[2]);
    assert.ok(glide > .2 && glide < .42, `release glide ${glide}m`);
    assert.equal(s.sprinting, false);
    holdStill(s);
  }
});

test('every translation direction and mixed 3D direction settles after release', () => {
  const directions = [
    { forward: 1 }, { back: 1 }, { left: 1 }, { right: 1 }, { up: 1 }, { down: 1 },
    { forward: 1, right: 1, up: 1 }, { back: 1, left: 1, down: 1 },
  ];
  for (const controls of directions) for (const sprint of [false, true]) {
    const s = playing({ yaw: .83, pitch: -.31 });
    advance(s, 1, { ...controls, sprint });
    assert.ok(speed(s) > 5, JSON.stringify(controls));
    advance(s, .4);
    holdStill(s);
  }
});

test('opposing controls cancel to idle, including sprint and floating-point near cancellation', () => {
  const s = playing();
  advance(s, 1, { forward: 1, up: 1, sprint: 1 });
  const opposing = { forward: 1, back: 1, left: 1, right: 1, up: 1, down: 1, sprint: 1 };
  advance(s, .4, opposing);
  assert.equal(s.sprinting, false);
  holdStill(s, flatWorld(), opposing);
  const tiny = playing();
  holdStill(tiny, flatWorld(), { forward: 1e-12, sprint: 1 });
});

test('look-only, scan and sprint controls cannot generate translation', () => {
  const s = playing();
  advance(s, 1, { right: 1 });
  advance(s, .4, { turn: 1, tilt: 1, scan: 1, sprint: 1 });
  holdStill(s, flatWorld(), { turn: 1, tilt: -1, scan: 1, sprint: 1 });
  assert.ok(s.yaw > 1);
});

test('acceleration, normalized 3D swim and sprint oxygen cost are preserved', () => {
  const s = playing();
  stepDive(s, { forward: 1 }, FIXED_STEP, flatWorld());
  close(s.vz, -LIMITS.swim * (1 - Math.exp(-4.8 * FIXED_STEP)));
  const normal = playing(), diagonal = playing(), sprint = playing();
  advance(normal, 2, { forward: 1 });
  advance(diagonal, 2, { forward: 1, right: 1, up: 1 });
  advance(sprint, 2, { forward: 1, sprint: 1 });
  close(speed(normal), speed(diagonal));
  assert.ok(speed(sprint) > speed(normal) * 1.5);
  assert.ok(sprint.oxygen < normal.oxygen);
});

test('surface and terrain contacts discard blocked vertical velocity', () => {
  const world = flatWorld();
  for (const [y, vy, controls] of [[.5, LIMITS.sprint, { up: 1 }], [-100 + LIMITS.radius, -LIMITS.sprint, { down: 1 }]]) {
    const s = playing({ y, vy });
    advance(s, 1, { ...controls, sprint: 1 }, world);
    assert.equal(s.y, y);
    assert.equal(s.vy, 0);
    holdStill(s, world);
    const away = y === .5 ? { down: 1 } : { up: 1 };
    stepDive(s, away, FIXED_STEP, world);
    assert.notEqual(s.y, y, 'opposite input moves away immediately');
  }
});

test('all four world boundaries discard outward velocity and remain settled', () => {
  const cases = [
    [{ x: LIMITS.world, vx: LIMITS.sprint }, { right: 1 }],
    [{ x: -LIMITS.world, vx: -LIMITS.sprint }, { left: 1 }],
    [{ z: LIMITS.minZ, vz: -LIMITS.sprint }, { forward: 1 }],
    [{ z: LIMITS.maxZ, vz: LIMITS.sprint }, { back: 1 }],
  ];
  for (const [initial, controls] of cases) {
    const s = playing(initial), before = position(s);
    advance(s, 1, { ...controls, sprint: 1 });
    assert.deepEqual(position(s), before);
    assert.deepEqual(velocity(s), [0, 0, 0]);
    holdStill(s);
  }
});

test('cylinder contact cancels inward momentum without an endless release slide', () => {
  const solid = { x: 0, z: 18, y: -40, height: 20, radius: 2 };
  const world = { ...flatWorld(), colliders: [solid] };
  const s = playing({ x: solid.radius + LIMITS.radius, vx: -LIMITS.sprint });
  advance(s, 2, { left: 1, sprint: 1 }, world);
  close(s.x, solid.radius + LIMITS.radius);
  assert.deepEqual(velocity(s), [0, 0, 0]);
  holdStill(s, world);
  stepDive(s, { right: 1 }, FIXED_STEP, world);
  assert.ok(s.x > solid.radius + LIMITS.radius);
});

test('oblique cylinder collision preserves tangent velocity and floor re-clamp clears downward momentum', () => {
  const solid = { x: 0, z: 0, y: -40, height: 20, radius: 2 };
  const world = { ...flatWorld(), colliders: [solid] };
  const s = playing({ x: 2.65, z: 0, vx: -3, vz: 3 });
  stepDive(s, {}, FIXED_STEP, world);
  const d = Math.hypot(s.x, s.z);
  close(d, 2.65);
  close((s.vx * s.x + s.vz * s.z) / d, 0);
  assert.ok(s.vz > 2, 'tangential motion survives');
  advance(s, .4, {}, world);
  holdStill(s, world);
  const slopeWorld = { ...flatWorld(), terrain: x => -20 + x * 5, colliders: [{ ...solid, y: -12, height: 6 }] };
  const slope = playing({ x: 0, z: 0, y: -12, vy: -3 });
  stepDive(slope, {}, FIXED_STEP, slopeWorld);
  assert.equal(slope.y, slopeWorld.terrain(slope.x) + LIMITS.radius);
  assert.equal(slope.vy, 0);
  holdStill(slope, slopeWorld);
});

test('approaching an overlapping solid corner cannot leave a creeping idle correction', () => {
  // A real rift-edge contact reduced to the three relevant static cylinders.
  const world = { ...flatWorld(), colliders: [
    { x: -29.704505394911394, y: -64.012541615374, z: -164.3676889743656, radius: 3.6028073844313626, height: 6.079737461227925 },
    { x: -33.95211475528777, y: -59.659362169441316, z: -172.125, radius: 4.129719448229298, height: 19.39720292389393 },
    { x: -35.07247863034718, y: -61.45959578828939, z: -163.375, radius: 4.732766420431435, height: 9.985892970114946 },
  ] };
  const s = playing({ x: -24.08912205615008, y: -61.693732301040384, z: -171.62308461095068, yaw: 919.18591709 });
  for (let n = 0; n < 180; n++) {
    stepDive(s, { forward: 1 }, FIXED_STEP, world);
    for (const c of world.colliders) assert.ok(Math.hypot(s.x - c.x, s.z - c.z) >= c.radius + LIMITS.radius - 1e-9);
  }
  advance(s, .4, {}, world);
  holdStill(s, world);
});

test('keyboard aliases and key release do not leave a movement latch', () => {
  const input = createDiveInput(), s = playing();
  for (const code of ['KeyW', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC']) input.key(code, true);
  advance(s, 1, input.read());
  for (const code of ['KeyW', 'ShiftLeft', 'ControlLeft', 'KeyC']) input.key(code, false);
  assert.equal(input.read().down, 1);
  assert.equal(input.read().sprint, 1);
  input.key('ControlRight', false);
  input.key('ShiftRight', false);
  advance(s, .4, input.read());
  holdStill(s, flatWorld(), input.read());
  assert.equal(input.key('toString', true), false);
  assert.equal(input.handles('__proto__'), false);
});

test('pointer up/cancel/lost-capture releases are idempotent and ownership-safe', () => {
  const input = createDiveInput(), s = playing();
  input.key('KeyW', true);
  input.pointer(1, 'forward', true);
  input.pointer(2, 'forward', true);
  advance(s, 1, input.read());
  input.pointer(1, 'forward', false); // pointerup
  input.pointer(1, 'forward', false); // subsequent lostpointercapture
  assert.equal(input.read().forward, 1);
  input.key('KeyW', false);
  assert.equal(input.read().forward, 1);
  input.pointer(2, 'forward', false); // pointercancel
  advance(s, .4, input.read());
  holdStill(s, flatWorld(), input.read());
  input.pointer(3, 'forward', true);
  input.pointer(3, 'up', true);
  input.pointer(3, 'forward', false); // stale old target lost capture
  assert.equal(input.read().up, 1);
  input.pointer(3, 'up', false);
  input.pointer(4, 'not-an-action', true);
  assert.deepEqual(input.read(), { turn: 0, tilt: 0 });
});

test('blur/pause reset contract clears every owner and freezes immediately until resumed', () => {
  const input = createDiveInput(), s = playing();
  input.key('KeyW', true);
  input.key('ShiftLeft', true);
  input.pointer(1, 'up', true);
  input.pointer(2, 'scan', true);
  advance(s, 1, input.read());
  // The app calls this same pair for blur, hidden tab, pause and modal entry.
  input.clear();
  clearMotion(s);
  s.status = 'paused';
  const paused = structuredClone(s);
  advance(s, 2, input.read());
  assert.deepEqual(s, paused);
  input.key('KeyW', false);
  input.pointer(1, 'up', false);
  input.pointer(2, 'scan', false);
  assert.deepEqual(input.read(), { turn: 0, tilt: 0 });
  s.status = 'playing';
  holdStill(s, flatWorld(), input.read());
});

test('fresh start and rescue leave no residual velocity or scan intent', () => {
  for (const reset of [startDive, recoverDiver]) {
    const s = playing({ vx: 5, vy: -3, vz: 4, sprinting: true, scanProgress: .5, scanTarget: 'glass' });
    reset(s);
    assert.deepEqual(velocity(s), [0, 0, 0]);
    assert.equal(s.sprinting, false);
    assert.equal(s.scanProgress, 0);
    assert.equal(s.scanTarget, null);
    holdStill(s);
  }
});

test('release and settled hold agree through the 30/60/120Hz fixed-step accumulator', () => {
  const run = hz => {
    const s = playing({ yaw: .43, pitch: -.2 });
    let accumulator = 0, steps = 0, releaseStep = null, settledStep = null;
    for (let frame = 0; frame < hz * 5; frame++) {
      accumulator += Math.min(1 / hz, .06);
      let frameSteps = 0;
      while (accumulator >= FIXED_STEP && frameSteps < 6) {
        // Fixed simulation-tick release isolates the render scheduler from the
        // physics; real events can naturally arrive one render frame later.
        const held = steps < 180;
        if (!held && releaseStep === null) releaseStep = steps;
        stepDive(s, held ? { forward: 1, right: 1, up: 1, sprint: 1 } : {}, FIXED_STEP, flatWorld());
        if (!held && speed(s) === 0 && settledStep === null) settledStep = steps + 1;
        accumulator -= FIXED_STEP;
        frameSteps++;
        steps++;
      }
      if (frameSteps === 6) accumulator = 0;
    }
    assert.ok((settledStep - releaseStep) * FIXED_STEP < .32);
    holdStill(s);
    return s;
  };
  const [base, ...others] = [30, 60, 120].map(run);
  for (const s of others) {
    assert.deepEqual(position(s), position(base));
    assert.deepEqual(velocity(s), [0, 0, 0]);
    assert.equal(s.distanceSwum, base.distanceSwum);
    close(s.oxygen, base.oxygen, .02);
  }
});
