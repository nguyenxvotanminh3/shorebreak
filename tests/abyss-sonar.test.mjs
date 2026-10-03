import test from 'node:test';
import assert from 'node:assert/strict';
import { createSonarController, SONAR } from '../dist/abyss-sonar.js';
import { createDive, serializableProgress } from '../dist/abyss-sim.js';

const origin = overrides => ({ x: 0, y: -20, z: 0, yaw: 0, status: 'playing', ...overrides });
const contact = (id, range = 50, overrides = {}) => ({ id, kind: 'landmark', name: id,
  x: 0, y: -20, z: -range, ...overrides });
const arrival = range => range * 2 / SONAR.displaySpeed;
const close = (a, b, eps = 1e-10) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ids = controller => controller.echoes.map(echo => echo.id);

test('sonar range/cooldown/lifetime are finite gameplay constants, independent of graphics quality', () => {
  assert.equal(SONAR.range, 140);
  assert.equal(SONAR.cooldown, 9);
  assert.ok(SONAR.echoLifetime > 0);
  assert.ok(SONAR.echoLifetime + arrival(SONAR.range) < SONAR.cooldown);
  for (const quality of ['high', 'medium', 'low', 'auto']) {
    const sonar = createSonarController({ quality });
    sonar.emit(origin(), 0, [contact('boundary', 140), contact('outside', 140.0001)]);
    sonar.update(arrival(140));
    assert.deepEqual(ids(sonar), ['boundary']);
  }
});

test('a ping cannot immediately reveal all objectives or out-of-range known navigation markers', () => {
  const sonar = createSonarController();
  assert.equal(sonar.emit(origin(), 10, [contact('near', 50, { kind: 'objective' }),
    contact('far', 141, { kind: 'objective' }), contact('known-rig', 400, { kind: 'rig', known: true })]), true);
  assert.deepEqual(ids(sonar), []);
  sonar.update(10.999);
  assert.deepEqual(ids(sonar), []);
  sonar.update(11);
  assert.deepEqual(ids(sonar), ['near']);
  assert.equal(sonar.getEcho('far'), null);
  assert.equal(sonar.getEcho('known-rig'), null);
});

test('range uses 3D emission-origin distance, includes exactly 140m, and rejects vertical excess', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('three-dimensional', 0, { x: 60, y: -68, z: -32 }),
    contact('vertical-boundary', 0, { y: -160 }), contact('vertical-outside', 0, { y: -160.001 })]);
  sonar.update(arrival(140));
  assert.deepEqual(ids(sonar), ['three-dimensional', 'vertical-boundary']);
  close(sonar.getEcho('three-dimensional').range, Math.hypot(60, 48, 32));
  close(sonar.getEcho('vertical-boundary').range, 140);
});

test('returns arrive in increasing distance order, with deterministic ID ordering for ties', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('far', 130), contact('near-z', 30), contact('middle', 80), contact('near-a', 30)]);
  sonar.update(arrival(30) - .001);
  assert.deepEqual(ids(sonar), []);
  sonar.update(arrival(30));
  assert.deepEqual(ids(sonar), ['near-a', 'near-z']);
  assert.deepEqual(sonar.newEchoes.map(echo => echo.id), ['near-a', 'near-z']);
  sonar.update(arrival(80));
  assert.deepEqual(ids(sonar), ['near-a', 'near-z', 'middle']);
  assert.deepEqual(sonar.newEchoes.map(echo => echo.id), ['middle']);
  sonar.update(arrival(130));
  assert.deepEqual(ids(sonar), ['near-a', 'near-z', 'middle', 'far']);
  assert.equal(sonar.pendingCount, 0);
  assert.equal(sonar.receivedCount, 4);
});

