import test from 'node:test';
import assert from 'node:assert/strict';
import { createInkDefense, INK_DEFENSE_DEFAULTS } from '../dist/abyss-ink-defense.js';
import { CREATURE_STEP } from '../dist/abyss-locomotion.js';

const creature = { id: 'kraken', x: 0, y: -30, z: 0, heading: .6, pitch: -.2 };
const observer = { x: 0, y: -30, z: 12, playing: true, submerged: true };
const far = { ...observer, z: 35 };
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const unitFields = ['anticipation', 'contraction', 'armGather', 'extension', 'escapeStrength', 'emissionStrength'];

function run(defense, duration, input = observer, hz = 90) {
  let remaining = duration, events = 0;
  while (remaining > 1e-12) {
    const dt = Math.min(remaining, 1 / hz);
    const previous = defense.state.eventId;
    defense.step(dt, creature, input);
    events += defense.state.eventId - previous;
    remaining -= dt;
  }
  return events;
}

test('only explicit playing/submerged Kraken proximity can trigger defensive ink', () => {
  for (const input of [
    { ...observer, playing: false }, { ...observer, submerged: false },
    { ...observer, playing: undefined }, { ...observer, submerged: undefined },
    { x: 0, y: -30, z: 1 }, { ...observer, x: NaN }, { ...observer, z: Infinity },
  ]) {
    const defense = createInkDefense();
    run(defense, 10, input);
    assert.equal(defense.state.stage, 'idle');
    assert.equal(defense.state.eventId, 0);
    if(input.playing===true&&Number.isFinite(input.x)&&Number.isFinite(input.y)&&Number.isFinite(input.z))near(defense.state.time,10);else assert.equal(defense.state.time,0);
  }
  for (const id of ['shark', 'warden', 'jellyfish']) {
    const defense = createInkDefense({ id });
    run(defense, 10);
    assert.equal(defense.state.eventId, 0);
    assert.equal(defense.state.armed, false);
  }
  const defense = createInkDefense();
  defense.step(10, { ...creature, id: 'shark' }, observer);
  defense.step(10, { ...creature, x: NaN }, observer);
  defense.step(10, { ...creature, x: 1e308 }, { ...observer, x: -1e308 });
  assert.equal(defense.state.eventId, 0);
  assert.equal(run(defense, .71), 1);
});

test('close approach requires uninterrupted dwell; withdrawing or leaving gameplay cancels precommit dwell', () => {
  const defense = createInkDefense();
  run(defense, .2);
  assert.equal(defense.state.stage, 'idle'); near(defense.state.dwell, .2);
  defense.step(.01, creature, { ...observer, z: 18.001 });
  assert.equal(defense.state.dwell, 0);
  run(defense, .2);
  assert.equal(defense.state.stage, 'idle');
  defense.step(.01, creature, { ...observer, playing: false });
  assert.equal(defense.state.dwell, 0);
  run(defense, .2);
  defense.step(.01, creature, { ...observer, submerged: false });
  assert.equal(defense.state.dwell, 0);
  run(defense, .25, { ...observer, z: 18 });
  assert.equal(defense.state.stage, 'anticipation');
  assert.equal(defense.state.eventId, 0);
  assert.equal(defense.state.armed, false);
  // The animal can finish a committed response when the observer retreats.
  run(defense, .45, far);
  assert.equal(defense.state.stage, 'emission');
  assert.equal(defense.state.eventId, 1);
});

test('finite stages fire one event after anticipation and preserve continuous bounded jet/pose envelopes', () => {
  const defense = createInkDefense(), s = defense.state;
  defense.step(.25, creature, observer);
  assert.equal(s.stage, 'anticipation');
  assert.equal(s.escapeStrength, 0);
  defense.step(.45 - 1e-5, creature, observer);
  const before = defense.snapshot();
  assert.ok(before.anticipation > .999);
  assert.ok(before.armGather > .699);
  assert.equal(before.eventId, 0);
  assert.equal(before.escapeStrength, 0);
  defense.step(1e-5, creature, observer);
  assert.equal(s.stage, 'emission');
  assert.equal(s.eventId, 1); assert.equal(s.emitted, true); assert.equal(s.emitting, true);
  near(s.eventTime, .7); near(s.cooldown, 18);
  near(s.escapeStrength, 0); near(s.contraction, .1); near(s.armGather, .7);
  defense.step(.001, creature, observer);
  assert.equal(s.emitted, false);
  assert.ok(s.escapeStrength > 0 && s.escapeStrength < .001, 'jet starts smoothly without a velocity step');
  run(defense, .249);
  near(s.emissionStrength, 1); assert.ok(s.contraction > .98); assert.equal(s.extension, 1);
  run(defense, .25);
  assert.equal(s.stage, 'escape'); near(s.escapeStrength, 1); near(s.contraction, .82);
  assert.equal(s.emitting, false); assert.equal(s.emissionStrength, 0);
  run(defense, 3);
  assert.equal(s.stage, 'recovery'); near(s.escapeStrength, .15); near(s.extension, .15); near(s.contraction, .08);
  run(defense, 2);
  assert.equal(s.stage, 'idle');
  for (const field of unitFields) near(s[field], 0);
  assert.equal(s.eventId, 1); assert.equal(s.armed, false);
  near(s.cooldown, 12.5);
});

