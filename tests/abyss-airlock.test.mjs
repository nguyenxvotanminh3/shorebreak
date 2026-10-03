// Pure-controller tests. Collision volume/sweep sensors and rendered traversal
// are integration responsibilities; these tests do not simulate real physiology.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWetLock, WET_LOCK } from '../dist/abyss-airlock.js';

const clear = Object.freeze({ outerBlocked: false, innerBlocked: false, inChamber: true });
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

function invariant(state) {
  for (const key of ['outerOpen', 'innerOpen', 'waterLevel', 'water01', 'equalizeRemaining']) assert.ok(Number.isFinite(state[key]), key);
  assert.ok(state.outerOpen >= 0 && state.outerOpen <= 1);
  assert.ok(state.innerOpen >= 0 && state.innerOpen <= 1);
  assert.ok(state.waterLevel >= WET_LOCK.drained && state.waterLevel <= WET_LOCK.flooded);
  assert.ok(state.water01 >= 0 && state.water01 <= 1);
  assert.ok(state.outerOpen === 0 || state.innerOpen === 0, 'never even partly open together');
  if (state.outerOpen > 0) assert.equal(state.waterLevel, WET_LOCK.flooded);
  if (state.innerOpen > 0) assert.equal(state.waterLevel, WET_LOCK.drained);
  if (['filling', 'draining', 'equalizing'].includes(state.phase)) {
    assert.equal(state.outerOpen, 0);
    assert.equal(state.innerOpen, 0);
  }
  if (!state.busy) {
    assert.equal(state.phase, `${state.target}-open`);
    assert.equal(state.lastSafeSide, state.target);
    assert.equal(state.target === 'sea' ? state.outerOpen : state.innerOpen, 1);
  }
}

function run(lock, seconds, hz = 90, occupancy = clear) {
  let time = 0;
  while (time < seconds - 1e-10) {
    const dt = Math.min(1 / hz, seconds - time), before = lock.state;
    const state = lock.step(dt, occupancy);
    invariant(state);
    if (state.waterLevel !== before.waterLevel) {
      assert.equal(state.outerOpen, 0, 'pump never operates with outer leaf open');
      assert.equal(state.innerOpen, 0, 'pump never operates with inner leaf open');
    }
    time += dt;
  }
  return lock.state;
}

function finish(lock, occupancy = clear) {
  run(lock, 15, 90, occupancy);
  assert.equal(lock.state.busy, false, 'cycle reaches a traversable side');
  return lock.state;
}

test('wet lock exports the model-space chamber/door contract and starts flooded at sea', () => {
  assert.deepEqual(WET_LOCK.chamber, { minX: -3, maxX: 3, minY: 18, maxY: 23, minZ: 35, maxZ: 42 });
  assert.deepEqual(WET_LOCK.outer, { z: 42, width: 3.2, height: 3.5, floor: 18 });
  assert.deepEqual(WET_LOCK.inner, { z: 35, width: 3.2, height: 3.5, floor: 18 });
  assert.equal(WET_LOCK.drained, 18.05);
  assert.equal(WET_LOCK.flooded, 22.8);
  const lock = createWetLock();
  invariant(lock.state);
  assert.equal(lock.state.phase, 'sea-open');
  assert.equal(lock.state.outerOpen, 1);
  assert.equal(lock.state.innerOpen, 0);
  assert.equal(lock.state.water01, 1);
});

test('enter sequence closes outer fully, drains with both sealed, equalizes, then opens inner', () => {
  const lock = createWetLock();
  assert.equal(lock.request('habitat', clear), true);
  assert.equal(lock.state.phase, 'closing');
  run(lock, .6);
  near(lock.state.outerOpen, .5);
  assert.equal(lock.state.water01, 1);
  run(lock, .6);
  assert.equal(lock.state.outerOpen, 0);
  assert.equal(lock.state.phase, 'draining');
  run(lock, 2.5);
  near(lock.state.water01, .5);
  assert.equal(lock.state.innerOpen, 0);
  run(lock, 2.5);
  assert.equal(lock.state.waterLevel, WET_LOCK.drained);
  assert.equal(lock.state.phase, 'equalizing');
  run(lock, .4);
  assert.equal(lock.state.phase, 'opening');
  run(lock, .6);
  near(lock.state.innerOpen, .5);
  run(lock, .6);
  assert.equal(lock.state.phase, 'habitat-open');
  assert.equal(lock.state.lastSafeSide, 'habitat');
});

