// Controller checks use explicit loader fixtures and actual Three mixers/skins.
// The final asset checks below parse its unchanged geometry/animation bytes, but
// strip bitmap decoding in Node. Neither category is a rendered-pixel test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { ARM_CLIPS, armClearance, createDiverArms } from '../dist/abyss-arms.js';
import { limitFlashlightOnMaterial } from '../dist/abyss-flashlight.js';

const openWater = { status: 'playing', x: 0, y: 3, z: 0, yaw: 0, pitch: 0, terrain: () => -20, colliders: [] };
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (tolerance ${tolerance})`);
function fixture(names = ARM_CLIPS) {
  const scene = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'FixtureWrist';
  const geometry = new THREE.BoxGeometry(.15, .15, .5), count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.SkinnedMesh(geometry, material); mesh.add(bone); scene.add(mesh);
  const skeleton = new THREE.Skeleton([bone]); mesh.bind(skeleton);
  // Shared resources deliberately appear twice to test exactly-once cleanup.
  const shared = new THREE.Mesh(geometry, material); scene.add(shared);
  const animations = names.map((name, index) => new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack('FixtureWrist.rotation[x]', [0, .5, 1], [0, (index + 1) * .2, 0]),
  ]));
  const disposed = { geometry: 0, material: 0, texture: 0, skeleton: 0 };
  for (const [name, resource] of Object.entries({ geometry, material, texture })) resource.addEventListener('dispose', () => disposed[name]++);
  const disposeSkeleton = skeleton.dispose.bind(skeleton); skeleton.dispose = () => { disposed.skeleton++; disposeSkeleton(); };
  return { scene, animations, mesh, bone, geometry, material, texture, skeleton, disposed };
}
async function rig(t, options = {}) {
  const model = fixture(), camera = new THREE.PerspectiveCamera(70, 16 / 9, .08, 330);
  const calls = [], reports = [];
  const arms = createDiverArms(camera, { loader: { async loadAsync(url) { calls.push(url); return model; } }, onAsset: data => reports.push(data), ...options });
  t.after(() => arms.dispose()); assert.equal(await arms.ready, true);
  return { arms, camera, model, calls, reports };
}
function run(arms, seconds, context = {}, hz = 60) {
  for (let i = 0; i < Math.round(seconds * hz); i++) arms.update(1 / hz, { ...openWater, ...context });
}
function normalized(snapshot) { close(Object.values(snapshot.weights).reduce((a, b) => a + b, 0), 1); for (const w of Object.values(snapshot.weights)) assert.ok(w >= 0 && w <= 1); }

test('clearance probes floor, all three hand lanes and finite cylinders in camera direction', () => {
  close(armClearance(openWater, openWater.terrain), 1.4);
  close(armClearance(openWater), 1.4);
  const solid = { x: 0, y: 3, z: -1, radius: .2, height: 2 };
  close(armClearance(openWater, openWater.terrain, [solid]), .73);
  close(armClearance(openWater, openWater.terrain, [{ ...solid, z: 1 }]), 1.4);
  close(armClearance(openWater, openWater.terrain, [{ ...solid, y: -10 }]), 1.4);
  close(armClearance(openWater, openWater.terrain, [{ ...solid, x: .26, radius: .02 }]), .91);
  close(armClearance({ ...openWater, yaw: Math.PI / 2 }, openWater.terrain, [{ ...solid, x: -1, z: 0 }]), .73);
  close(armClearance(openWater, openWater.terrain, [{ ...solid, z: 0 }]), 0);
  const floor = armClearance({ ...openWater, y: .5, pitch: -Math.PI / 2 }, () => 0);
  assert.ok(floor >= .45 && floor <= .54);
  const downward = armClearance({ ...openWater, pitch: -Math.PI / 2 }, () => -20, [{ x: 0, z: 0, y: 1.5, radius: 1, height: 1 }]);
  close(downward, 1);
});

test('ready rig stays camera-parented and all arm materials obey normal world occlusion', async t => {
  const { arms, camera, model, calls, reports } = await rig(t);
  assert.equal(arms.group.parent, camera); assert.equal(arms.group.visible, false);
  assert.deepEqual(calls, ['./assets/abyss/diver-arms.glb']);
  assert.deepEqual(ARM_CLIPS, ['idle', 'swim', 'sprint', 'scan']); assert.ok(Object.isFrozen(ARM_CLIPS));
  arms.update(0, openWater); const state = arms.snapshot();
  assert.equal(state.status, 'ready'); assert.equal(state.visible, true);
  assert.equal(state.bones, 1); assert.equal(state.geometries, 1); assert.equal(state.materials, 1); assert.equal(state.triangles, 12);
  assert.equal(reports.length, 1); assert.equal(reports[0].status, 'ready');
  model.scene.traverse(node => { if (!node.isMesh) return; assert.equal(node.frustumCulled, false); assert.equal(node.renderOrder, 0); assert.equal(node.castShadow, false); assert.equal(node.receiveShadow, false); });
  assert.equal(model.material.depthTest, true); assert.equal(model.material.depthWrite, true); assert.equal(model.material.transparent, false);
  assert.deepEqual(arms.group.scale.toArray(), [1, 1, 1]);
});

test('loading is hidden, then deferred arrival can become visible without rebuilding the controller', async t => {
  let deliver; const model = fixture(), camera = new THREE.PerspectiveCamera();
  const arms = createDiverArms(camera, { loader: { loadAsync: () => new Promise(resolve => { deliver = resolve; }) } });
  t.after(() => arms.dispose()); run(arms, 1, { vx: 8, sprinting: true });
  assert.equal(arms.snapshot().status, 'loading'); assert.equal(arms.snapshot().visible, false); assert.equal(arms.snapshot().time, 0);
  arms.reset(); deliver(model); assert.equal(await arms.ready, true); run(arms, .1);
  assert.equal(arms.snapshot().visible, true); assert.equal(arms.group.children.length, 1);
});

test('rejected loads report error and missing authored clips release every shared resource', async () => {
  for (const missing of ARM_CLIPS) {
    const model = fixture(ARM_CLIPS.filter(name => name !== missing)), reports = [];
    const arms = createDiverArms(new THREE.PerspectiveCamera(), { loader: { loadAsync: async () => model }, onAsset: result => reports.push(result) });
    assert.equal(await arms.ready, false); run(arms, 1);
    assert.equal(arms.snapshot().status, 'error'); assert.equal(arms.snapshot().visible, false); assert.match(reports[0].message, new RegExp(missing));
    assert.deepEqual(model.disposed, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
    arms.dispose(); assert.equal(model.disposed.geometry, 1);
  }
  const reports = [], arms = createDiverArms(new THREE.PerspectiveCamera(), { loader: { loadAsync: async () => { throw new Error('test network failure'); } }, onAsset: result => reports.push(result) });
  assert.equal(await arms.ready, false); assert.equal(arms.snapshot().status, 'error'); assert.match(reports[0].message, /network failure/); arms.dispose();
});

test('dispose before successful or failed arrival cannot resurrect or leak the rig', async () => {
  for (const fails of [false, true]) {
    let settle; const camera = new THREE.PerspectiveCamera(), model = fixture(), reports = [];
    const arms = createDiverArms(camera, { loader: { loadAsync: () => new Promise((resolve, reject) => { settle = fails ? reject : resolve; }) }, onAsset: data => reports.push(data) });
    arms.dispose(); arms.dispose(); settle(fails ? new Error('late network error') : model); assert.equal(await arms.ready, false);
    run(arms, 1); arms.reset(); assert.equal(arms.snapshot().disposed, true); assert.equal(arms.snapshot().visible, false); assert.equal(camera.children.length, 0); assert.equal(arms.group.children.length, 0); assert.deepEqual(reports, []);
    assert.deepEqual(model.disposed, fails ? { geometry: 0, material: 0, texture: 0, skeleton: 0 } : { geometry: 1, material: 1, texture: 1, skeleton: 1 });
    if (fails) { model.geometry.dispose(); model.material.dispose(); model.texture.dispose(); model.skeleton.dispose(); }
  }
});

test('loaded disposal releases shared model resources once and detaches it from the camera', async t => {
  const { arms, camera, model } = await rig(t); run(arms, .5); arms.dispose(); arms.dispose();
  assert.deepEqual(model.disposed, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
  assert.equal(camera.children.length, 0); assert.equal(arms.group.children.length, 0); assert.equal(arms.snapshot().visible, false);
  const disposed = arms.snapshot(); run(arms, 1, { vx: 8 }); arms.reset(); assert.deepEqual(arms.snapshot(), disposed);
});

test('idle/swim/sprint use actual velocity and scan requires both held input and a real target', async t => {
  const { arms } = await rig(t);
  run(arms, 2, { sprinting: true, scanHeld: true }); assert.equal(arms.snapshot().pose, 'idle'); close(arms.snapshot().weights.idle, 1);
  run(arms, 2, { vx: 4.2 }); assert.equal(arms.snapshot().pose, 'swim'); assert.ok(arms.snapshot().weights.swim > .99);
  run(arms, 2, { vx: 8, sprinting: false }); assert.equal(arms.snapshot().pose, 'swim'); close(arms.snapshot().weights.sprint, 0);
  run(arms, 2, { vy: 8, sprinting: true }); assert.equal(arms.snapshot().pose, 'sprint'); assert.ok(arms.snapshot().weights.sprint > .99);
  run(arms, 2, { nearTarget: 'glass', scanHeld: false }); assert.equal(arms.snapshot().pose, 'idle'); assert.equal(arms.snapshot().weights.scan, 0);
  run(arms, 1, { vz: 8, sprinting: true, nearTarget: 'glass', scanHeld: true }); assert.equal(arms.snapshot().pose, 'scan'); assert.ok(arms.snapshot().weights.scan > .999);
  normalized(arms.snapshot());
  run(arms, 2, { scanHeld: true, nearTarget: null }); assert.equal(arms.snapshot().pose, 'idle'); assert.ok(arms.snapshot().weights.scan < .00001);
});

test('crossfades stay continuous, normalized and consistent across 30/60/120 Hz', async t => {
  const snapshots = [];
  for (const hz of [30, 60, 120]) {
    const { arms } = await rig(t);
    let previous = arms.snapshot();
    for (let frame = 0; frame < hz; frame++) {
      arms.update(1 / hz, { ...openWater, vx: 7, sprinting: true }); const next = arms.snapshot(); normalized(next);
      for (const name of ARM_CLIPS) assert.ok(Math.abs(next.weights[name] - previous.weights[name]) < .25);
      previous = next;
    }
    snapshots.push(arms.snapshot());
  }
  for (const snapshot of snapshots) {
    close(snapshot.time, 1); close(snapshot.mixerTime, 1);
    for (const name of ARM_CLIPS) close(snapshot.weights[name], snapshots[2].weights[name], .008);
    close(snapshot.speed, snapshots[2].speed, 1e-8);
  }
});

test('zero dt and paused state freeze animation, blends, clearance, sway and framing exactly', async t => {
  const { arms, model } = await rig(t); run(arms, .35, { vx: 6, sprinting: true, yaw: .2 });
  const before = arms.snapshot(), pose = model.bone.quaternion.toArray();
  for (let i = 0; i < 20; i++) arms.update(0, { ...openWater, scanHeld: true, nearTarget: 'glass', yaw: i, pitch: .8 });
  assert.deepEqual(arms.snapshot(), before); assert.deepEqual(model.bone.quaternion.toArray(), pose);
  run(arms, 1, { status: 'paused', scanHeld: true, nearTarget: 'glass', yaw: 2 });
  assert.deepEqual(arms.snapshot(), before); assert.deepEqual(model.bone.quaternion.toArray(), pose);
  arms.update(0, { ...openWater, status: 'menu' }); assert.equal(arms.snapshot().visible, false); assert.equal(arms.snapshot().time, before.time);
});

test('collision retraction is bounded and gentle, clears again, and portrait framing never distorts X scale', async t => {
  const { arms, camera } = await rig(t);
  const colliders = [{ x: 0, y: 3, z: -.6, radius: .2, height: 2 }];
  arms.update(1 / 60, { ...openWater, colliders }); let state = arms.snapshot();
  assert.ok(state.retraction > 0 && state.retraction < .2); assert.ok(state.offset.z > 0 && state.offset.z < .01);
  run(arms, 1, { colliders }); state = arms.snapshot(); assert.ok(state.retraction > .95); assert.ok(state.offset.z > .12 && state.offset.z <= .14);
  run(arms, 2); assert.ok(arms.snapshot().retraction < .0001); assert.ok(Math.abs(arms.snapshot().offset.z) < .0001);
  camera.aspect = .5; run(arms, 2); state = arms.snapshot(); assert.ok(state.offset.z < -.16); close(state.offset.y, .035, .0001);
  assert.deepEqual(arms.group.scale.toArray(), [1, 1, 1]); close(state.offset.x, 0);
  camera.aspect = 16 / 9; run(arms, 2); close(arms.snapshot().offset.y, 0, .0001); close(arms.snapshot().offset.z, 0, .0001);
});

test('reduced motion freezes authored idle and suppresses look sway while preserving purposeful poses', async t => {
  const { arms, model } = await rig(t); arms.update(1 / 60, { ...openWater, reducedMotion: true });
  const idlePose = model.bone.quaternion.toArray();
  for (let i = 0; i < 120; i++) arms.update(1 / 60, { ...openWater, reducedMotion: true, yaw: i * .02, pitch: i * .001 });
  assert.deepEqual(model.bone.quaternion.toArray(), idlePose); assert.deepEqual(arms.snapshot().rotation, { x: 0, y: 0, z: 0 });
  run(arms, .4, { reducedMotion: true, vx: 5 }); assert.ok(arms.snapshot().weights.swim > .6); assert.notDeepEqual(model.bone.quaternion.toArray(), idlePose);
  run(arms, .5, { reducedMotion: true, scanHeld: true, nearTarget: 'glass' }); assert.equal(arms.snapshot().pose, 'scan');
});

test('reset and repeated menu/start cycles reuse one rig and restore a neutral blend and transform', async t => {
  const { arms, calls } = await rig(t);
  for (let cycle = 0; cycle < 8; cycle++) {
    run(arms, .5, { vx: 8, sprinting: true }); arms.update(0, { status: 'menu' }); assert.equal(arms.snapshot().visible, false);
    arms.reset(); const state = arms.snapshot(); assert.deepEqual(state.weights, { idle: 1, swim: 0, sprint: 0, scan: 0 });
    assert.equal(state.time, 0); assert.equal(state.mixerTime, 0); assert.equal(state.speed, 0); assert.equal(state.retraction, 0);
    assert.deepEqual(state.offset, { x: 0, y: 0, z: 0 }); assert.deepEqual(state.rotation, { x: 0, y: 0, z: 0 });
    arms.update(0, openWater); assert.equal(arms.snapshot().visible, true); assert.equal(arms.group.children.length, 1);
  }
  assert.equal(calls.length, 1);
  const snapshot = arms.snapshot(); snapshot.weights.idle = 99; snapshot.offset.z = 99;
  assert.equal(arms.snapshot().weights.idle, 1); assert.equal(arms.snapshot().offset.z, 0);
});

async function loadRealArms() {
  const raw = await readFile(new URL('../dist/assets/abyss/diver-arms.glb', import.meta.url));
  assert.equal(raw.readUInt32LE(0), 0x46546c67); assert.equal(raw.readUInt32LE(4), 2); assert.equal(raw.readUInt32LE(8), raw.length);
  assert.equal(raw.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = raw.readUInt32LE(12), doc = JSON.parse(raw.subarray(20, 20 + jsonLength));
  const at = 20 + jsonLength, binLength = raw.readUInt32LE(at); assert.equal(raw.readUInt32LE(at + 4), 0x004e4942);
  const bin = raw.subarray(at + 8, at + 8 + binLength); assert.equal(at + 8 + binLength, raw.length);
  assert.equal(doc.buffers.length, 1); assert.ok(!doc.buffers[0].uri); assert.ok(doc.buffers[0].byteLength <= bin.length);
  for (const view of doc.bufferViews) assert.ok((view.byteOffset || 0) + view.byteLength <= bin.length);
  globalThis.ProgressEvent ||= class ProgressEvent extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  const geometryDoc = structuredClone(doc);
  geometryDoc.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
  // Node cannot decode image bitmaps. Keep original skin/animation bytes and
  // validate the embedded image separately; browser material QA remains required.
  geometryDoc.materials = geometryDoc.materials.map(material => ({
    name: material.name, pbrMetallicRoughness: {
      baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor,
      metallicFactor: material.pbrMetallicRoughness?.metallicFactor,
      roughnessFactor: material.pbrMetallicRoughness?.roughnessFactor,
    },
  }));
  delete geometryDoc.images; delete geometryDoc.textures; delete geometryDoc.samplers;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(geometryDoc), '');
  return { raw, doc, bin, gltf };
}
function disposeReal(gltf) {
  const geometries = new Set(), materials = new Set(), skeletons = new Set();
  gltf.scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.skeleton) skeletons.add(node.skeleton); for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) materials.add(material); });
  for (const skeleton of skeletons) skeleton.dispose(); for (const material of materials) material.dispose(); for (const geometry of geometries) geometry.dispose();
}

test('actual diver GLB stays within bone, triangle, primitive, material, texture and byte budgets', async t => {
  const { raw, doc, bin, gltf } = await loadRealArms(); t.after(() => disposeReal(gltf));
  assert.ok(raw.length < 1_500_000); assert.equal(doc.skins.length, 1); assert.equal(doc.skins[0].joints.length, 37);
  assert.equal(new Set(doc.skins[0].joints).size, 37); assert.equal(doc.materials.length, 1);
  const primitives = doc.meshes.flatMap(mesh => mesh.primitives); assert.equal(primitives.length, 1);
  let triangles = 0;
  for (const primitive of primitives) {
    assert.ok(primitive.mode === undefined || primitive.mode === 4);
    assert.notEqual(primitive.attributes.JOINTS_0, undefined); assert.notEqual(primitive.attributes.WEIGHTS_0, undefined);
    triangles += doc.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 1000 && triangles <= 18000); assert.equal(triangles, 16794);
  assert.equal(doc.images.length, 1);
  for (const image of doc.images) {
    assert.equal(image.mimeType, 'image/png'); assert.ok(Number.isInteger(image.bufferView)); assert.ok(!image.uri);
    const view = doc.bufferViews[image.bufferView], png = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.readUInt32BE(16) <= 512 && png.readUInt32BE(20) <= 512);
  }
  let skins = 0, bones = 0;
  gltf.scene.traverse(node => {
    if (node.isBone) bones++;
    if (!node.isSkinnedMesh) return; skins++;
    const joints = node.geometry.attributes.skinIndex, weights = node.geometry.attributes.skinWeight;
    assert.equal(joints.count, node.geometry.attributes.position.count); assert.equal(weights.count, joints.count);
    for (let i = 0; i < joints.count; i++) {
      let sum = 0;
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(i, component), joint = joints.getComponent(i, component);
        assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
        assert.ok(Number.isInteger(joint) && joint >= 0 && joint < node.skeleton.bones.length); sum += weight;
      }
      close(sum, 1, .0001);
    }
  });
  assert.equal(skins, 1); assert.equal(bones, 37);
});

test('actual diver clips are exact, loop-continuous, finite and authored on the 37-bone rig', async t => {
  const { gltf } = await loadRealArms(); t.after(() => disposeReal(gltf));
  assert.deepEqual(gltf.animations.map(clip => clip.name).sort(), [...ARM_CLIPS].sort());
  const duration = { idle: 4, swim: 3, sprint: 1.6, scan: 3 }, boneNames = new Set(); gltf.scene.traverse(node => { if (node.isBone) boneNames.add(node.name); });
  for (const clip of gltf.animations) {
    close(clip.duration, duration[clip.name], .00001); assert.ok(clip.tracks.length >= 37);
    let changingTracks = 0;
    for (const track of clip.tracks) {
      const name = track.name.slice(0, track.name.lastIndexOf('.')); assert.ok(boneNames.has(name), track.name);
      assert.ok([...track.times, ...track.values].every(Number.isFinite)); assert.ok(track.times.length >= 2);
      close(track.times[0], 0); close(track.times.at(-1), clip.duration, .00001);
      for (let i = 1; i < track.times.length; i++) assert.ok(track.times[i] > track.times[i - 1]);
      const size = track.getValueSize(), first = track.values.slice(0, size), last = track.values.slice(-size);
      let direct = 0, flipped = 0;
      for (let i = 0; i < size; i++) { direct = Math.max(direct, Math.abs(first[i] - last[i])); flipped = Math.max(flipped, Math.abs(first[i] + last[i])); }
      assert.ok((track.name.endsWith('.quaternion') ? Math.min(direct, flipped) : direct) < .00001, clip.name + ': discontinuous ' + track.name);
      if (track.values.some((value, i) => Math.abs(value - first[i % size]) > .00001)) changingTracks++;
    }
    assert.ok(changingTracks >= 2, clip.name + ' must contain real motion');
  }
});

test('actual diver skin deforms in each clip with finite camera-local bounds and distinguishable poses', async t => {
  const { gltf } = await loadRealArms(); t.after(() => disposeReal(gltf));
  const meshes = []; gltf.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  const mixer = new THREE.AnimationMixer(gltf.scene), point = new THREE.Vector3(), poses = new Map();
  t.after(() => { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); });
  for (const clip of gltf.animations) {
    mixer.stopAllAction(); mixer.clipAction(clip).reset().play();
    let firstPose, maximumMotion = 0;
    for (let frame = 0; frame <= 16; frame++) {
      mixer.setTime(clip.duration * frame / 16); gltf.scene.updateMatrixWorld(true); const box = new THREE.Box3(), vertices = [];
      for (const mesh of meshes) {
        mesh.skeleton.update(); assert.ok([...mesh.skeleton.boneMatrices].every(Number.isFinite));
        const positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i); mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld);
          assert.ok([point.x, point.y, point.z].every(Number.isFinite)); box.expandByPoint(point);
          vertices.push(point.x, point.y, point.z);
        }
      }
      assert.ok(!box.isEmpty()); assert.ok(box.min.x > -1 && box.max.x < 1); assert.ok(box.min.y > -1.2 && box.max.y < .3);
      assert.ok(box.min.z > -1.5 && box.max.z < -.08, clip.name + ' stays in front of the un-retracted near plane');
      assert.ok(box.getSize(point).length() > .5 && box.getSize(point).length() < 2);
      if (!firstPose) { firstPose = vertices; poses.set(clip.name, vertices); }
      else for (let i = 0; i < vertices.length; i++) maximumMotion = Math.max(maximumMotion, Math.abs(vertices[i] - firstPose[i]));
      if (frame === 16) for (let i = 0; i < vertices.length; i++) close(vertices[i], firstPose[i], .0001);
    }
    assert.ok(maximumMotion > .005, clip.name + ' must visibly deform geometry');
  }
  for (const name of ['swim', 'sprint', 'scan']) assert.ok(poses.get(name).some((value, i) => Math.abs(value - poses.get('idle')[i]) > .01), name + ' has a distinct pose from idle');
});

test('portrait regression: actual skinned palms fit all authored clips and sway extremes at tested narrow aspects', async t => {
  const { gltf } = await loadRealArms();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, .08, 330);
  const arms = createDiverArms(camera, { loader: { loadAsync: async () => gltf } });
  assert.equal(await arms.ready, true); t.after(() => arms.dispose());
  let mesh; gltf.scene.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
  const palms = [];
  for (const name of ['L_Hand', 'R_Hand']) {
    const joint = mesh.skeleton.bones.findIndex(bone => bone.name === name), selected = [];
    assert.ok(joint >= 0, name);
    for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
      let weight = 0;
      for (let lane = 0; lane < 4; lane++) if (mesh.geometry.attributes.skinIndex.getComponent(vertex, lane) === joint) weight += mesh.geometry.attributes.skinWeight.getComponent(vertex, lane);
      if (weight >= .5) selected.push(vertex);
    }
    assert.ok(selected.length > 200, name + ' has a substantial palm envelope'); palms.push(...selected);
  }
  const placements = [];
  for (const [width, height] of [[390, 844], [320, 844], [9, 16]]) {
    arms.reset(); camera.aspect = width / height; camera.updateProjectionMatrix(); run(arms, 3);
    placements.push({ width, height, offset: arms.snapshot().offset });
    assert.deepEqual(arms.group.scale.toArray(), [1, 1, 1]);
  }
  arms.reset(); arms.group.position.set(0, 0, 0); arms.group.rotation.set(0, 0, 0);
  const rotations = [];
  for (const x of [-.035, 0, .035]) for (const y of [-.04, 0, .04]) rotations.push(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, 0)));
  const vertex = new THREE.Vector3(), transformed = new THREE.Vector3(), tan = Math.tan(70 * Math.PI / 360);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  t.after(() => { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); });
  for (const clip of gltf.animations) {
    mixer.stopAllAction(); mixer.clipAction(clip).reset().play();
    const frames = Math.round(clip.duration * 30), points = new Float32Array((frames + 1) * palms.length * 3); let cursor = 0;
    for (let frame = 0; frame <= frames; frame++) {
      mixer.setTime(clip.duration * frame / frames); camera.updateMatrixWorld(true); mesh.skeleton.update();
      for (const index of palms) { mesh.getVertexPosition(index, vertex); vertex.applyMatrix4(mesh.matrixWorld); vertex.toArray(points, cursor); cursor += 3; }
    }
    for (const { width, height, offset } of placements) {
      let maxX = 0, maxY = 0, closestDepth = Infinity;
      for (let i = 0; i < points.length; i += 3) for (const rotation of rotations) {
        transformed.fromArray(points, i).applyMatrix4(rotation); transformed.y += offset.y; transformed.z += offset.z;
        const depth = -transformed.z; closestDepth = Math.min(closestDepth, depth);
        maxX = Math.max(maxX, Math.abs(transformed.x / (depth * tan * width / height)));
        maxY = Math.max(maxY, Math.abs(transformed.y / (depth * tan)));
      }
      assert.ok(maxX <= .9, `${width}x${height} ${clip.name} palm horizontal crop: ${maxX}`);
      assert.ok(maxY <= .9, `${width}x${height} ${clip.name} palm vertical crop: ${maxY}`);
      assert.ok(closestDepth > camera.near, 'sampled palms stay beyond the near plane');
    }
  }
});

test('portrait regression: landscape is unchanged and additional forward reach retreats at walls/floor', async t => {
  const { arms, camera } = await rig(t);
  const baseOffset = aspect => -Math.max(0, Math.min(.2, (1.15 - aspect) * .26));
  for (const aspect of [16 / 9, 4 / 3, 1.01]) {
    arms.reset(); camera.aspect = aspect; run(arms, 3); close(arms.snapshot().offset.z, baseOffset(aspect), 1e-10);
    assert.deepEqual(arms.group.scale.toArray(), [1, 1, 1]);
  }
  for (const aspect of [390 / 844, 320 / 844]) {
    arms.reset(); camera.aspect = aspect; run(arms, 3); const free = arms.snapshot();
    assert.ok(free.offset.z < -.9, 'tall portrait needs more than the former 0.2m adjustment');
    run(arms, 3, { colliders: [{ x: 0, y: 3, z: -1.65, radius: 1, height: 10 }] });
    const blocked = arms.snapshot(); assert.ok(blocked.clearance < .6);
    close(blocked.offset.z, baseOffset(aspect) + blocked.retraction * .14, 1e-9);
    run(arms, 3, { y: -19.35, pitch: -1.48 }); const floor = arms.snapshot();
    close(floor.offset.z, baseOffset(aspect) + floor.retraction * .14, 1e-9);
    assert.ok(floor.offset.z > free.offset.z, 'extra portrait extension is withdrawn near solids');
  }
});

test('owned material decorator runs once after world-depth settings and its cleanup runs once', async t => {
  let calls = 0, cleanups = 0;
  const { arms, model } = await rig(t, { materialDecorator(material) {
    calls++; assert.equal(material.depthTest, true); assert.equal(material.depthWrite, true); assert.equal(material.transparent, false);
    material.userData.decorated = true;
    return () => { cleanups++; delete material.userData.decorated; };
  } });
  assert.equal(calls, 1); assert.equal(model.material.userData.decorated, true);
  run(arms, 1); arms.reset(); run(arms, 1, { vx: 4 }); assert.equal(calls, 1);
  arms.dispose(); arms.dispose(); assert.equal(cleanups, 1);
  assert.deepEqual(model.disposed, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
});

test('throwing material decorator releases partial GLB state and all previously installed hooks', async () => {
  for (const failAt of [1, 2]) {
    const model = fixture(), second = model.material.clone(), reports = [], camera = new THREE.PerspectiveCamera();
    model.scene.children[1].material = second;
    let calls = 0, cleaned = 0, secondDisposed = 0; second.addEventListener('dispose', () => secondDisposed++);
    const arms = createDiverArms(camera, { loader: { loadAsync: async () => model }, onAsset: result => reports.push(result), materialDecorator() {
      calls++; if (calls === failAt) throw new Error('fixture decorator failed');
      return () => { cleaned++; throw new Error('fixture cleanup also failed'); };
    } });
    assert.equal(await arms.ready, false); assert.equal(calls, failAt); assert.equal(cleaned, failAt - 1);
    assert.equal(arms.snapshot().status, 'error'); assert.equal(arms.group.children.length, 0); assert.equal(arms.group.visible, false);
    assert.equal(arms.snapshot().geometries, 0); assert.equal(arms.snapshot().materials, 0);
    assert.match(reports[0].message, /decorator failed/);
    assert.deepEqual(model.disposed, { geometry: 1, material: 1, texture: 1, skeleton: 1 }); assert.equal(secondDisposed, 1);
    arms.dispose(); arms.dispose(); assert.equal(camera.children.length, 0); assert.equal(cleaned, failAt - 1);
    assert.deepEqual(model.disposed, { geometry: 1, material: 1, texture: 1, skeleton: 1 }); assert.equal(secondDisposed, 1);
  }
});

test('asset notification errors cannot reject a ready rig or interrupt its owned resource cleanup', async t => {
  const { arms, model } = await rig(t, { onAsset() { throw new Error('fixture reporting failed'); } });
  assert.equal(arms.snapshot().status, 'ready'); arms.dispose();
  assert.deepEqual(model.disposed, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
});


test('real arm material loading composes the r170 torch cap and restores it before disposal', async t => {
  const { arms, model } = await rig(t, { materialDecorator: material => limitFlashlightOnMaterial(material) });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  model.material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.uAbyssTorchArmLimit.value, .48);
  assert.match(shader.fragmentShader, /torchIrradiance/);
  assert.equal(model.material.depthTest, true); assert.equal(model.material.depthWrite, true);
  let hookAtDisposal; model.material.addEventListener('dispose', () => { hookAtDisposal = model.material.onBeforeCompile; });
  arms.dispose(); assert.equal(hookAtDisposal, THREE.Material.prototype.onBeforeCompile);
});
