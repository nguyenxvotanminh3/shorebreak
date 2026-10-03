import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createKrakenMotion, sampleKrakenStroke } from '../dist/abyss-kraken-motion.js';

globalThis.ProgressEvent ||= class ProgressEvent extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};
const TAU = Math.PI * 2;
const CRUISE = { phase: .9, time: 0, speed: .45, acceleration: 0, turnRate: 0,
  alert: 0, cruiseWeight: 1, accelerateWeight: 0, turnWeight: 0, reactWeight: 0 };
const STATES = {
  cruise: CRUISE,
  accelerate: { ...CRUISE, speed: 1.6, acceleration: 1.2, cruiseWeight: .15, accelerateWeight: 1 },
  turn: { ...CRUISE, turnRate: .28, cruiseWeight: .55, turnWeight: 1 },
  cautious: { ...CRUISE, speed: .15, alert: 1, reactWeight: 1, cruiseWeight: .25 },
};
const INK_POSES = {
  prepare: { stage: 'anticipation', anticipation: 1, contraction: 0, armGather: 1, extension: 0, escapeStrength: 0 },
  jet: { stage: 'jet', anticipation: 0, contraction: 1, armGather: 0, extension: 1, escapeStrength: .2 },
  trail: { stage: 'escape', anticipation: 0, contraction: 0, armGather: 0, extension: .5, escapeStrength: 1 },
  recover: { stage: 'recovery', anticipation: 0, contraction: 0, armGather: .12, extension: .1, escapeStrength: .2 },
};

// Actual vertex buffers, skin weights, inverse binds and animations. Only browser
// image decoding is omitted. These tests make no rendered-pixel/material claim.
async function load(file) {
  const raw = await readFile(new URL('../dist/assets/abyss/' + file, import.meta.url));
  const jsonLength = raw.readUInt32LE(12), doc = JSON.parse(raw.subarray(20, 20 + jsonLength));
  const offset = 20 + jsonLength, bin = raw.subarray(offset + 8, offset + 8 + raw.readUInt32LE(offset));
  doc.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
  doc.materials = doc.materials.map(m => ({ name: m.name, pbrMetallicRoughness: {
    baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor,
  } }));
  delete doc.images; delete doc.textures; delete doc.samplers;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
  const bones = new Map(), meshes = [];
  gltf.scene.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) meshes.push(node); });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  const regions = { mantle: [], head: [], bases: [], middles: [], tips: [] };
  const weights = new Map();
  for (const mesh of meshes) {
    const skin = mesh.geometry.attributes.skinIndex, influence = mesh.geometry.attributes.skinWeight;
    for (let vertex = 0; vertex < skin.count; vertex++) {
      let strongest = 0, selected = '';
      for (let k = 0; k < 4; k++) {
        const weight = influence.getComponent(vertex, k), name = mesh.skeleton.bones[skin.getComponent(vertex, k)].name;
        weights.set(name, (weights.get(name) || 0) + weight);
        if (weight > strongest) { strongest = weight; selected = name; }
      }
      if (strongest < .65) continue;
      const region = selected === 'mantle' ? 'mantle' : selected === 'head' ? 'head'
        : /arm\d{2}0[12]$/.test(selected) ? 'bases' : /arm\d{2}0[34]$/.test(selected) ? 'middles'
        : /arm\d{2}0[567]$/.test(selected) ? 'tips' : null;
      if (region) regions[region].push({ mesh, vertex });
    }
  }
  for (const name of Object.keys(regions)) {
    const all = regions[name];
    regions[name] = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 80)) === 0);
  }
  const driver = createKrakenMotion(gltf.scene, gltf.animations);
  return { ...gltf, bones, meshes, mixer, driver, regions, weights };
}
function frame(rig, motion = CRUISE, overlay = true, dt = 1 / 60) {
  const clipTime = motion.clipTime ?? motion.phase / TAU * rig.animations[0].duration;
  rig.mixer.setTime(clipTime);
  if (overlay) rig.driver.update(dt, { ...motion, clipTime });
  rig.scene.updateMatrixWorld(true);
  for (const mesh of rig.meshes) mesh.skeleton.update();
}
function points(samples) {
  return samples.map(({ mesh, vertex }) => {
    const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, vertex);
    return mesh.applyBoneTransform(vertex, point);
  });
}
function rms(a, b) { return Math.sqrt(a.reduce((sum, point, i) => sum + point.distanceToSquared(b[i]), 0) / a.length); }
function maxDistance(a, b) { return Math.max(...a.map((point, i) => point.distanceTo(b[i]))); }
function chainRatio(rig, arm) {
  const chain = Array.from({ length: 7 }, (_, j) => rig.bones.get('arm' + String(arm).padStart(2, '0')
    + String(j + 1).padStart(2, '0')).getWorldPosition(new THREE.Vector3()));
  const arc = chain.slice(1).reduce((sum, point, j) => sum + point.distanceTo(chain[j]), 0);
  return chain[0].distanceTo(chain[6]) / arc;
}
function worldPoint({ mesh, vertex }) {
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, vertex);
  return mesh.localToWorld(mesh.applyBoneTransform(vertex, point));
}
function pose(rig) {
  return [...rig.bones.values()].flatMap(bone => [...bone.position, ...bone.quaternion, ...bone.scale]);
}
function closeArrays(a, b, epsilon = 1e-8) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= epsilon, `index ${i}: ${a[i]} vs ${b[i]}`);
}
function cleanup(rig) {
  rig.driver.dispose(); rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.scene);
  const geometries = new Set(), materials = new Set(), skeletons = new Set();
  for (const mesh of rig.meshes) { geometries.add(mesh.geometry); materials.add(mesh.material); skeletons.add(mesh.skeleton); }
  for (const resource of [...geometries, ...materials, ...skeletons]) resource.dispose();
}