test('exit follows the full reversed traversal and repeated enter/exit never overlap', () => {
  const lock = createWetLock({ initialSide: 'habitat' });
  assert.equal(lock.request('sea'), true);
  run(lock, 1.2);
  assert.equal(lock.state.innerOpen, 0);
  assert.equal(lock.state.phase, 'filling');
  run(lock, 2.5);
  near(lock.state.water01, .5);
  assert.equal(lock.state.outerOpen, 0);
  finish(lock);
  for (let trip = 0; trip < 12; trip++) {
    assert.equal(lock.request('habitat', clear), true);
    assert.equal(finish(lock).phase, 'habitat-open');
    assert.equal(lock.request('sea', clear), true);
    assert.equal(finish(lock).phase, 'sea-open');
  }
});

test('empty chamber responds to both external/vestibule call panels without an occupant', () => {
  const empty = { inChamber: false, outerBlocked: false, innerBlocked: false };
  const lock = createWetLock();
  lock.request('habitat', empty);
  assert.equal(finish(lock, empty).phase, 'habitat-open');
  lock.request('sea', empty);
  assert.equal(finish(lock, empty).phase, 'sea-open');
});

test('button spam is idempotent, ignores conflicting busy requests and never restarts timing', () => {
  const baseline = createWetLock(), spammed = createWetLock();
  baseline.request('habitat');
  spammed.request('habitat');
  for (let i = 0; i < 800; i++) {
    const before = spammed.snapshot();
    assert.equal(spammed.request('habitat', clear), true);
    assert.deepEqual(spammed.snapshot(), before);
    if (before.busy) {
      assert.equal(spammed.request('sea', clear), false);
      assert.deepEqual(spammed.snapshot(), before);
    }
    baseline.step(1 / 90, clear);
    spammed.step(1 / 90, clear);
    assert.deepEqual(spammed.state, baseline.state);
  }
  const completed = spammed.state;
  for (let i = 0; i < 20; i++) assert.equal(spammed.request('habitat'), true);
  assert.deepEqual(spammed.state, completed);
});

test('outer threshold obstruction reverses a closing door without pumping or crushing', () => {
  const lock = createWetLock();
  lock.request('habitat');
  run(lock, .75);
  let last = lock.state.outerOpen;
  for (let i = 0; i < 150; i++) {
    const state = lock.step(1 / 90, { outerBlocked: true, inChamber: true });
    invariant(state);
    assert.ok(state.outerOpen >= last);
    assert.equal(state.water01, 1);
    assert.equal(state.innerOpen, 0);
    assert.equal(state.blocked, 'outer');
    last = state.outerOpen;
  }
  assert.equal(last, 1);
  assert.equal(finish(lock).phase, 'habitat-open');
});

test('inner threshold obstruction reverses exit closure and resumes only after it clears', () => {
  const lock = createWetLock({ initialSide: 'habitat' });
  lock.request('sea');
  run(lock, 1.1);
  const before = lock.state.innerOpen;
  run(lock, 3, 120, { innerBlocked: true });
  assert.ok(lock.state.innerOpen > before);
  assert.equal(lock.state.innerOpen, 1);
  assert.equal(lock.state.water01, 0);
  assert.equal(lock.state.blocked, 'inner');
  assert.equal(finish(lock).phase, 'sea-open');
});