test('cooldown AND 28m separation hysteresis prevent repeated close-range bursts', () => {
  const defense = createInkDefense();
  assert.equal(run(defense, 60), 1, 'remaining beside the animal cannot spam ink after cooldown');
  assert.equal(defense.state.armed, false);
  assert.equal(defense.state.cooldown, 0);
  run(defense, 1, { ...observer, z: 27.999 });
  assert.equal(defense.state.armed, false);
  run(defense, .1, { ...observer, z: 28 });
  assert.equal(defense.state.armed, true);
  assert.equal(run(defense, .71), 1);
  assert.equal(defense.state.eventId, 2);
  run(defense, .1, far); // Separation during a response latches, but does not waive cooldown.
  assert.equal(defense.state.separated, true);
  assert.equal(run(defense, 17.8), 0);
  assert.equal(defense.state.armed, false);
  const remaining = defense.state.cooldown;
  run(defense, remaining);
  assert.equal(defense.state.armed, true);
  assert.equal(defense.state.stage, 'idle');
  near(defense.state.dwell, 0);
  assert.equal(run(defense, .7), 1);
  assert.equal(defense.state.eventId, 3);
});

test('directions are normalized world-space opposites and frozen for the complete response', () => {
  const defense = createInkDefense();
  const input = { ...observer, x: -3, y: -34, z: -12 };
  defense.step(.25, creature, input);
  const expected = { x: 3 / 13, y: 4 / 13, z: 12 / 13 };
  for (const axis of ['x', 'y', 'z']) {
    near(defense.state.escapeDirection[axis], expected[axis]);
    near(defense.state.inkDirection[axis], -expected[axis]);
  }
  const escapeRef = defense.state.escapeDirection, inkRef = defense.state.inkDirection;
  const frozen = structuredClone(escapeRef);
  for (let i = 0; i < 600; i++) {
    defense.step(1 / 90, { ...creature, heading: i * .1, x: i * .01 }, { ...observer, x: 10, z: -5 });
    assert.equal(defense.state.escapeDirection, escapeRef);
    assert.equal(defense.state.inkDirection, inkRef);
    assert.deepEqual(escapeRef, frozen);
  }
  const overlap = createInkDefense();
  overlap.step(.25, creature, { ...observer, x: creature.x, y: creature.y, z: creature.z });
  const dir = overlap.state.escapeDirection;
  near(Math.hypot(dir.x, dir.y, dir.z), 1);
  near(dir.x, -Math.sin(creature.heading) * Math.cos(creature.pitch));
  near(dir.y, Math.sin(creature.pitch));
  near(dir.z, -Math.cos(creature.heading) * Math.cos(creature.pitch));
});

test('dt0 is exact in every stage, including the event pulse; invalid dt is harmless', () => {
  const defense = createInkDefense();
  for (const duration of [0, .1, .2, .4, .1, .6, 3, 2]) {
    if (duration) run(defense, duration);
    const snapshot = defense.snapshot();
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(defense.step(dt, { ...creature, x: 900 }, far), defense.state);
      assert.deepEqual(defense.snapshot(), snapshot);
    }
  }
  defense.reset(); defense.step(.7, creature, observer);
  assert.equal(defense.state.emitted, true);
  const atEmission = defense.snapshot();
  for (let i = 0; i < 100; i++) defense.step(0, creature, observer);
  assert.deepEqual(defense.snapshot(), atEmission);
});

test('menus freeze committed responses; surfaced players cannot freeze an ongoing escape', () => {
  const defense = createInkDefense();
  run(defense, .5);
  assert.equal(defense.state.stage, 'anticipation');
  const atPause = defense.snapshot();
  for (const input of [{ ...observer, playing: false }]) {
    run(defense, 20, input);
    assert.deepEqual(defense.snapshot(), atPause);
  }
  assert.equal(run(defense, .2, { ...observer, submerged:false }), 1);
  const eventTime = defense.state.eventTime, phase = defense.state.stageTime, cooldown = defense.state.cooldown;
  run(defense, 10, { ...observer, playing: false });
  assert.equal(defense.state.eventId, 1); assert.equal(defense.state.emitted, false);
  near(defense.state.stageTime, phase); near(defense.state.cooldown, cooldown);
  near(defense.state.eventTime, eventTime);
  run(defense,20,{...observer,submerged:false});assert.equal(defense.state.stage,'idle');assert.equal(defense.state.cooldown,0);assert.equal(defense.state.eventId,1);
});