for (const file of ['kraken.glb', 'kraken-lod.glb']) {
  test(`${file}: actual rig and authored motion expose the static-body limitation`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    assert.equal(rig.bones.size, 59); assert.equal(rig.animations.length, 1);
    assert.equal(rig.animations[0].tracks.length, 177);
    assert.ok(Math.abs(rig.animations[0].duration - 6.0333333) < 1e-6);
    for (const name of ['head', 'mantle', 'arm0101', 'arm0107', 'arm0801', 'arm0807']) assert.ok(rig.weights.get(name) > 10);
    assert.equal([...rig.bones.keys()].filter(name => /fin/i.test(name)).length, 0);
    assert.equal(rig.driver.snapshot().joints, 58); assert.equal(rig.driver.snapshot().independentFins, 0);
    for (const region of Object.values(rig.regions)) assert.ok(region.length >= 20);
    const mantleRotation = rig.animations[0].tracks.find(track => track.name === 'mantle.quaternion');
    closeArrays(Array.from(mantleRotation.values.slice(0, 4)), Array.from(mantleRotation.values.slice(-4)));
    const headYaw = rig.animations[0].tracks.find(track => track.name === 'head.quaternion');
    const peakHeadAngle = Math.max(...Array.from(headYaw.values).filter((_, i) => i % 4 === 1).map(y => Math.abs(2 * Math.asin(y))));
    assert.ok(peakHeadAngle > .011 && peakHeadAngle < .013);
    const armTrack = rig.animations[0].tracks.find(track => track.name === 'arm0104.quaternion');
    const start = new THREE.Quaternion().fromArray(armTrack.values), sample = new THREE.Quaternion();
    let armAngle = 0;
    for (let i = 0; i < armTrack.values.length; i += 4) armAngle = Math.max(armAngle, start.angleTo(sample.fromArray(armTrack.values, i)));
    assert.ok(armAngle < .07, `authored arm rotation from initial sample ${armAngle}`);
    frame(rig, { ...CRUISE, phase: 0 }, false); const authored = points(rig.regions.tips);
    frame(rig, { ...CRUISE, phase: Math.PI }, false); const authoredSpan = rms(authored, points(rig.regions.tips));
    frame(rig, { ...CRUISE, phase: 0 }); const articulated = points(rig.regions.tips);
    frame(rig, { ...CRUISE, phase: Math.PI }); const articulatedSpan = rms(articulated, points(rig.regions.tips));
    assert.ok(articulatedSpan > authoredSpan * 1.5, `${articulatedSpan} <= 1.5 × authored ${authoredSpan}`);
    t.diagnostic(`authored half-cycle tip RMS ${authoredSpan.toFixed(4)}, articulated ${articulatedSpan.toFixed(4)} model units`);
  });

  test(`${file}: jet/recovery changes real mantle skin and delayed articulated arms`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const rootPose = rig.bones.get('root').matrix.clone(), modelScale = rig.scene.scale.clone();
    frame(rig, { ...STATES.accelerate, phase: Math.PI / 2 });
    const contracted = points(rig.regions.mantle), tipJet = points(rig.regions.tips), headJet = points(rig.regions.head);
    const contractedX = Math.max(...contracted.map(p => p.x)) - Math.min(...contracted.map(p => p.x));
    frame(rig, { ...STATES.accelerate, phase: Math.PI * 1.5 });
    const recovered = points(rig.regions.mantle);
    const recoveredX = Math.max(...recovered.map(p => p.x)) - Math.min(...recovered.map(p => p.x));
    assert.ok(contractedX < recoveredX * .95, `mantle width ${contractedX} -> ${recoveredX}`);
    assert.ok(rms(contracted, recovered) > .12);
    assert.ok(rms(tipJet, points(rig.regions.tips)) > .25);
    // The eye/head region is moved/rotated as a joint, not squeezed with mantle.
    const headRecovery = points(rig.regions.head);
    const headDistanceChange = Math.abs(headJet[0].distanceTo(headJet[headJet.length - 1]) - headRecovery[0].distanceTo(headRecovery[headRecovery.length - 1]));
    assert.ok(headDistanceChange < .015, `head pair distance changed ${headDistanceChange}`);
    closeArrays(rig.scene.scale.toArray(), modelScale.toArray());
    closeArrays(rig.bones.get('root').matrix.elements, rootPose.elements);
    // Probe overlay quaternions relative to the exact author sample at fixed clipTime.
    const curls = [[], [], []];
    for (let step = 0; step < 32; step++) {
      frame(rig, { ...STATES.accelerate, phase: step / 32 * TAU, clipTime: 0 });
      for (const [j, name] of ['arm0101', 'arm0104', 'arm0107'].entries()) curls[j].push(rig.bones.get(name).quaternion.clone());
    }
    const peaks = curls.map(samples => samples.reduce((best, q, i) => q.angleTo(samples[0]) > samples[best].angleTo(samples[0]) ? i : best, 0));
    assert.ok(new Set(peaks).size >= 2, `base/middle/tip share identical peak: ${peaks}`);
  });

  test(`${file}: cruise, accelerating, turning and cautious poses deform different skin regions`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    frame(rig, CRUISE);
    const baseline = Object.fromEntries(Object.entries(rig.regions).map(([key, list]) => [key, points(list)]));
    for (const [name, state] of Object.entries(STATES).slice(1)) {
      frame(rig, state);
      assert.ok(rms(baseline.tips, points(rig.regions.tips)) > .07, `${name} does not change tentacles`);
      assert.ok(rms(baseline.middles, points(rig.regions.middles)) > .04, `${name} only moves tips`);
    }
    frame(rig, { ...STATES.turn, turnRate: .28 }); const right = points(rig.regions.tips);
    const rightBones = ['arm0301', 'arm0701'].map(name => rig.bones.get(name).quaternion.clone());
    frame(rig, { ...STATES.turn, turnRate: -.28 }); const left = points(rig.regions.tips);
    assert.ok(rms(right, left) > .25);
    assert.ok(rightBones.every((q, i) => q.angleTo(rig.bones.get(['arm0301', 'arm0701'][i]).quaternion) > .07));
  });

  test(`${file}: paused re-samples, repeated updates and elapsed dt never accumulate or advance pose`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const state = { ...STATES.cautious, phase: 2.35, clipTime: .725 };
    frame(rig, state); const fixed = pose(rig);
    for (let i = 0; i < 150; i++) { frame(rig, { ...state, time: i * 90 }, true, 0); closeArrays(pose(rig), fixed); }
    for (let i = 0; i < 150; i++) { rig.driver.update(i % 2 ? 1 / 144 : 10, state); closeArrays(pose(rig), fixed); }
    frame(rig, { ...STATES.accelerate, phase: 1.9, clipTime: 4.2 });
    frame(rig, state); closeArrays(pose(rig), fixed);
  });

  test(`${file}: cyclic overlays are continuous, finite, bounded and keep resources stable`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const geometry = rig.meshes.map(m => m.geometry), material = rig.meshes.map(m => m.material);
    const skeletons = rig.meshes.map(m => m.skeleton), matrices = skeletons.map(s => s.boneMatrices);
    const sceneChildren = []; rig.scene.traverse(node => sceneChildren.push(node));
    frame(rig, { ...STATES.turn, phase: 0, clipTime: 0 }); const seam = points(rig.regions.tips);
    frame(rig, { ...STATES.turn, phase: TAU, clipTime: 0 });
    assert.ok(maxDistance(seam, points(rig.regions.tips)) < 1e-8);
    frame(rig, { ...STATES.turn, phase: TAU - 1e-6, clipTime: 0 }); const before = points(rig.regions.tips);
    frame(rig, { ...STATES.turn, phase: 1e-6, clipTime: 0 });
    assert.ok(maxDistance(before, points(rig.regions.tips)) < 2e-5);
    // The real authored loop and overlay also cross their shared seam together.
    frame(rig, { ...STATES.accelerate, phase: TAU - 1e-6 }); const fullBefore = points(rig.regions.tips);
    frame(rig, { ...STATES.accelerate, phase: 1e-6 });
    assert.ok(maxDistance(fullBefore, points(rig.regions.tips)) < 3e-5);
    for (let i = 0; i < 360; i++) {
      frame(rig, { ...Object.values(STATES)[i % 4], phase: i * .131, speed: i % 7 ? .8 : 100,
        acceleration: i % 2 ? -100 : 100, turnRate: i % 3 ? -.4 : 20 });
      for (const mesh of rig.meshes) assert.ok(mesh.skeleton.boneMatrices.every(value => Number.isFinite(value) && Math.abs(value) < 30));
      for (const bone of rig.bones.values()) {
        assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-5);
        if (bone.name.startsWith('arm')) assert.ok(bone.scale.toArray().every(v => Math.abs(v - 1) < 1e-5));
      }
      assert.ok(points(rig.regions.tips).every(p => p.toArray().every(v => Number.isFinite(v) && Math.abs(v) < 15)));
      assert.ok(rig.bones.get('mantle').scale.toArray().every(v => v > .8 && v < 1.12));
    }
    frame(rig, { phase: NaN, clipTime: Infinity, speed: Infinity, alert: NaN, acceleration: NaN, turnRate: NaN });
    assert.ok(pose(rig).every(Number.isFinite));
    rig.meshes.forEach((mesh, i) => { assert.equal(mesh.geometry, geometry[i]); assert.equal(mesh.material, material[i]); assert.equal(mesh.skeleton, skeletons[i]); assert.equal(mesh.skeleton.boneMatrices, matrices[i]); });
    const after = []; rig.scene.traverse(node => after.push(node)); assert.deepEqual(after, sceneChildren);
  });
}