test('outward pulse and two-way return frontier are separate, explicitly time-expanded', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 5, [contact('echo', 100)]);
  assert.equal(sonar.pulse.timeExpanded, true);
  assert.equal(sonar.pulse.active, true);
  assert.equal(sonar.pulse.phase, 'outbound');
  sonar.update(6);
  assert.equal(sonar.pulse.outgoingRadius, 100);
  assert.equal(sonar.pulse.returnRadius, 50);
  assert.equal(sonar.getEcho('echo'), null, 'outward arrival is not yet a return');
  sonar.update(7);
  assert.equal(sonar.pulse.outgoingRadius, 140);
  assert.equal(sonar.pulse.returnRadius, 100);
  assert.equal(sonar.pulse.phase, 'returning');
  const echo = sonar.getEcho('echo');
  close(echo.physicalArrivalAt - echo.emittedAt, 2 * 100 / 1500);
  close(echo.arrivalAt - echo.emittedAt, 2);
  sonar.update(5 + arrival(140));
  assert.equal(sonar.pulse.active, false);
  assert.equal(sonar.pulse.phase, 'complete');
  assert.equal(sonar.pulse.progress, 1);
});

test('range, depth and absolute bearing are measured; cardinals follow world north=-Z', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('north'), contact('east', 0, { x: 50 }),
    contact('south', -50), contact('west', 0, { x: -50 }),
    contact('lower', 0, { y: -40 }), contact('same', 0)]);
  sonar.update(1);
  for (const [id, degrees] of [['north', 0], ['east', 90], ['south', 180], ['west', 270]]) {
    const echo = sonar.getEcho(id);
    close(echo.bearing, degrees);
    assert.equal(echo.range, 50);
    assert.equal(echo.depth, 20);
  }
  assert.equal(sonar.getEcho('lower').depth, 40);
  assert.equal(sonar.getEcho('lower').bearing, null);
  assert.equal(sonar.getEcho('same').range, 0);
  assert.equal(sonar.getEcho('same').relativeBearing, null);
});

test('moving/turning observer changes navigation bearing, never emission range, arrival or target coordinates', () => {
  const sonar = createSonarController(), source = origin();
  sonar.emit(source, 0, [contact('target', 50)]);
  source.x = 300;
  source.y = -200;
  sonar.update(.9, origin({ z: -49 }));
  assert.equal(sonar.getEcho('target'), null, 'swimming toward it cannot accelerate the saved return');
  sonar.update(1, origin({ x: 50, z: -50, yaw: Math.PI / 2 }));
  const echo = sonar.getEcho('target');
  assert.equal(echo.range, 50);
  assert.equal(echo.arrivalAt, 1);
  assert.equal(echo.bearing, 0);
  assert.equal(echo.currentRange, 50);
  assert.equal(echo.currentBearing, 270);
  close(echo.relativeBearing, 0);
  assert.deepEqual([echo.x, echo.y, echo.z], [0, -20, -50]);
  assert.deepEqual(sonar.pulse.origin, { x: 0, y: -20, z: 0 });
  sonar.update(1.1, origin({ x: 50, z: -50, yaw: 0 }));
  assert.equal(echo.relativeBearing, -90);
});

test('moving large-creature target is a saved echo, with no fabricated prediction or live position tracking', () => {
  const sonar = createSonarController();
  const creature = contact('shark', 60, { kind: 'creature', name: 'LARGE MOVEMENT' });
  sonar.emit(origin(), 0, [creature]);
  creature.x = 900;
  creature.z = 900;
  sonar.update(arrival(60));
  const echo = sonar.getEcho('shark');
  assert.equal(echo.mobile, true);
  assert.equal(echo.name, 'LARGE MOVEMENT');
  assert.deepEqual([echo.x, echo.y, echo.z], [0, -20, -60]);
  assert.equal(echo.range, 60);
  sonar.emit(origin(), 9, [creature]);
  sonar.update(12);
  assert.equal(sonar.getEcho('shark'), null, 'next ping no longer detects the now-distant target');
});