test('the existing fixed90Hz loop produces identical events/poses for 30/60/120Hz and jittered rendering', () => {
  const schedules = [[1 / 30], [1 / 60], [1 / 120], [1 / 120, 1 / 48, 1 / 75, 1 / 30]];
  const results = [];
  for (const schedule of schedules) {
    const defense = createInkDefense();
    let accumulator = 0, elapsed = 0, frame = 0, steps = 0;
    const events = [];
    while (elapsed < 42 - 1e-10) {
      const dt = Math.min(schedule[frame++ % schedule.length], 42 - elapsed);
      elapsed += dt; accumulator += dt;
      while (accumulator + 1e-10 >= CREATURE_STEP) {
        const t = steps * CREATURE_STEP;
        const input = t >= 10 && t < 20 ? far : observer;
        const eventId = defense.state.eventId;
        defense.step(CREATURE_STEP, creature, input);
        if (defense.state.eventId !== eventId) events.push({ id: defense.state.eventId, time: defense.state.eventTime, step: steps });
        for (const field of unitFields) assert.ok(defense.state[field] >= 0 && defense.state[field] <= 1, field);
        accumulator = Math.max(0, accumulator - CREATURE_STEP); steps++;
      }
    }
    assert.equal(steps, 42 * 90);
    assert.equal(events.length, 2);
    results.push({ state: defense.snapshot(), events });
  }
  for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
});

test('direct 30/60/90/120Hz steps and a large dt agree across exact phase/cooldown boundaries', () => {
  const results = [];
  for (const hz of [30, 60, 90, 120]) {
    const defense = createInkDefense();
    run(defense, 1.7, observer, hz);
    run(defense, 10, far, hz);
    run(defense, 9, observer, hz);
    results.push(defense.snapshot());
  }
  const large = createInkDefense();
  large.step(1.7, creature, observer); large.step(10, creature, far); large.step(9, creature, observer);
  results.push(large.snapshot());
  for (const result of results) {
    assert.equal(result.stage, results[0].stage);
    assert.equal(result.eventId, 2);
    assert.equal(result.armed, results[0].armed);
    for (const key of ['time', 'stageTime', 'cooldown', 'eventTime', ...unitFields]) near(result[key], results[0][key], 1e-8);
    assert.deepEqual(result.escapeDirection, results[0].escapeDirection);
  }
});

test('state/direction identities survive updates and reset; dispose is idempotent and permanent', () => {
  const defense = createInkDefense(), state = defense.state;
  const escape = state.escapeDirection, ink = state.inkDirection, initial = defense.snapshot();
  run(defense, 4);
  const detached = defense.snapshot(); detached.escapeDirection.x = 500;
  assert.notEqual(state.escapeDirection.x, 500);
  defense.reset();
  assert.deepEqual(defense.snapshot(), initial);
  assert.equal(defense.state, state); assert.equal(state.escapeDirection, escape); assert.equal(state.inkDirection, ink);
  assert.equal(run(defense, .7), 1);
  defense.dispose();
  const disposed = defense.snapshot();
  assert.equal(disposed.disposed, true); assert.equal(disposed.armed, false); assert.equal(disposed.emitting, false);
  for (const field of unitFields) assert.equal(disposed[field], 0);
  defense.dispose(); defense.reset(); defense.step(100, creature, observer);
  assert.deepEqual(defense.snapshot(), disposed);
});

test('invalid options are bounded and cannot eliminate separation or cooldown protection', () => {
  const defense = createInkDefense({ enterRange: 999, rearmRange: -1, dwellDuration: -1,
    anticipationDuration: NaN, emissionDuration: 0, escapeDuration: Infinity, recoveryDuration: 0, cooldownDuration: -1 });
  assert.ok(Object.isFrozen(defense.config)); assert.ok(Object.isFrozen(INK_DEFENSE_DEFAULTS));
  assert.equal(defense.config.enterRange, 50); assert.equal(defense.config.rearmRange, 51);
  assert.equal(defense.config.anticipationDuration, INK_DEFENSE_DEFAULTS.anticipationDuration);
  assert.ok(defense.config.dwellDuration > 0); assert.ok(defense.config.emissionDuration > 0);
  assert.ok(defense.config.cooldownDuration >= defense.config.emissionDuration + defense.config.escapeDuration + defense.config.recoveryDuration);
  assert.equal(run(defense, 120), 1);
});
