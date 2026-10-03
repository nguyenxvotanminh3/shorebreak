// These tests deform the actual corrected-v3 GLBs with real Three.js skinning.
// Only image decoding is removed for Node; they do not claim pixel/render QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createSharkMotion } from '../dist/abyss-shark-motion.js';

globalThis.ProgressEvent ||= class ProgressEvent extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
const TAU = Math.PI * 2;
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (tolerance ${tolerance})`);
const states = {
  cruise: { speed: 1.6, acceleration: 0, turnRate: 0, alert: 0, cruiseWeight: 1, accelerateWeight: 0, turnWeight: 0, reactWeight: 0 },
  faster: { speed: 3.6, acceleration: 1.2, turnRate: 0, alert: 0, cruiseWeight: 0, accelerateWeight: 1, turnWeight: 0, reactWeight: 0 },
  turn: { speed: 1.8, acceleration: 0, turnRate: .55, alert: 0, cruiseWeight: 0, accelerateWeight: 0, turnWeight: 1, reactWeight: 0 },
  alert: { speed: 2.8, acceleration: .8, turnRate: 0, alert: 1, cruiseWeight: 0, accelerateWeight: 0, turnWeight: 0, reactWeight: 1 },
};

async function load(file) {
  const raw = await readFile(new URL('../dist/assets/abyss/' + file, import.meta.url));
  const jsonLength = raw.readUInt32LE(12), doc = JSON.parse(raw.subarray(20, 20 + jsonLength)), at = 20 + jsonLength;
  doc.buffers[0].uri = 'data:application/octet-stream;base64,' + raw.subarray(at + 8, at + 8 + raw.readUInt32LE(at)).toString('base64');
  doc.materials = doc.materials.map(material => ({ name: material.name }));
  delete doc.images; delete doc.textures; delete doc.samplers;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
  const mixer = new THREE.AnimationMixer(gltf.scene), clip = gltf.animations[0], meshes = [], bones = [];
  mixer.clipAction(clip).play();
  gltf.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); if (node.isBone) bones.push(node); });
  const driver = createSharkMotion(gltf.scene, gltf.animations);
  const mesh = meshes[0], positions = mesh.geometry.attributes.position, indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const regions = { head: [], spine: [], tail: [], left: [], right: [], dorsal: [] };
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    if (z < -2.6) regions.head.push(index);
    if (z > .15 && z < .65 && Math.abs(x) > .25 && y < .5) regions.spine.push(index);
    if (z > 3.8) regions.tail.push(index);
    if (x < -1.8) regions.left.push(index);
    if (x > 1.8) regions.right.push(index);
    if (y > 1.6) regions.dorsal.push(index);
    for (let lane = 0; lane < 4; lane++) assert.ok(indices.array[index * 4 + lane] < 8 && Number.isFinite(weights.array[index * 4 + lane]));
  }
  // Evenly subsample the original vertices within each anatomical region.
  for (const name of Object.keys(regions)) {
    const source = regions[name]; assert.ok(source.length > 0, `${file} missing ${name} probes`);
    regions[name] = Array.from({ length: Math.min(12, source.length) }, (_, index) => source[Math.floor(index * source.length / Math.min(12, source.length))]);
  }
  function sample(phase, state = states.cruise, procedural = true, dt = 1 / 60) {
    const motion = { ...state, phase, time: phase / TAU * 2.4, clipTime: phase / TAU * clip.duration };
    mixer.setTime(motion.clipTime);
    if (procedural) driver.update(dt, motion);
    gltf.scene.updateMatrixWorld(true);
    for (const skinned of meshes) skinned.skeleton.update();
    return motion;
  }
  function capture() {
    return Object.fromEntries(Object.entries(regions).map(([name, vertices]) => [name, vertices.map(index => {
      const position = new THREE.Vector3().fromBufferAttribute(positions, index);
      return mesh.applyBoneTransform(index, position).toArray();
    })]));
  }
  return { ...gltf, file, clip, mixer, driver, meshes, bones, regions, sample, capture };
}

function excursion(frames, region, axis = 0) {
  return Math.max(...frames[0][region].map((_, index) => {
    const values = frames.map(frame => frame[region][index][axis]);
    return Math.max(...values) - Math.min(...values);
  }));
}
function displacement(a, b, region) {
  return Math.max(...a[region].map((point, index) => Math.hypot(...point.map((value, axis) => value - b[region][index][axis]))));
}
function pose(rig) { return rig.bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]); }
function closePose(a, b, tolerance = 1e-7) { a.forEach((values, index) => values.forEach((value, lane) => close(value, b[index][lane], tolerance))); }

for (const file of ['shark.glb', 'shark-lod.glb']) {
  test(`${file}: maps real authored joints and reports actual weight/track limitations`, async t => {
    const rig = await load(file), report = rig.driver.snapshot();
    assert.equal(rig.bones.length, 8); assert.equal(rig.animations.length, 1); assert.equal(rig.clip.tracks.length, 24);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.mapping, { root: 'root', body: 'body', spine: 'spine', tailbase: 'tailbase', tailtip: 'tailtip', pectoralL: 'pectoralL', pectoralR: 'pectoralR' });
    assert.equal(report.weighted.jaw, 0); assert.equal(report.weighted.root, 0);
    for (const name of ['body', 'spine', 'tailbase', 'tailtip', 'pectoralL', 'pectoralR']) assert.ok(report.weighted[name.toLowerCase()] > 100);
    assert.match(report.dorsal, /no independent dorsal joint/);
    const maxAuthored = {};
    for (const name of ['body', 'spine', 'tailbase', 'tailtip']) {
      const bone = rig.bones.find(bone => bone.name === name), bind = bone.quaternion.clone();
      const track = rig.clip.tracks.find(track => track.name === `${name}.quaternion`), q = new THREE.Quaternion();
      maxAuthored[name] = 0;
      for (let index = 0; index < track.values.length; index += 4) maxAuthored[name] = Math.max(maxAuthored[name], bind.angleTo(q.fromArray(track.values, index).normalize()));
    }
    close(maxAuthored.body, .018, 1e-5); close(maxAuthored.spine, .055, 1e-4);
    close(maxAuthored.tailbase, .16, 1e-3); close(maxAuthored.tailtip, .26, 1e-3);
    t.diagnostic(JSON.stringify({ file, vertices: rig.meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0), weighted: report.weighted, authoredPeakDegrees: Object.fromEntries(Object.entries(maxAuthored).map(([name, value]) => [name, +(value * 180 / Math.PI).toFixed(2)])) }));
  });

  test(`${file}: real caudal deformation grows toward the tail and increases with effort`, async t => {
    // Separate instances avoid allowing procedural pose remnants into baseline.
    const authored = await load(file), enhanced = await load(file), baseline = [], cruise = [], faster = [], alert = [];
    for (let frame = 0; frame <= 96; frame++) {
      const phase = frame / 96 * TAU;
      authored.sample(phase, states.cruise, false); baseline.push(authored.capture());
      enhanced.sample(phase); cruise.push(enhanced.capture());
      enhanced.sample(phase, states.faster); faster.push(enhanced.capture());
      enhanced.sample(phase, states.alert); alert.push(enhanced.capture());
    }
    const result = {
      authoredTailMeters: excursion(baseline, 'tail') * .5595,
      cruiseTailMeters: excursion(cruise, 'tail') * .5595,
      fasterTailMeters: excursion(faster, 'tail') * .5595,
      alertTailMeters: excursion(alert, 'tail') * .5595,
      cruiseHeadMeters: excursion(cruise, 'head') * .5595,
      cruiseSpineMeters: excursion(cruise, 'spine') * .5595,
    };
    assert.ok(result.authoredTailMeters > 1 && result.authoredTailMeters < 1.4, 'authored asset is subtly animated, not actually static');
    assert.ok(result.cruiseTailMeters > result.authoredTailMeters * 1.25);
    assert.ok(result.fasterTailMeters > result.cruiseTailMeters * 1.2);
    assert.ok(result.alertTailMeters > result.cruiseTailMeters * 1.1);
    assert.ok(result.cruiseTailMeters > result.cruiseSpineMeters * 3);
    assert.ok(result.cruiseTailMeters > result.cruiseHeadMeters * 8);
    assert.ok(result.fasterTailMeters < 2.9, 'bounded tail excursion relative to four-meter model');
    assert.ok(excursion(cruise, 'left', 1) > .025, 'real pectoral surface changes lift');
    assert.ok(excursion(cruise, 'dorsal') > .02, 'dorsal follows articulated trunk weights');
    t.diagnostic(JSON.stringify({ file, ...result }));
  });

  test(`${file}: curvature phase lag, directional control surfaces and alert are distinct`, async () => {
    const rig = await load(file);
    const peaks = Object.fromEntries(['body', 'spine', 'tailbase', 'tailtip'].map(name => [name, { angle: -Infinity, phase: 0 }]));
    for (let frame = 0; frame < 200; frame++) {
      const phase = frame / 200 * TAU; rig.sample(phase);
      const offsets = rig.driver.snapshot().offsets;
      for (const name of Object.keys(peaks)) if (offsets[name].z > peaks[name].angle) peaks[name] = { angle: offsets[name].z, phase };
    }
    assert.ok(peaks.body.phase < peaks.spine.phase && peaks.spine.phase < peaks.tailbase.phase && peaks.tailbase.phase < peaks.tailtip.phase);
    assert.ok(peaks.body.angle < peaks.spine.angle && peaks.spine.angle < peaks.tailbase.angle && peaks.tailbase.angle < peaks.tailtip.angle);
    rig.sample(.9); const straight = rig.capture();
    rig.sample(.9, states.turn); const left = rig.capture(), leftOffsets = rig.driver.snapshot().offsets;
    rig.sample(.9, { ...states.turn, turnRate: -.55 }); const right = rig.capture(), rightOffsets = rig.driver.snapshot().offsets;
    assert.ok(leftOffsets.root.y < 0 && rightOffsets.root.y > 0, 'bank reverses with steering');
    close(leftOffsets.pectoralL.x, rightOffsets.pectoralR.x);
    close(leftOffsets.pectoralR.x, rightOffsets.pectoralL.x);
    assert.ok(displacement(straight, left, 'tail') > .3);
    assert.ok(displacement(left, right, 'tail') > .6);
    assert.ok(displacement(left, right, 'left') > .25 && displacement(left, right, 'right') > .25);
    // Compare an entire beat: a single pose near a zero crossing can have the
    // same tail position despite very different propulsive amplitude.
    let alertTail = 0, alertFin = 0;
    for (let frame = 0; frame < 24; frame++) {
      const phase = frame / 24 * TAU; rig.sample(phase); const cruising = rig.capture();
      rig.sample(phase, states.alert); const reacting = rig.capture();
      alertTail = Math.max(alertTail, displacement(cruising, reacting, 'tail'));
      alertFin = Math.max(alertFin, displacement(cruising, reacting, 'left'));
    }
    assert.ok(alertTail > .2); assert.ok(alertFin > .04);
    // Smooth parent-owned weights remain smooth through each action change;
    // the driver adds no independent lag that could differ between LODs.
    for (const [from, to] of [[states.cruise, states.faster], [states.faster, states.turn], [states.turn, states.alert]]) {
      rig.sample(2.4, from); let previous = rig.bones.map(bone => bone.quaternion.clone());
      for (let step = 1; step <= 60; step++) {
        const blended = Object.fromEntries(Object.keys(from).map(name => [name, from[name] + (to[name] - from[name]) * step / 60]));
        rig.sample(2.4, blended);
        rig.bones.forEach((bone, index) => assert.ok(previous[index].angleTo(bone.quaternion) < .013, `${bone.name} transition pop`));
        previous = rig.bones.map(bone => bone.quaternion.clone());
      }
    }
  });

  test(`${file}: seamless cyclic articulation, deterministic dt0, and no accumulated offsets`, async () => {
    const rig = await load(file);
    for (const state of Object.values(states)) {
      rig.sample(0, state); const start = pose(rig), startCapture = rig.capture();
      rig.sample(TAU, state); closePose(pose(rig), start, 1e-6);
      rig.sample(TAU - 1e-5, state); const before = rig.capture();
      rig.sample(1e-5, state); const after = rig.capture();
      for (const region of Object.keys(before)) assert.ok(displacement(before, after, region) < .0003);
      rig.sample(0, state); for (const region of Object.keys(before)) assert.ok(displacement(startCapture, rig.capture(), region) < 1e-6);
      const motion = rig.sample(1.31, state), frozen = pose(rig), snapshot = rig.driver.snapshot();
      for (let frame = 0; frame < 180; frame++) {
        // Mixer is allowed to skip writes of unchanged root/body tracks.
        rig.mixer.setTime(motion.clipTime); rig.driver.update(0, motion); closePose(pose(rig), frozen, 1e-12);
      }
      assert.deepEqual(rig.driver.snapshot(), snapshot);
      // Reapplication without even a mixer call must not accumulate either.
      for (let frame = 0; frame < 180; frame++) rig.driver.update(1 / 60, motion);
      closePose(pose(rig), frozen, 1e-12);
    }
  });

  test(`${file}: finite bounded poses preserve local transforms, meshes and resource ownership`, async () => {
    const rig = await load(file), rootPosition = rig.scene.position.toArray(), rootScale = rig.scene.scale.toArray();
    rig.scene.position.set(17, -4, 9); rig.scene.rotation.set(.12, .3, -.07); rig.scene.scale.setScalar(.5595);
    const container = [rig.scene.position.toArray(), rig.scene.quaternion.toArray(), rig.scene.scale.toArray()];
    const resources = rig.meshes.map(mesh => [mesh.geometry, mesh.material, mesh.skeleton, mesh.geometry.attributes.position.array, mesh.geometry.attributes.skinWeight.array]);
    let disposal = 0;
    for (const mesh of rig.meshes) { mesh.geometry.addEventListener('dispose', () => disposal++); mesh.material.addEventListener('dispose', () => disposal++); }
    for (let frame = 0; frame < 1800; frame++) {
      const state = { ...states.alert, speed: 2 + 20 * Math.sin(frame), acceleration: Math.cos(frame) * 20, turnRate: Math.sin(frame * .2) * 15, turnWeight: 1, accelerateWeight: 1 };
      const phase = frame * .173, clipTime = phase / TAU * rig.clip.duration;
      rig.mixer.setTime(clipTime);
      const local = rig.bones.map(bone => [...bone.position.toArray(), ...bone.scale.toArray()]);
      rig.driver.update(1 / 60, { ...state, phase, clipTime });
      for (const [index, bone] of rig.bones.entries()) {
        assert.deepEqual([...bone.position.toArray(), ...bone.scale.toArray()], local[index]);
        assert.ok(bone.quaternion.toArray().every(Number.isFinite)); close(bone.quaternion.length(), 1, 2e-6);
      }
      const offsets = rig.driver.snapshot().offsets;
      for (const offset of Object.values(offsets)) assert.ok(Math.hypot(offset.x, offset.y, offset.z) < .34);
      if (frame % 30 === 0) {
        rig.scene.updateMatrixWorld(true);
        for (const mesh of rig.meshes) { mesh.skeleton.update(); assert.ok(Array.from(mesh.skeleton.boneMatrices).every(Number.isFinite)); }
        for (const points of Object.values(rig.capture())) for (const point of points) assert.ok(point.every(Number.isFinite) && Math.hypot(...point) < 10);
      }
    }
    assert.deepEqual([rig.scene.position.toArray(), rig.scene.quaternion.toArray(), rig.scene.scale.toArray()], container);
    resources.forEach((resource, index) => assert.deepEqual([rig.meshes[index].geometry, rig.meshes[index].material, rig.meshes[index].skeleton, rig.meshes[index].geometry.attributes.position.array, rig.meshes[index].geometry.attributes.skinWeight.array], resource));
    rig.sample(.8, states.turn); rig.driver.dispose(); const released = pose(rig); rig.driver.dispose(); rig.driver.update(1, { ...states.faster, phase: 3 });
    closePose(pose(rig), released); assert.equal(disposal, 0); assert.equal(rig.driver.snapshot().disposed, true);
    // Model disposal stays the parent's responsibility. No new render resources.
    assert.deepEqual(rootPosition, [0, 0, 0]); assert.deepEqual(rootScale, [1, 1, 1]);
  });
}

test('both real LODs match phase, joint offsets, first-load pose and update-rate histories', async () => {
  const full = await load('shark.glb'), low = await load('shark-lod.glb');
  for (const state of Object.values(states)) {
    for (let frame = 0; frame < 60; frame++) full.sample(frame / 60 * 2.75, state, true, 1 / 60);
    const motion = full.sample(2.75, state); low.mixer.setTime(motion.clipTime); low.driver.update(0, motion);
    assert.deepEqual(full.driver.snapshot().offsets, low.driver.snapshot().offsets);
    full.bones.forEach(bone => { const other = low.bones.find(candidate => candidate.name === bone.name); assert.ok(bone.quaternion.angleTo(other.quaternion) < 2e-6, bone.name); });
    for (const hz of [30, 60, 120]) {
      for (let frame = 0; frame < hz; frame++) low.sample(frame / hz * 2.75, state, true, 1 / hz);
      low.sample(2.75, state, true, 1 / hz);
      assert.deepEqual(full.driver.snapshot().offsets, low.driver.snapshot().offsets);
    }
  }
});

test('missing bones and nonfinite inputs are safe without creating synthetic joints', () => {
  const model = new THREE.Group(), root = new THREE.Bone(); root.name = 'root'; model.add(root);
  const controller = createSharkMotion(model, []);
  controller.update(0, { phase: NaN, speed: Infinity, turnRate: NaN, acceleration: -Infinity, alert: NaN });
  assert.equal(model.children.length, 1); assert.equal(controller.snapshot().missing.length, 6);
  assert.ok(root.quaternion.toArray().every(Number.isFinite));
  const pose = root.quaternion.toArray(); for (let frame = 0; frame < 100; frame++) controller.update(0, { phase: NaN });
  assert.deepEqual(root.quaternion.toArray(), pose); controller.dispose(); controller.dispose();
});