test('home, air bell, rig, landmarks and creatures can all produce real range-limited echoes', () => {
  const sonar = createSonarController();
  const kinds = ['landmark', 'objective', 'home', 'air', 'rig', 'creature'];
  sonar.emit(origin(), 0, kinds.map((kind, i) => contact(kind, 20 + i * 10, { kind, known: kind === 'home' })));
  sonar.update(2);
  assert.equal(sonar.echoes.length, kinds.length);
  for (const kind of kinds) {
    assert.equal(sonar.getEcho(kind).kind, kind);
    assert.equal(sonar.getEcho(kind).source, 'sonar');
    assert.equal(sonar.getEcho(kind).known, kind === 'home');
  }
});

test('each revealed echo fades and expires from its timestamp, not from first rendered frame', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('near', 25), contact('far', 125)]);
  sonar.update(2.5);
  close(sonar.getEcho('near').strength, .6);
  close(sonar.getEcho('far').strength, 1);
  sonar.update(5.5);
  assert.equal(sonar.getEcho('near'), null);
  assert.ok(sonar.getEcho('far'));
  sonar.update(7.5);
  assert.deepEqual(ids(sonar), []);
});

test('a long update gap does not resurrect stale echoes or play their old arrival sounds', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('target')]);
  sonar.update(30);
  assert.equal(sonar.echoes.length, 0);
  assert.equal(sonar.newEchoes.length, 0);
  assert.equal(sonar.pendingCount, 0);
  assert.equal(sonar.receivedCount, 1);
  assert.equal(sonar.cooldownRemaining, 0);
});

test('cooldown refuses repeated emissions without replacing ping origin or pending contacts', () => {
  const sonar = createSonarController();
  assert.equal(sonar.emit(origin(), 3, [contact('first')]), true);
  assert.equal(sonar.emit(origin({ x: 100 }), 3, [contact('second')]), false);
  assert.equal(sonar.blockedReason, 'cooldown');
  assert.equal(sonar.cooldownRemaining, 9);
  assert.deepEqual(sonar.pulse.origin, { x: 0, y: -20, z: 0 });
  sonar.update(4);
  assert.deepEqual(ids(sonar), ['first']);
  assert.equal(sonar.emit(origin(), 11.999, [contact('second')]), false);
  assert.equal(sonar.emit(origin(), 12, [contact('second')]), true);
  sonar.update(13);
  assert.deepEqual(ids(sonar), ['second']);
});

test('paused game time preserves pulse, contacts, fade and cooldown exactly', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('target')]);
  sonar.update(1.2);
  sonar.update(1.2); // consume ephemeral new-arrivals view
  const before = sonar.snapshot();
  for (let i = 0; i < 200; i++) sonar.update(1.2);
  assert.deepEqual(sonar.snapshot(), before);
  sonar.update(400, origin({ status: 'paused' }));
  assert.deepEqual(sonar.snapshot(), before);
  assert.equal(sonar.emit(origin({ status: 'paused' }), 400, []), false);
  assert.equal(sonar.cooldownRemaining, before.cooldownRemaining);
  sonar.update(1.3);
  close(sonar.cooldownRemaining, 7.7);
});

test('backward simulation clock resets previous expedition detections and cooldown', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 100, [contact('old')]);
  sonar.update(101);
  assert.ok(sonar.getEcho('old'));
  sonar.update(0);
  assert.equal(sonar.pulse.active, false);
  assert.equal(sonar.cooldownRemaining, 0);
  assert.equal(sonar.echoes.length, 0);
  assert.equal(sonar.receivedCount, 0);
  assert.equal(sonar.emit(origin(), 0, [contact('new')]), true);
  sonar.update(1);
  assert.deepEqual(ids(sonar), ['new']);
});