test('full and LOD use identical bone poses on mid-motion arrival and arbitrary shared clock samples', async t => {
  const full = await load('kraken.glb'), low = await load('kraken-lod.glb');
  t.after(() => { cleanup(full); cleanup(low); });
  for (let i = 0; i < 45; i++) frame(low, { ...STATES.accelerate, phase: i * .09 });
  for (const state of Object.values(STATES)) for (const phase of [0, .3, 1.7, 3.8, TAU - .01, 1024.75]) {
    const motion = { ...state, phase, clipTime: phase * .872 };
    frame(full, motion, true, 0); frame(low, motion, true, 1 / 30);
    closeArrays(pose(full), pose(low), 1e-8);
  }
});

test('dispose is idempotent, restores authored pose and does not dispose caller-owned resources', async () => {
  const rig = await load('kraken-lod.glb'); let releases = 0;
  for (const mesh of rig.meshes) {
    mesh.geometry.addEventListener('dispose', () => releases++);
    mesh.material.addEventListener('dispose', () => releases++);
  }
  const fixedTime = .625;
  frame(rig, { ...STATES.cautious, phase: 2.4, clipTime: fixedTime });
  rig.driver.dispose(); const restored = pose(rig);
  rig.driver.dispose(); rig.driver.update(.1, STATES.accelerate);
  closeArrays(pose(rig), restored); assert.equal(releases, 0); assert.equal(rig.driver.snapshot().disposed, true);
  const reference = await load('kraken-lod.glb');
  frame(reference, { ...CRUISE, phase: 0, clipTime: fixedTime }, false);
  closeArrays(restored, pose(reference), 1e-7);
  cleanup(rig); cleanup(reference);
});