test('obstruction in the last close step is detected before sealing/pumping', () => {
  const lock = createWetLock();
  lock.request('habitat');
  run(lock, 1.19, 120);
  const before = lock.state.outerOpen;
  const state = lock.step(.25, { outerBlocked: true });
  assert.ok(state.outerOpen > before);
  assert.equal(state.water01, 1);
  assert.equal(state.phase, 'closing');
});

test('contradictory sealed threshold occupancy holds transfer and equalization safely', () => {
  const lock = createWetLock();
  lock.request('habitat');
  run(lock, 3);
  const water = lock.state.waterLevel;
  run(lock, 3, 60, { innerBlocked: true });
  assert.equal(lock.state.waterLevel, water);
  assert.equal(lock.state.blocked, 'inner');
  run(lock, 3.2);
  assert.equal(lock.state.phase, 'equalizing');
  const remaining = lock.state.equalizeRemaining;
  run(lock, 2, 60, { outerBlocked: true, innerBlocked: true });
  assert.equal(lock.state.equalizeRemaining, remaining);
  assert.equal(lock.state.outerOpen, 0);
  assert.equal(lock.state.innerOpen, 0);
  assert.equal(finish(lock).phase, 'habitat-open');
});

test('recover/cancel during partial drain reverses water only after sealed, with no instant jump', () => {
  const lock = createWetLock();
  lock.request('habitat');
  run(lock, 3.2);
  const before = lock.state;
  assert.ok(before.water01 > 0 && before.water01 < 1);
  lock.cancel(clear);
  assert.equal(lock.state.waterLevel, before.waterLevel);
  assert.equal(lock.state.outerOpen, 0);
  assert.equal(lock.state.innerOpen, 0);
  assert.equal(lock.state.phase, 'filling');
  for (let i = 0; i < 150; i++) {
    const saved = lock.state;
    lock.recover(clear);
    assert.deepEqual(lock.state, saved, 'repeat recovery does not reset its cycle');
    lock.step(1 / 90, clear);
    invariant(lock.state);
  }
  assert.equal(finish(lock).phase, 'sea-open');
});

test('recover from partial fill returns to the dry habitat without opening at wrong water', () => {
  const lock = createWetLock({ initialSide: 'habitat' });
  lock.request('sea');
  run(lock, 4.2);
  const water = lock.state.waterLevel;
  lock.recover();
  assert.equal(lock.state.waterLevel, water);
  assert.equal(lock.state.phase, 'draining');
  assert.equal(finish(lock).phase, 'habitat-open');
});

test('recover while closing reopens safe side; recover while opening closes before reversing', () => {
  const closing = createWetLock();
  closing.request('habitat');
  run(closing, .6);
  const old = closing.state.outerOpen;
  closing.recover();
  assert.equal(closing.state.outerOpen, old);
  assert.equal(closing.state.phase, 'opening');
  assert.equal(finish(closing).phase, 'sea-open');

  const opening = createWetLock();
  opening.request('habitat');
  run(opening, 7.2);
  assert.equal(opening.state.phase, 'opening');
  assert.ok(opening.state.innerOpen > 0);
  const inner = opening.state.innerOpen;
  opening.recover();
  assert.equal(opening.state.phase, 'closing');
  assert.equal(opening.state.innerOpen, inner);
  assert.equal(opening.state.water01, 0);
  assert.equal(finish(opening).phase, 'sea-open');
});

test('dt zero/negative/malformed freezes every field and very large frames are bounded', () => {
  const lock = createWetLock();
  lock.request('habitat', { outerBlocked: true });
  const initial = lock.state;
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, '1', {}, []]) {
    assert.deepEqual(lock.step(dt, clear), initial);
  }
  const normal = createWetLock();
  normal.restore(lock.serialize());
  lock.step(3600, clear);
  normal.step(WET_LOCK.maxDelta, clear);
  assert.deepEqual(lock.state, normal.state);
  assert.equal(lock.state.water01, 1);
  assert.ok(lock.state.outerOpen > .7);
});