test('dry rooms, air bells, surface and inactive status cannot emit or consume cooldown', () => {
  for (const properties of [{ inAir: true }, { movementMode: 'walk' }, { underwater: false },
    { indoors: true, waterLevel: -Infinity }, { indoors: true, waterLevel: -21 },
    { indoors: true, waterLevel: -20 }, { y: 0 }, { y: 2 }, { status: 'menu' }, { status: 'paused' }]) {
    const sonar = createSonarController();
    assert.equal(sonar.emit(origin(properties), 0, [contact('target')]), false, JSON.stringify(properties));
    assert.equal(sonar.cooldownRemaining, 0);
    assert.equal(sonar.pulse.active, false);
    assert.deepEqual(ids(sonar), []);
  }
  const sonar = createSonarController();
  assert.equal(sonar.emit(origin({ indoors: true, waterLevel: -19 }), 0, [contact('target')]), true,
    'a flooded wet lock still permits underwater emission');
});

test('entering a dry room cancels reception without refunding the consumed cooldown', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('near', 10), contact('far', 140)]);
  sonar.update(.5);
  assert.ok(sonar.getEcho('near'));
  sonar.update(.75, origin({ movementMode: 'walk' }));
  assert.equal(sonar.blockedReason, 'dry');
  assert.equal(sonar.pulse.active, false);
  assert.equal(sonar.echoes.length, 0);
  close(sonar.cooldownRemaining, 8.25);
  sonar.update(3, origin());
  assert.equal(sonar.getEcho('far'), null, 'aborted wet ping cannot resume on leaving room');
  assert.equal(sonar.emit(origin(), 3, [contact('new')]), false);
});

test('malformed contacts, nonfinite coordinates and duplicate IDs cannot create phantom echoes', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [null, {}, { id: 'empty' }, contact('invalid', NaN), contact('infinite', Infinity),
    contact('bad-y', 20, { y: NaN }), contact(12), contact(''), contact('  '), contact('a'.repeat(81)),
    contact('target', 80), contact('target', 20), contact('  target  ', 10),
    contact('valid-after-bad', NaN), contact('valid-after-bad', 30),
    contact('fallback', 40, { kind: 'not-a-kind', name: null }), contact('long-name', 50, { name: 'a'.repeat(500) })]);
  sonar.update(2);
  assert.deepEqual(ids(sonar), ['valid-after-bad', 'fallback', 'long-name', 'target']);
  assert.equal(sonar.getEcho('target').range, 80, 'first valid in-range duplicate owns the ID');
  assert.equal(sonar.getEcho('fallback').kind, 'landmark');
  assert.equal(sonar.getEcho('fallback').name, 'fallback');
  assert.equal(sonar.getEcho('long-name').name.length, 100);
});

test('bad time, origin and contact-list values are rejected safely', () => {
  const sonar = createSonarController();
  for (const time of [NaN, Infinity, -1, '0', null, 1e13]) assert.equal(sonar.emit(origin(), time, []), false);
  for (const value of [null, {}, { x: NaN, y: -20, z: 0 }, origin({ y: Infinity })]) {
    assert.equal(sonar.emit(value, 0, []), false);
  }
  for (const list of [null, {}, 'test']) assert.equal(sonar.emit(origin(), 0, list), false);
  assert.equal(sonar.cooldownRemaining, 0);
  sonar.emit(origin(), 0, [contact('target')]);
  sonar.update(1);
  const before = sonar.snapshot();
  for (const time of [NaN, Infinity, -1, '0', null]) sonar.update(time);
  assert.deepEqual(sonar.snapshot(), before);
  sonar.update(1.1, { x: NaN, y: Infinity, z: '0' });
  assert.equal(sonar.getEcho('target').currentRange, 50);
});

test('contact and input bounds are stable: nearest contacts win within bounded candidate work', () => {
  const contacts = Array.from({ length: 256 }, (_, i) => contact('id-' + String(i).padStart(3, '0'), 139 - i * .25));
  const sonar = createSonarController();
  const poisoned = contact('must-not-read', 1);
  Object.defineProperty(poisoned, 'x', { get() { throw new Error('input budget exceeded'); } });
  contacts.push(poisoned);
  sonar.emit(origin(), 0, contacts);
  sonar.update(3);
  assert.equal(sonar.echoes.length, SONAR.maxContacts);
  assert.deepEqual(ids(sonar), contacts.slice(240, 256).reverse().map(c => c.id));
  assert.equal(sonar.snapshot().candidateCount, SONAR.maxContacts);
  assert.equal(sonar.pendingCount, 0);
  const reversed = createSonarController();
  reversed.emit(origin(), 0, contacts.slice(0, 256).reverse());
  reversed.update(3);
  assert.deepEqual(ids(reversed), ids(sonar));
});