test('localized unrolling and slower recurling fronts progress from base to tip with a quiet glide',()=>{
 const crossings=[0,.5,1].map(segment=>{for(let i=0;i<=200;i++){if(sampleKrakenStroke(i/200*TAU,segment).extension>.5)return i/200;}return 1;});
 assert.ok(crossings[0]<crossings[1]&&crossings[1]<crossings[2]);
 assert.equal(sampleKrakenStroke(.95*TAU,.5).stage,'curled glide');
 for(const t of [0,.5,1])closeArrays(Object.values(sampleKrakenStroke(0,t)).filter(Number.isFinite),Object.values(sampleKrakenStroke(TAU,t)).filter(Number.isFinite));
});
for(const file of ['kraken.glb','kraken-lod.glb'])test(`${file}: all actual arm chains unfold and recurl rather than retaining one posed silhouette`,async t=>{
 const rig=await load(file);t.after(()=>cleanup(rig));const ranges=Array.from({length:8},()=>({min:1,max:0}));
 for(let i=0;i<100;i++){
  frame(rig,{...CRUISE,phase:i/100*TAU});
  for(let arm=1;arm<=8;arm++){
   const p=Array.from({length:7},(_,j)=>rig.bones.get('arm'+String(arm).padStart(2,'0')+String(j+1).padStart(2,'0')).getWorldPosition(new THREE.Vector3()));
   const arc=p.slice(1).reduce((sum,v,j)=>sum+v.distanceTo(p[j]),0),ratio=p[0].distanceTo(p[6])/arc;
   ranges[arm-1].min=Math.min(ranges[arm-1].min,ratio);ranges[arm-1].max=Math.max(ranges[arm-1].max,ratio);
  }
 }
 for(const [i,r] of ranges.entries()){assert.ok(r.max>.82,`arm${i+1} fails to extend: ${r.max}`);assert.ok(r.min<.62,`arm${i+1} fails to curl: ${r.min}`);assert.ok(r.max-r.min>.28);}
});

