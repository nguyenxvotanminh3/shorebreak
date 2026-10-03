// Numerical tests use real Three meshes and CPU-deformed buffers. They do not
// create a renderer, compile a GPU shader or make any rendered-quality claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createJellyfishColony, sampleJellyPulse } from '../dist/abyss-jellyfish.js';
import { terrainHeight } from '../dist/abyss-world.js';

const STEP = 1 / 60;
const FAR = { x: 1000, y: 1000, z: 1000 };
const ALL = { x: 0, y: -30, z: -99 };
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}, tolerance ${eps}`);
const finite = values => { for (const value of values) assert.ok(Number.isFinite(value), `Nonfinite ${value}`); };
function rig(t, terrain = () => -45) {
  const scene = new THREE.Scene(), colony = createJellyfishColony(scene, { terrain });
  t.after(() => colony.dispose());
  return { scene, colony, first: colony.root.children[0], player: { x: -10, y: -35, z: -20 } };
}
function advance(colony, seconds, player = ALL, tier = 'high', hz = 60, start = colony.snapshot().time) {
  for (let frame = 1; frame <= Math.round(seconds * hz); frame++) colony.update(1 / hz, start + frame / hz, player, tier);
}
function inventory(root) {
  const nodes = [], geometries = new Set(), materials = new Set(), attributes = new Map();
  root.traverse(node => {
    nodes.push(node);
    if (node.geometry) {
      geometries.add(node.geometry);
      attributes.set(node.geometry, [node.geometry.index, node.geometry.index.array,
        ...Object.values(node.geometry.attributes).flatMap(attr => [attr, attr.array])]);
    }
    if (node.material) materials.add(node.material);
  });
  return { nodes, geometries, materials, attributes };
}
function radius(positions, ring) {
  const offset = ring * 33 * 3;
  return Math.hypot(positions[offset], positions[offset + 2]);
}
function maxDifference(a, b) {
  let maximum = 0;
  for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
  return maximum;
}

test('pulse has a fast smooth contraction, a squeeze and a slower continuous recovery', () => {
  const out = {}, start = sampleJellyPulse(0), squeezed = sampleJellyPulse(.28), refill = sampleJellyPulse(.7);
  close(start.contraction, 0); close(squeezed.contraction, 1);
  assert.equal(start.stage, 'contract'); assert.equal(squeezed.stage, 'squeeze'); assert.equal(refill.stage, 'recover');
  close(sampleJellyPulse(.12).thrust, 1);
  for (const phase of [.24, .3, .34, .7, .999]) close(sampleJellyPulse(phase).thrust, 0);
  for (const phase of [-3.1, -.1, 0, .12, .24, .34, .999, 1, 12.23]) {
    assert.equal(sampleJellyPulse(phase, out), out, 'caller-owned pulse record is reused');
    close(out.contraction, sampleJellyPulse(phase + 4).contraction);
    assert.ok(out.phase >= 0 && out.phase < 1); assert.ok(out.contraction >= 0 && out.contraction <= 1);
    assert.ok(out.thrust >= 0 && out.thrust <= 1);
  }
  for (const boundary of [0, .24, .34, .82, 1]) {
    close(sampleJellyPulse(boundary - 1e-6).contraction, sampleJellyPulse(boundary + 1e-6).contraction, 1e-8);
  }
  assert.ok(sampleJellyPulse(.12).contraction > sampleJellyPulse(.88).contraction, 'refilling takes substantially longer than squeezing');
});

test('four original finite habitats use real deforming meshes, two shared single-pass materials and bounded geometry', t => {
  const { scene, colony } = rig(t, terrainHeight), resources = inventory(colony.root);
  assert.equal(scene.children.length, 1); assert.equal(colony.root.children.length, 4);
  assert.equal(resources.geometries.size, 8); assert.equal(resources.materials.size, 2);
  assert.equal(resources.nodes.filter(node => node.isMesh).length, 8);
  assert.deepEqual(colony.stats, createAndDisposeStats());
  assert.ok(Object.isFrozen(colony.stats));
  assert.equal(colony.stats.vertices, 6876); assert.equal(colony.stats.maxTriangles, 12672);
  assert.equal(colony.stats.maxDrawCalls, 8); assert.equal(colony.stats.maxSegments, 1024);
  assert.equal(colony.stats.maxMotionSteps, 15);
  for (const geometry of resources.geometries) {
    for (const attr of Object.values(geometry.attributes)) finite(attr.array);
    for (const index of geometry.index.array) assert.ok(index >= 0 && index < geometry.attributes.position.count);
    assert.ok(geometry.boundingSphere.radius > 0 && geometry.boundingSphere.radius < 4);
    const point = new THREE.Vector3();
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      point.fromBufferAttribute(geometry.attributes.position, i);
      assert.ok(geometry.boundingSphere.containsPoint(point)); assert.ok(geometry.boundingBox.containsPoint(point));
    }
  }
  for (const material of resources.materials) {
    assert.equal(material.transparent, true); assert.equal(material.forceSinglePass, true);
    assert.equal(material.depthTest, true); assert.equal(material.depthWrite, false); assert.equal(material.fog, true);
    assert.equal(material.side, THREE.DoubleSide); assert.equal(material.vertexColors, true);
    assert.match(material.fragmentShader, /fog_fragment/); assert.match(material.fragmentShader, /tonemapping_fragment/);
    assert.ok(!Object.values(material.uniforms).some(uniform => uniform.value?.isTexture));
  }
  const states = colony.snapshot().creatures;
  for (const creature of states) {
    assert.ok(creature.position[1] > terrainHeight(creature.position[0], creature.position[2]) + creature.size * 3.9);
    assert.ok(creature.position[1] < -3);
  }
  assert.ok(states[0].position[1] > -25); assert.ok(states[3].position[1] < -40);
  assert.equal(new Set(states.map(creature => creature.phase)).size, 4);
  assert.equal(new Set(states.map(creature => creature.rate)).size, 4);
  assert.equal(new Set(states.map(creature => creature.size)).size, 4);
});
function createAndDisposeStats() {
  const colony = createJellyfishColony(new THREE.Scene()), stats = colony.stats;
  colony.dispose(); return stats;
}

test('bell shape contracts nonuniformly with a curling scalloped rim and refreshed unit normals', t => {
  const { colony, first, player } = rig(t);
  const bell = first.children[0], p = bell.geometry.attributes.position, n = bell.geometry.attributes.normal;
  const before = p.array.slice(), normals = n.array.slice(), scale = bell.scale.toArray();
  advance(colony, .8, player);
  assert.ok(colony.snapshot().creatures[0].contraction > .99);
  assert.ok(maxDifference(before, p.array) > .24, 'visible vertex deformation, not rigid mesh transport');
  assert.ok(maxDifference(normals, n.array) > .1, 'lighting normals follow the actual moving shell');
  assert.deepEqual(bell.scale.toArray(), scale, 'bell pulse is not an object scale animation');
  const upperRatio = radius(p.array, 3) / radius(before, 3), rimRatio = radius(p.array, 14) / radius(before, 14);
  assert.ok(upperRatio - rimRatio > .17, 'lower wall squeezes much more than the upper crown');
  assert.ok(p.getY(14 * 33) - before[14 * 33 * 3 + 1] > .1, 'bell skirt curls up on contraction');
  const radialSamples = [];
  for (let i = 0; i < 32; i++) radialSamples.push(Math.hypot(p.getX(14 * 33 + i), p.getZ(14 * 33 + i)));
  assert.ok(Math.max(...radialSamples) - Math.min(...radialSamples) > .04, 'scalloped asymmetry survives contraction');
  for (let i = 0; i < n.count; i++) close(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1, 1e-6);
  for (let ring = 0; ring <= 14; ring++) for (let axis = 0; axis < 3; axis++) {
    close(p.array[(ring * 33) * 3 + axis], p.array[(ring * 33 + 32) * 3 + axis], 1e-6);
    close(n.array[(ring * 33) * 3 + axis], n.array[(ring * 33 + 32) * 3 + axis], 1e-6);
  }
  for (let i = 0; i < 32; i++) assert.ok(n.getY(4 * 33 + i) > .1, 'canopy normals face outwards');
});

test('all 64 chains preserve their segment lengths while tips, bending planes and oral frills articulate independently', t => {
  const { colony, first, player } = rig(t);
  advance(colony, .25, player);
  const before = colony.snapshot(true).creatures[0].chains;
  const trailGeometry = first.children[1].geometry, oldVertices = trailGeometry.attributes.position.array.slice();
  advance(colony, 1, player);
  const snapshot = colony.snapshot(true), current = snapshot.creatures[0].chains;
  assert.ok(maxDifference(oldVertices, trailGeometry.attributes.position.array) > .08);
  let nonRigid = 0;
  for (const creature of snapshot.creatures) for (const chain of creature.chains) {
    assert.equal(chain.points.length, 51); finite(chain.points);
    for (let j = 1; j <= 16; j++) {
      const at = j * 3, prior = at - 3;
      close(Math.hypot(chain.points[at] - chain.points[prior], chain.points[at + 1] - chain.points[prior + 1], chain.points[at + 2] - chain.points[prior + 2]), chain.length / 16, 2e-6);
      assert.ok(chain.points[at + 1] < chain.points[prior + 1], 'gravity/drag keeps trailing tissue below its parent');
      if (j >= 2) {
        const older = prior - 3;
        const dot = (chain.points[at] - chain.points[prior]) * (chain.points[prior] - chain.points[older])
          + (chain.points[at + 1] - chain.points[prior + 1]) * (chain.points[prior + 1] - chain.points[older + 1])
          + (chain.points[at + 2] - chain.points[prior + 2]) * (chain.points[prior + 2] - chain.points[older + 2]);
        assert.ok(dot / (chain.length / 16) ** 2 > .93, 'no sharp hinges or disconnected tissue');
      }
    }
  }
  const tipDeltas = [];
  for (let i = 0; i < current.length; i++) {
    const a = before[i].points, b = current[i].points;
    const rootDelta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const endDelta = [b[48] - a[48], b[49] - a[49], b[50] - a[50]];
    if (Math.hypot(...endDelta.map((value, axis) => value - rootDelta[axis])) > .04) nonRigid++;
    tipDeltas.push(endDelta.map(value => value.toFixed(3)).join(','));
  }
  assert.ok(nonRigid >= 14, 'nearly every tip changes relative to its attachment');
  assert.equal(new Set(tipDeltas).size, 16, 'arms and filaments do not share one copied wave');
  const bell = first.children[0].geometry.attributes.position;
  // First marginal chain attaches at the true moving skirt vertex at theta 0.
  for (let axis = 0; axis < 3; axis++) close(current[4].points[axis], bell.array[14 * 33 * 3 + axis], 1e-6);
  assert.equal(current.filter(chain => chain.oral).length, 4);
});

test('a contraction disturbance reaches distal segments after the bell and cannot be a rigid chain rotation', t => {
  const { colony, player } = rig(t);
  player.x -= 16; // Isolate pulse transport from the separate proximity reflex.
  const samples = [];
  for (let frame = 1; frame <= 220; frame++) {
    colony.update(STEP, frame * STEP, player, 'high');
    if (frame % 2) continue;
    const creature = colony.snapshot(true).creatures[0], points = creature.chains[4].points;
    const angle = segment => {
      const at = segment * 3, prior = at - 3;
      return Math.atan2(points[at] - points[prior], -(points[at + 1] - points[prior + 1]));
    };
    samples.push({ contraction: creature.contraction, proximal: angle(1), distal: angle(15) });
  }
  const peakContraction = samples.findIndex(value => value.contraction > .998);
  assert.ok(peakContraction >= 0);
  const nearPeak = samples.slice(peakContraction, peakContraction + 12), later = samples.slice(peakContraction + 12, peakContraction + 48);
  assert.ok(Math.max(...later.map(value => value.distal)) > Math.max(...nearPeak.map(value => value.distal)) + .025,
    'distal outward bend continues growing after the bell finishes its squeeze');
  assert.ok(samples.some(value => Math.abs(value.proximal - value.distal) > .15), 'chain curves instead of rotating rigidly');
});

test('pulse acceleration, drag recovery, distinct phase and slow turn remain coupled', t => {
  const { colony, player } = rig(t);
  let previous = colony.snapshot().creatures[0], powered = 0, coastDeceleration = 0, minVelocity = 0, maxVelocity = 0;
  const stateNames = new Set(), phaseHistories = ['', '', '', ''];
  // Keep the observer far enough not to trigger withdrawal, but inside culling.
  const observer = { x: player.x - 16, y: player.y, z: player.z };
  for (let frame = 1; frame <= 600; frame++) {
    colony.update(STEP, frame * STEP, observer, 'high');
    const frameState = colony.snapshot(), creature = frameState.creatures[0];
    if (frame % 60 === 0) frameState.creatures.forEach((animal, index) => { phaseHistories[index] += animal.phase.toFixed(4) + ','; });
    if (creature.thrust > .7 && creature.velocity[1] > previous.velocity[1]) powered++;
    if (creature.stage === 'recover' && creature.velocity[1] < previous.velocity[1]) coastDeceleration++;
    minVelocity = Math.min(minVelocity, creature.velocity[1]); maxVelocity = Math.max(maxVelocity, creature.velocity[1]);
    for (const rotation of creature.rotation) assert.ok(Math.abs(rotation) <= .280001);
    assert.ok(Math.hypot(...creature.velocity) < 1, 'gentle swimming rather than a projectile');
    stateNames.add(creature.state); previous = creature;
  }
  assert.ok(powered > 30); assert.ok(coastDeceleration > 150); assert.ok(maxVelocity > .25); assert.ok(minVelocity < -.03);
  assert.ok(stateNames.has('pulse')); assert.ok(stateNames.has('glide'));
  const states = colony.snapshot().creatures;
  assert.equal(new Set(phaseHistories).size, 4, 'phase histories are independent even when two phases briefly cross');
  assert.ok(new Set(states.map(value => value.contraction.toFixed(3))).size >= 2, 'independent phases can share a fully open glide or squeezed value');
  assert.equal(new Set(states.map(value => value.velocity.map(n => n.toFixed(3)).join(','))).size, 4);
});

test('nearby diver induces gradual directional withdrawal without phase locking or instant rotations', t => {
  const near = rig(t), far = rig(t), home = near.colony.snapshot().creatures[0].home;
  const player = { x: home[0] + 1.5, y: home[1], z: home[2] };
  advance(near.colony, STEP, player);
  const first = near.colony.snapshot().creatures[0];
  assert.ok(first.avoidance > 0 && first.avoidance < .04);
  assert.ok(Math.abs(first.rotation[2]) < .001);
  advance(near.colony, 3, player); advance(far.colony, 3 + STEP, FAR);
  const a = near.colony.snapshot().creatures[0], b = far.colony.snapshot().creatures[0];
  assert.ok(a.avoidance > .8); assert.equal(a.state, 'withdraw');
  assert.ok(a.position[0] < b.position[0] - .45, 'moves away from the diver at its right');
  close(a.phase, b.phase); close(a.contraction, b.contraction);
  assert.ok(a.position[0] > home[0] - 2, 'reaction is gentle and bounded');
});

test('fixed-step positions, phases, velocities and real mesh poses agree across 30/60/120Hz and jitter', t => {
  const results = [];
  for (const hz of [30, 60, 120]) {
    const { colony, first, player } = rig(t); advance(colony, 6, player, 'high', hz);
    results.push({ state: colony.snapshot(), bell: first.children[0].geometry.attributes.position.array.slice(), trails: first.children[1].geometry.attributes.position.array.slice() });
  }
  const jitter = rig(t), schedule = [1 / 120, 1 / 40, 1 / 30, 1 / 60];
  let time = 0, frame = 0;
  while (time < 6 - 1e-9) {
    const dt = Math.min(schedule[frame++ % schedule.length], 6 - time); time += dt;
    jitter.colony.update(dt, time, jitter.player, 'high');
  }
  results.push({ state: jitter.colony.snapshot(), bell: jitter.first.children[0].geometry.attributes.position.array, trails: jitter.first.children[1].geometry.attributes.position.array });
  for (const result of results) {
    close(result.state.time, 6, 1e-8); close(result.state.accumulator, 0, 1e-8);
    for (let i = 0; i < 4; i++) {
      const a = result.state.creatures[i], b = results[0].state.creatures[i];
      for (const key of ['position', 'rotation', 'velocity']) a[key].forEach((value, index) => close(value, b[key][index], 1e-8));
      close(a.phase, b.phase, 1e-8);
    }
    close(maxDifference(result.bell, results[0].bell), 0, 1e-7);
    close(maxDifference(result.trails, results[0].trails), 0, 1e-7);
  }
});

test('dt0 freezes transform, deformation, buffer versions, culling, quality and response exactly', t => {
  const { colony, player } = rig(t); advance(colony, .9, player);
  const before = colony.snapshot(true), resources = inventory(colony.root);
  const versions = [...resources.geometries].map(geometry => [geometry.attributes.position.version, geometry.attributes.normal.version, geometry.index.version]);
  for (let i = 0; i < 20; i++) colony.update(0, 80 + i, FAR, i % 2 ? 'high' : 'low');
  colony.update(-1, 0, player); colony.update(NaN, 0, player); colony.update(Infinity, 0, player);
  assert.deepEqual(colony.snapshot(true), before);
  assert.deepEqual([...resources.geometries].map(geometry => [geometry.attributes.position.version, geometry.attributes.normal.version, geometry.index.version]), versions);
});

test('distance culling skips geometry work, wake-up poses current phase, and tiers trim actual triangles in stable buffers', t => {
  const { colony, first, player } = rig(t);
  const bell = first.children[0].geometry, trails = first.children[1].geometry;
  const bellArray = bell.attributes.position.array, trailArray = trails.attributes.position.array, index = bell.index, indexArray = index.array;
  const version = bell.attributes.position.version;
  advance(colony, 4, FAR);
  const asleep = colony.snapshot();
  assert.equal(asleep.visible, 0); assert.equal(asleep.posedVertices, 0);
  assert.equal(bell.attributes.position.version, version); assert.ok(asleep.creatures[0].position[0] !== -10);
  colony.update(STEP, 4 + STEP, player, 'high');
  assert.ok(colony.snapshot().visible > 0); assert.ok(bell.attributes.position.version > version);
  const high = colony.snapshot().creatures[0]; assert.equal(high.filaments, 12);
  colony.update(STEP, 4 + STEP * 2, player, 'medium'); const medium = colony.snapshot().creatures[0];
  colony.update(STEP, 4 + STEP * 3, player, 'low'); const low = colony.snapshot().creatures[0];
  assert.equal(medium.filaments, 8); assert.equal(low.filaments, 4);
  assert.ok(medium.trailTriangles < high.trailTriangles);
  assert.ok(low.trailTriangles < medium.trailTriangles); assert.ok(low.bellTriangles < high.bellTriangles * .3);
  assert.ok(low.trailTriangles + low.bellTriangles < (high.trailTriangles + high.bellTriangles) * .5);
  assert.equal(bell.attributes.position.array, bellArray); assert.equal(trails.attributes.position.array, trailArray);
  assert.equal(bell.index, index); assert.equal(bell.index.array, indexArray);
  for (let i = 0; i < bell.drawRange.count; i++) assert.ok(indexArray[i] < bell.attributes.position.count);
  const beforeLow = bell.attributes.position.version;
  advance(colony, 1, player, 'low');
  assert.ok(bell.attributes.position.version - beforeLow <= 31, 'low-tier deformation is capped at 30Hz');
  colony.update(STEP, 6, player, 'high');
  assert.equal(colony.snapshot().creatures[0].trailTriangles, high.trailTriangles);
  assert.equal(colony.snapshot().creatures[0].bellTriangles, high.bellTriangles);
});

test('long runs, culling and quality switches retain all resource and buffer identities within habitat budgets', t => {
  const { colony } = rig(t, terrainHeight), before = inventory(colony.root);
  const tiers = ['high', 'medium', 'low'];
  const player = { x: 0, y: -28, z: -38 };
  for (let frame = 1; frame <= 2400; frame++) {
    player.x = Math.sin(frame * .005) * 40; player.z = -100 + Math.cos(frame * .004) * 73;
    colony.update(1 / 30, frame / 30, player, tiers[Math.floor(frame / 71) % 3]);
    if (frame % 300 === 0) {
      const state = colony.snapshot();
      assert.ok(state.visible <= 4); assert.ok(state.posedVertices <= colony.stats.vertices);
      for (const creature of state.creatures) {
        finite(creature.position); finite(creature.velocity);
        assert.ok(Math.abs(creature.position[0] - creature.home[0]) <= 8);
        assert.ok(Math.abs(creature.position[2] - creature.home[2]) <= 8);
        assert.ok(creature.position[1] >= terrainHeight(creature.position[0], creature.position[2]) + 3.9 * creature.size - 1e-6);
        assert.ok(creature.position[1] <= -2.2 - creature.size + 1e-6);
      }
    }
  }
  const after = inventory(colony.root);
  assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.geometries, before.geometries); assert.deepEqual(after.materials, before.materials);
  for (const [geometry, attributes] of before.attributes) {
    after.attributes.get(geometry).forEach((attribute, index) => assert.equal(attribute, attributes[index]));
    finite(geometry.attributes.position.array); finite(geometry.attributes.normal.array);
  }
});

test('new-dive time reset is deterministic, catch-up is bounded and unknown quality safely selects medium', t => {
  const a = rig(t), b = rig(t);
  advance(a.colony, 2, a.player); a.colony.update(STEP, STEP, a.player, 'high'); b.colony.update(STEP, STEP, b.player, 'high');
  assert.deepEqual(a.colony.snapshot().creatures, b.colony.snapshot().creatures);
  a.colony.update(12, 12, a.player, 'bad-tier');
  close(a.colony.snapshot().time, STEP + .25, 1e-8); assert.equal(a.colony.snapshot().quality, 'medium');
  const copy = a.colony.snapshot(true); copy.creatures[0].position[0] = 999; copy.creatures[0].chains[0].points[0] = 999;
  assert.ok(a.colony.snapshot(true).creatures[0].position[0] < 0);
  assert.ok(a.colony.snapshot(true).creatures[0].chains[0].points[0] < 1);
});

test('disposal detaches only the colony and releases each shared material and owned geometry once', t => {
  const { scene, colony, player } = rig(t), other = new THREE.Group(); scene.add(other);
  advance(colony, .2, player); const resources = inventory(colony.root), events = new Map();
  for (const resource of [...resources.materials, ...resources.geometries]) {
    events.set(resource, 0); resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
  }
  colony.dispose(); const state = colony.snapshot(true); colony.dispose(); advance(colony, 1, player);
  assert.deepEqual(colony.snapshot(true), state); assert.deepEqual(scene.children, [other]); assert.equal(colony.root.children.length, 0);
  assert.equal(state.disposed, true); assert.equal(state.visible, 0);
  for (const count of events.values()) assert.equal(count, 1);
});


test('jelly cycle has a truly reopened interpulse glide rather than continuous sinusoidal scaling', () => {
  for(const p of [.83,.88,.94,.99]){const pulse=sampleJellyPulse(p);assert.equal(pulse.stage,'glide');close(pulse.contraction,0);close(pulse.thrust,0);}
  assert.ok(sampleJellyPulse(.6).contraction>0);
});

test('near, middle and distal trail velocity memories preserve delayed reversal', t => {
  const {colony}=rig(t,()=>-45);let time=0,found=false,maxLag=0;
  const step=side=>{const p=colony.snapshot().creatures[0].position;time+=STEP;colony.update(STEP,time,{x:p[0]+side*2,y:p[1],z:p[2]},'high');const s=colony.snapshot().creatures[0],v=s.trailingVelocity;finite(v);maxLag=Math.max(maxLag,Math.abs(v[0]-v[4]));if(v[0]*v[4]<0&&Math.abs(v[0])>.008&&Math.abs(v[4])>.008)found=true;};
  for(let i=0;i<300;i++)step(-1);for(let i=0;i<480;i++)step(1);
  assert.ok(found,'distal wake should retain previous direction while the proximal wake reverses');assert.ok(maxLag>.02);
});