test('30/60/120Hz and irregular updates converge on identical timestamped echo state', () => {
  function run(schedule) {
    const sonar = createSonarController();
    sonar.emit(origin(), 0, [contact('a', 20), contact('b', 60), contact('c', 140)]);
    let time = 0, index = 0;
    while (time < 4) { time = Math.min(4, time + schedule[index++ % schedule.length]); sonar.update(time); }
    sonar.update(4); // normalize ephemeral newEchoes
    return sonar.snapshot();
  }
  const expected = run([1 / 60]);
  assert.deepEqual(run([1 / 30]), expected);
  assert.deepEqual(run([1 / 120]), expected);
  assert.deepEqual(run([.01, .087, .003, .17, .033]), expected);
  assert.deepEqual(run([4]), expected);
});

test('steady updates retain array, pulse, origin and live-echo identities; arrival event fires once', () => {
  const sonar = createSonarController();
  const echoes = sonar.echoes, arrivals = sonar.newEchoes, pulse = sonar.pulse, pingOrigin = pulse.origin;
  sonar.emit(origin(), 0, [contact('target')]);
  sonar.update(1);
  assert.equal(arrivals.length, 1);
  const echo = sonar.getEcho('target');
  for (let i = 0; i < 500; i++) {
    sonar.update(1 + i * .001, origin());
    assert.equal(sonar.echoes, echoes);
    assert.equal(sonar.newEchoes, arrivals);
    assert.equal(sonar.pulse, pulse);
    assert.equal(sonar.pulse.origin, pingOrigin);
    assert.equal(sonar.getEcho('target'), echo);
    assert.equal(arrivals.length, 0);
  }
});

test('sonar reveals targets but never collects, banks, saves or mutates input state', () => {
  const state = Object.assign(createDive(), origin());
  const before = JSON.stringify(state), progressBefore = serializableProgress(state);
  const target = Object.freeze(contact('glass', 30, { kind: 'objective', collected: false, scanned: false }));
  const sonar = createSonarController();
  sonar.emit(state, 0, Object.freeze([target]));
  sonar.update(1, state);
  assert.ok(sonar.getEcho('glass'));
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(serializableProgress(state), progressBefore);
  assert.equal(target.collected, false);
  assert.equal(target.scanned, false);
});

test('snapshots do not alias controller state; reset and disposal are complete and idempotent', () => {
  const sonar = createSonarController();
  sonar.emit(origin(), 0, [contact('target')]);
  sonar.update(1);
  const snapshot = sonar.snapshot();
  snapshot.pulse.origin.x = 1000;
  snapshot.echoes[0].x = 1000;
  snapshot.echoes.length = 0;
  assert.equal(sonar.pulse.origin.x, 0);
  assert.equal(sonar.getEcho('target').x, 0);
  sonar.reset();
  assert.equal(sonar.cooldownRemaining, 0);
  assert.equal(sonar.pulse.emittedAt, null);
  assert.equal(sonar.echoes.length, 0);
  assert.equal(sonar.newEchoes.length, 0);
  assert.equal(sonar.pendingCount, 0);
  assert.equal(sonar.emit(origin(), 0, [contact('new')]), true);
  sonar.dispose();
  sonar.dispose();
  sonar.reset();
  sonar.update(100);
  assert.equal(sonar.emit(origin(), 100, []), false);
  assert.equal(sonar.snapshot().disposed, true);
  assert.equal(sonar.blockedReason, 'disposed');
  assert.equal(sonar.echoes.length, 0);
});