for (const file of ['kraken.glb', 'kraken-lod.glb']) {
  test(`${file}: defensive preparation inflates real mantle skin, discharge squeezes and recoils without scaling the head`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const motion = { ...CRUISE, phase: .3, clipTime: .425 };
    frame(rig, motion);
    const ordinary = pose(rig), neutral = points(rig.regions.mantle), scale = rig.scene.scale.toArray();
    const width = samples => Math.max(...samples.map(p => p.x)) - Math.min(...samples.map(p => p.x));
    const headNeutral = points(rig.regions.head);
    frame(rig, { ...motion, inkDefense: INK_POSES.prepare });
    const inflated = points(rig.regions.mantle);
    frame(rig, { ...motion, inkDefense: INK_POSES.jet });
    const squeezed = points(rig.regions.mantle), headJet = points(rig.regions.head);
    assert.ok(width(inflated) > width(neutral) * 1.065);
    assert.ok(width(squeezed) < width(neutral) * .835);
    assert.ok(rms(inflated, squeezed) > .35, 'weighted mantle surface did not squeeze');
    assert.ok(rms(headNeutral, headJet) > .10, 'head did not recoil');
    assert.ok(Math.abs(headNeutral[0].distanceTo(headNeutral.at(-1)) - headJet[0].distanceTo(headJet.at(-1))) < 1e-6);
    closeArrays(rig.scene.scale.toArray(), scale, 0);
    frame(rig, motion); closeArrays(pose(rig), ordinary, 0);
    frame(rig, { ...motion, inkDefense: { stage: 'idle', anticipation: 0, contraction: 0,
      armGather: 0, extension: 0, escapeStrength: 0 } });
    closeArrays(pose(rig), ordinary, 0);
    frame(rig, { ...motion, inkDefense: { anticipation: NaN, contraction: Infinity, armGather: -2, extension: NaN } });
    closeArrays(pose(rig), ordinary, 0);
  });

  test(`${file}: defensive gather curls all eight chains, jet unrolls regionally and recovery leaves tips trailing`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const motion = { ...CRUISE, phase: .91, clipTime: .2 };
    frame(rig, { ...motion, inkDefense: INK_POSES.prepare });
    const gathered = Array.from({ length: 8 }, (_, i) => chainRatio(rig, i + 1));
    const gatheredSkin = points(rig.regions.tips);
    frame(rig, { ...motion, inkDefense: INK_POSES.jet });
    const extended = Array.from({ length: 8 }, (_, i) => chainRatio(rig, i + 1));
    for (let i = 0; i < 8; i++) {
      assert.ok(extended[i] > .87, `arm ${i + 1} jet extension ${extended[i]}`);
      assert.ok(gathered[i] < .53, `arm ${i + 1} anticipation curl ${gathered[i]}`);
      assert.ok(extended[i] - gathered[i] > .35);
    }
    assert.ok(rms(gatheredSkin, points(rig.regions.tips)) > 2);
    const joints = ['arm0101', 'arm0104', 'arm0107'];
    for (const recovering of [false, true]) {
      const defense = { contraction: recovering ? 0 : 1, escapeStrength: recovering ? 1 : 0 };
      frame(rig, { ...motion, inkDefense: { ...defense, extension: 0 } });
      const curled = joints.map(name => rig.bones.get(name).quaternion.clone());
      frame(rig, { ...motion, inkDefense: { ...defense, extension: 1 } });
      const spans = joints.map((name, i) => curled[i].angleTo(rig.bones.get(name).quaternion));
      const crossings = [-1, -1, -1];
      for (let step = 0; step <= 100; step++) {
        const extension = recovering ? 1 - step / 100 : step / 100;
        frame(rig, { ...motion, inkDefense: { ...defense, extension } });
        joints.forEach((name, i) => {
          const fraction = curled[i].angleTo(rig.bones.get(name).quaternion) / spans[i];
          if (crossings[i] < 0 && (recovering ? fraction < .5 : fraction > .5)) crossings[i] = step;
        });
      }
      assert.ok(crossings[0] < crossings[1] && crossings[1] < crossings[2],
        `${recovering ? 'recovery' : 'extension'} failed base→tip ordering: ${crossings}`);
    }
    t.diagnostic(`gathered chain ratios ${gathered.map(n => n.toFixed(3))}; jet ${extended.map(n => n.toFixed(3))}`);
  });

  test(`${file}: large defensive curls are continuous, bounded, replayable and retain real skin resources`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const motion = { ...STATES.turn, phase: 1.25, clipTime: .625 };
    const zero = { anticipation: 0, contraction: 0, armGather: 0, extension: 0, escapeStrength: 0 };
    const keys = Object.keys(zero), route = [zero, INK_POSES.prepare, INK_POSES.jet, INK_POSES.trail, INK_POSES.recover, zero];
    const lengths = [...rig.bones.values()].filter(b => b.name.startsWith('arm')).map(b => b.position.toArray());
    const children = []; rig.scene.traverse(node => children.push(node));
    const resources = rig.meshes.map(mesh => [mesh.geometry, mesh.material, mesh.skeleton, mesh.skeleton.boneMatrices]);
    frame(rig, motion); const initial = pose(rig);
    let previous = points(rig.regions.tips), previousCoarse = previous, largestStep = 0, largestCoarseStep = 0;
    for (let leg = 1; leg < route.length; leg++) for (let step = 0; step <= 160; step++) {
      const x = step / 160, eased = x * x * (3 - 2 * x);
      const inkDefense = Object.fromEntries(keys.map(key => [key, (route[leg - 1][key] || 0)
        + ((route[leg][key] || 0) - (route[leg - 1][key] || 0)) * eased]));
      frame(rig, { ...motion, inkDefense }, true, step % 2 ? 0 : 1 / 30);
      const current = points(rig.regions.tips); largestStep = Math.max(largestStep, maxDistance(previous, current));
      if (step % 2 === 0) {
        largestCoarseStep = Math.max(largestCoarseStep, maxDistance(previousCoarse, current)); previousCoarse = current;
      }
      assert.ok(current.every(p => p.toArray().every(n => Number.isFinite(n) && Math.abs(n) < 15)));
      for (const mesh of rig.meshes) assert.ok(mesh.skeleton.boneMatrices.every(Number.isFinite));
      for (const bone of rig.bones.values()) assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-5);
      previous = current;
    }
    assert.ok(largestStep < .13, `unbounded large-curl skin step ${largestStep}`);
    assert.ok(largestStep < largestCoarseStep * .51, 'halving the input step did not halve maximum skin displacement');
    closeArrays(pose(rig), initial, 0);
    const fixedMotion = { ...motion, inkDefense: INK_POSES.trail };
    frame(rig, fixedMotion); const fixed = pose(rig);
    for (let i = 0; i < 120; i++) {
      if (i % 2) frame(rig, fixedMotion, true, 0);
      else rig.driver.update(i % 3 ? 1 / 144 : 15, fixedMotion);
      closeArrays(pose(rig), fixed, 0);
    }
    frame(rig, { ...fixedMotion, inkDefense: { ...INK_POSES.trail, stage: 'jet' } });
    closeArrays(pose(rig), fixed, 0); // Stage labels cannot introduce a pose jump.
    [...rig.bones.values()].filter(b => b.name.startsWith('arm')).forEach((bone, i) => {
      closeArrays(bone.position.toArray(), lengths[i], 1e-6);
      closeArrays(bone.scale.toArray(), [1, 1, 1], 1e-6);
    });
    const after = []; rig.scene.traverse(node => after.push(node)); assert.deepEqual(after, children);
    rig.meshes.forEach((mesh, i) => assert.deepEqual([mesh.geometry, mesh.material, mesh.skeleton, mesh.skeleton.boneMatrices], resources[i]));
    t.diagnostic(`largest adjacent posed tip displacement ${largestStep.toFixed(5)} model units`);
  });

  test(`${file}: emission follows the actual head-weighted siphon aperture through skinning and world transforms`, async t => {
    const rig = await load(file); t.after(() => cleanup(rig));
    const center = new THREE.Vector3(0, 1.915, -1.265), axis = new THREE.Vector3(0, -Math.SQRT1_2, -Math.SQRT1_2);
    const aperture = [];
    for (const mesh of rig.meshes) {
      if (!mesh.material.name.includes('Suction epithelium')) continue;
      const attributes = mesh.geometry.attributes;
      for (let vertex = 0; vertex < attributes.position.count; vertex++) {
        const rest = new THREE.Vector3().fromBufferAttribute(attributes.position, vertex);
        if (rest.distanceTo(center) > .102 || Math.abs(rest.clone().sub(center).dot(axis)) > .013) continue;
        assert.equal(mesh.skeleton.bones[attributes.skinIndex.getX(vertex)].name, 'head');
        assert.equal(attributes.skinWeight.getX(vertex), 1);
        aperture.push({ mesh, vertex, rest });
      }
    }
    assert.ok(aperture.length >= 10, `too few actual aperture samples: ${aperture.length}`);
    const closest = Math.min(...aperture.map(p => p.rest.distanceTo(center)));
    assert.ok(closest < .035, `anchor misses actual aperture ${closest}`);
    const out = new THREE.Vector3(), direction = new THREE.Vector3();
    // Check the independent skin equation, including inverse bind, instead of
    // merely comparing the getter with the head transform it implements.
    for (const inkDefense of [undefined, ...Object.values(INK_POSES)]) {
      for (const transform of [false, true]) {
        rig.scene.position.set(transform ? 31 : 0, transform ? -18 : 0, transform ? 67 : 0);
        rig.scene.rotation.set(transform ? .28 : 0, transform ? -1.27 : 0, transform ? -.13 : 0);
        rig.scene.scale.setScalar(transform ? 1.6 : 1);
        frame(rig, { ...STATES.turn, phase: 2.35, clipTime: .725, inkDefense });
        assert.equal(rig.driver.getSiphonWorldPosition(out), out);
        assert.equal(rig.driver.getSiphonWorldDirection(direction), direction);
        assert.ok(Math.abs(direction.length() - 1) < 1e-12);
        for (const sample of aperture) {
          const offset = worldPoint(sample).sub(out), scale = transform ? 1.6 : 1;
          assert.ok(Math.abs(offset.length() - sample.rest.distanceTo(center) * scale) < 3e-7);
          assert.ok(Math.abs(offset.dot(direction) - sample.rest.clone().sub(center).dot(axis) * scale) < 3e-7);
        }
        assert.ok(out.distanceTo(rig.bones.get('head').getWorldPosition(new THREE.Vector3())) > 1.2 * (transform ? 1.6 : 1));
      }
    }
    // Getters refresh changed ancestors even before the renderer updates them.
    const before = out.clone(); rig.scene.position.x += 8;
    rig.driver.getSiphonWorldPosition(out);
    assert.ok(Math.abs(out.x - before.x - 8) < 1e-10);
    rig.driver.dispose();
    assert.equal(rig.driver.getSiphonWorldPosition(out), null);
    assert.equal(rig.driver.getSiphonWorldDirection(direction), null);
    t.diagnostic(`${aperture.length} real aperture vertices; nearest ${closest.toFixed(5)} model units from nozzle center`);
  });
}