test('exact event integration agrees at 30/60/90/120 Hz and irregular frame schedules', () => {
  for (const seconds of [.5, 1.2, 1.9, 4.7, 6.2, 6.4, 6.6, 7.1, 7.8, 8.5]) {
    const states = [30, 60, 90, 120].map(hz => {
      const lock = createWetLock();
      lock.request('habitat');
      return run(lock, seconds, hz);
    });
    const irregular = createWetLock();
    irregular.request('habitat');
    let time = 0, i = 0;
    const frames = [1 / 120, 1 / 37, 1 / 60, 1 / 24, .002, .08];
    while (time < seconds - 1e-10) {
      const dt = Math.min(frames[i++ % frames.length], seconds - time);
      irregular.step(dt, clear);
      invariant(irregular.state);
      time += dt;
    }
    states.push(irregular.state);
    for (const state of states) {
      assert.equal(state.phase, states[0].phase, `phase at ${seconds}s`);
      for (const key of ['outerOpen', 'innerOpen', 'waterLevel', 'equalizeRemaining']) near(state[key], states[0][key]);
    }
  }
});

test('save/restore every transition and partial water continues deterministically', () => {
  for (const side of ['sea', 'habitat']) {
    for (const seconds of [0, .4, 1.2, 2, 6.2, 6.4, 6.6, 7.2, 7.8]) {
      const lock = createWetLock({ initialSide: side });
      lock.request(side === 'sea' ? 'habitat' : 'sea');
      run(lock, seconds);
      const restored = createWetLock();
      assert.equal(restored.restore(JSON.stringify(lock.serialize())), true);
      assert.deepEqual(restored.state, lock.state);
      for (let frame = 0; frame < 800; frame++) {
        lock.step(1 / 90, clear);
        restored.step(1 / 90, clear);
        assert.deepEqual(restored.state, lock.state);
        invariant(restored.state);
      }
    }
  }
});

test('restored partial cycle can safely cancel to its serialized last safe side', () => {
  const original = createWetLock({ initialSide: 'habitat' });
  original.request('sea');
  run(original, 4);
  const restored = createWetLock();
  assert.equal(restored.restore(original.serialize()), true);
  assert.equal(restored.state.lastSafeSide, 'habitat');
  restored.recover();
  assert.equal(finish(restored).phase, 'habitat-open');
});

test('invalid/unsafe saves reject atomically without changing a running controller', () => {
  const lock = createWetLock();
  lock.request('habitat');
  run(lock, 2.3);
  const before = lock.state, valid = lock.serialize();
  const mutations = [
    { version: 2 }, { phase: 'fault' }, { phase: 'sea-open' }, { target: 'roof' }, { lastSafeSide: null },
    { outerOpen: -1 }, { outerOpen: 2 }, { innerOpen: NaN }, { waterLevel: Infinity },
    { waterLevel: WET_LOCK.drained - .01 }, { waterLevel: WET_LOCK.flooded + .01 },
    { outerOpen: .1 }, { innerOpen: .1 }, { outerOpen: 1, innerOpen: 1 },
    { equalizeRemaining: -1 }, { equalizeRemaining: .2 }, { equalizeRemaining: 999 },
    { phase: 'filling', target: 'habitat' }, { phase: 'draining', target: 'sea' },
    { phase: 'opening' }, { phase: 'equalizing' }, { waterLevel: '20' },
  ];
  const inputs = [null, false, [], {}, 1, 'not json', '{', 'x'.repeat(8193), ...mutations.map(change => ({ ...valid, ...change }))];
  const evil = { get version() { throw new Error('bad save getter'); } };
  inputs.push(evil);
  for (const input of inputs) {
    assert.equal(lock.restore(input), false);
    assert.deepEqual(lock.state, before);
  }
  assert.equal(finish(lock).phase, 'habitat-open');
});