test('defensive poses and anatomically bound emission are identical across actual full/low LODs', async t => {
  const full = await load('kraken.glb'), low = await load('kraken-lod.glb');
  t.after(() => { cleanup(full); cleanup(low); });
  const fullPosition = new THREE.Vector3(), lowPosition = new THREE.Vector3();
  const fullDirection = new THREE.Vector3(), lowDirection = new THREE.Vector3();
  for (const inkDefense of Object.values(INK_POSES)) for (const phase of [0, .4, 1.5, 2.75, 4.9, TAU - .001]) {
    const motion = { ...STATES.accelerate, phase, clipTime: phase * .812, inkDefense };
    frame(full, motion, true, 0); frame(low, motion, true, 1 / 30);
    closeArrays(pose(full), pose(low), 0);
    full.driver.getSiphonWorldPosition(fullPosition); low.driver.getSiphonWorldPosition(lowPosition);
    full.driver.getSiphonWorldDirection(fullDirection); low.driver.getSiphonWorldDirection(lowDirection);
    closeArrays(fullPosition.toArray(), lowPosition.toArray(), 0);
    closeArrays(fullDirection.toArray(), lowDirection.toArray(), 0);
  }
});

test('siphon queries safely decline rigs without an actual head skin attachment', () => {
  const driver = createKrakenMotion(new THREE.Group());
  const out = new THREE.Vector3(1, 2, 3);
  assert.equal(driver.getSiphonWorldPosition(out), null);
  assert.equal(driver.getSiphonWorldDirection(out), null);
  closeArrays(out.toArray(), [1, 2, 3], 0);
  driver.dispose();
});