test('save validation rejects water mismatch, wrong open side and inconsistent idle phase', () => {
  const lock = createWetLock(), valid = lock.serialize();
  for (const change of [
    { waterLevel: WET_LOCK.flooded - 1e-9 },
    { target: 'habitat' }, { phase: 'habitat-open' }, { lastSafeSide: 'habitat' },
    { outerOpen: .9 }, { outerOpen: 0 }, { innerOpen: .1 },
    { phase: 'opening', target: 'habitat', waterLevel: WET_LOCK.drained },
    { phase: 'equalizing' },
  ]) assert.equal(lock.restore({ ...valid, ...change }), false);
  invariant(lock.state);
});

test('malformed config, requests and sensors stay finite and fail safe', () => {
  for (const config of [null, false, 'bad', { doorSeconds: -1, waterSeconds: Infinity, equalizeSeconds: '0' }, { get doorSeconds() { throw new Error('unreadable'); } }]) {
    const lock = createWetLock(config);
    assert.equal(lock.config.doorSeconds, 1.2);
    assert.equal(lock.config.waterSeconds, 5);
    assert.equal(lock.config.equalizeSeconds, .4);
    const before = lock.state;
    for (const side of [null, undefined, 'SEA', 0, {}, [], '']) assert.equal(lock.request(side), false);
    assert.deepEqual(lock.state, before);
    lock.request('habitat');
    run(lock, .5);
    const opening = lock.state.outerOpen;
    lock.step(.1, { outerBlocked: 'unknown' });
    assert.ok(lock.state.outerOpen > opening);
    lock.step(.1, { get outerBlocked() { throw new Error('lost sensor'); } });
    assert.equal(lock.state.blocked, 'outer');
    invariant(lock.state);
    assert.equal(finish(lock).phase, 'habitat-open');
  }
});

test('snapshots, options and exported geometry cannot mutate internal state; no player mutation', () => {
  const lock = createWetLock(), state = lock.state;
  assert.throws(() => { state.outerOpen = 0; }, TypeError);
  assert.throws(() => { lock.config.doorSeconds = 0; }, TypeError);
  assert.throws(() => { WET_LOCK.chamber.minY = 0; }, TypeError);
  const save = lock.serialize();
  save.waterLevel = 99;
  assert.equal(lock.state.waterLevel, WET_LOCK.flooded);
  const occupancy = Object.freeze({ ...clear, x: 0, y: 19, z: 40 });
  lock.request('habitat', occupancy);
  finish(lock, occupancy);
  assert.deepEqual(occupancy, { ...clear, x: 0, y: 19, z: 40 });
  assert.equal(state.phase, 'sea-open', 'old snapshots remain unchanged');
});

test('reset starts a new configured session and custom valid timing preserves safety', () => {
  const lock = createWetLock({ initialSide: 'habitat', doorSeconds: .1, waterSeconds: .5, equalizeSeconds: 0 });
  lock.request('sea');
  run(lock, 1);
  assert.equal(lock.state.phase, 'sea-open');
  lock.request('habitat');
  run(lock, .3);
  const reset = lock.reset();
  invariant(reset);
  assert.equal(reset.phase, 'habitat-open');
  assert.equal(reset.innerOpen, 1);
  assert.equal(reset.water01, 0);
  assert.equal(reset.blocked, null);
});

test('deterministic adversarial request/obstruction/recovery/save sequence preserves every invariant', () => {
  const lock = createWetLock();
  let seed = 0x71a0c;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 30000; i++) {
    const occupancy = { inChamber: random() > .5, outerBlocked: random() < .07, innerBlocked: random() < .07 };
    const action = random();
    if (action < .07) lock.request('sea', occupancy);
    else if (action < .14) lock.request('habitat', occupancy);
    else if (action < .15) lock.recover(occupancy);
    else if (action < .16) assert.equal(lock.restore(lock.serialize()), true);
    const before = lock.state;
    const state = lock.step(random() * .04, occupancy);
    invariant(state);
    if (before.phase === 'closing' && occupancy.outerBlocked) assert.ok(state.outerOpen >= before.outerOpen);
    if (before.phase === 'closing' && occupancy.innerBlocked) assert.ok(state.innerOpen >= before.innerOpen);
  }
  lock.recover();
  finish(lock);
});
