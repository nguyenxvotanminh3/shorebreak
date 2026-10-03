// Real Three.js geometry/animation tests. No renderer, GPU or image quality claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createAbyssWorld, terrainHeight } from '../dist/abyss-world.js';
import { createAbyssLife } from '../dist/abyss-life.js';
import { makeLocations } from '../dist/abyss-sim.js';

const finite = values => { for (const value of values) assert.ok(Number.isFinite(value), `Nonfinite value: ${value}`); };
function resources(root) {
  const nodes = [], geometries = new Set(), materials = new Set(), attributes = new Map();
  root.traverse(node => {
    nodes.push(node);
    if (node.geometry) {
      geometries.add(node.geometry);
      attributes.set(node.geometry, Object.fromEntries(Object.entries(node.geometry.attributes).map(([key, attr]) => [key, attr.array])));
    }
    for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) materials.add(material);
  });
  return { nodes, geometries, materials, attributes };
}

test('seeded world has finite real geometry, coherent terrain, bounded instances and matching objectives', () => {
  const first = createAbyssWorld(new THREE.Scene()), second = createAbyssWorld(new THREE.Scene());
  try {
    const one = resources(first.root), two = resources(second.root);
    assert.equal(first.stats.terrainTiles, 48);
    assert.equal(first.stats.terrainTriangles, 55296);
    assert.equal(first.stats.geometries, one.geometries.size);
    assert.equal(first.stats.materials, one.materials.size);
    assert.ok(one.geometries.size < 70);
    assert.ok(one.materials.size < 25);
    assert.equal(first.stats.colliders, first.colliders.length);
    assert.deepEqual(first.stats, second.stats);
    assert.deepEqual(first.colliders, second.colliders);
    assert.equal(one.nodes.length, two.nodes.length);
    const terrain = one.nodes.filter(node => node.isMesh && node.geometry.type === 'PlaneGeometry' && node.geometry.parameters.width === 55);
    assert.equal(terrain.length, 48);
    for (const mesh of terrain) {
      const position = mesh.geometry.attributes.position;
      for (let n = 0; n < position.count; n++) {
        assert.ok(Math.abs(position.getY(n) - terrainHeight(position.getX(n), position.getZ(n))) < 1e-5);
      }
    }
    for (const geometry of one.geometries) {
      for (const attr of Object.values(geometry.attributes)) finite(attr.array);
      if (geometry.index) {
        const size = geometry.attributes.position.count;
        for (const index of geometry.index.array) assert.ok(index >= 0 && index < size);
      }
      geometry.computeBoundingSphere();
      assert.ok(Number.isFinite(geometry.boundingSphere.radius));
      assert.ok(geometry.boundingSphere.radius > 0);
    }
    one.nodes.forEach((node, n) => {
      if (!node.isInstancedMesh) return;
      finite(node.instanceMatrix.array);
      assert.deepEqual(node.instanceMatrix.array, two.nodes[n].instanceMatrix.array, 'procedural placement must be seeded');
      if (node.instanceColor) finite(node.instanceColor.array);
      assert.ok(node.count <= node.instanceMatrix.count);
    });
    for (const collider of first.colliders) {
      finite(Object.values(collider));
      assert.ok(collider.radius > 0 && collider.height > 0);
    }
    for (const [index, target] of makeLocations(terrainHeight).entries()) {
      const landmark = first.landmarks[['A', 'B', 'C'][index]];
      assert.deepEqual(landmark.position.toArray(), [target.x, target.y, target.z]);
    }
    assert.equal(first.airBell, first.landmarks.B.airPocket);
  } finally { first.dispose(); second.dispose(); }
});

test('quality tiers reduce particles, instances, light shafts and culling range without reallocating', () => {
  const world = createAbyssWorld(new THREE.Scene());
  try {
    const original = resources(world.root), counts = [];
    const particles = original.nodes.find(node => node.isPoints);
    const beams = original.nodes.find(node => node.name === 'Soft light shafts');
    const player = { x: 0, y: -40, z: -100 };
    for (const [index, quality] of ['low', 'medium', 'high'].entries()) {
      world.setQuality(quality);
      world.update(.4, 3, player, quality);
      assert.equal(world.stats.quality, quality);
      assert.equal(particles.geometry.drawRange.count, [450, 850, 1350][index]);
      assert.equal(beams.visible, quality !== 'low');
      const instances = original.nodes.filter(node => node.isInstancedMesh).reduce((total, node) => total + node.count, 0);
      counts.push({ instances, chunks: world.stats.visibleChunks });
      for (const node of original.nodes.filter(node => node.isInstancedMesh)) assert.ok(node.count > 0 && node.count <= node.instanceMatrix.count);
      const current = resources(world.root);
      assert.deepEqual(current.nodes, original.nodes);
      assert.deepEqual(current.geometries, original.geometries);
      assert.deepEqual(current.materials, original.materials);
    }
    assert.ok(counts[0].instances < counts[1].instances && counts[1].instances < counts[2].instances);
    assert.ok(counts[0].chunks < counts[1].chunks && counts[1].chunks <= counts[2].chunks);
  } finally { world.dispose(); }
});

test('world keeps mesh/material/buffer/collider identities stable over 2,400 updates and freezes at fixed time', () => {
  const scene = new THREE.Scene(), world = createAbyssWorld(scene);
  try {
    const original = resources(world.root), colliderList = world.colliders, colliderRefs = [...colliderList];
    for (let n = 0; n < 2400; n++) {
      const player = { x: Math.sin(n * .013) * 100, y: -4 - (n % 600) / 9, z: 30 - (n % 800) * .3 };
      world.update(1 / 60, n / 60, player, ['low', 'medium', 'high'][Math.floor(n / 240) % 3]);
    }
    const after = resources(world.root);
    assert.deepEqual(after.nodes, original.nodes);
    assert.deepEqual(after.geometries, original.geometries);
    assert.deepEqual(after.materials, original.materials);
    assert.equal(world.colliders, colliderList);
    colliderRefs.forEach((value, index) => assert.equal(world.colliders[index], value));
    for (const [geometry, attrs] of original.attributes) for (const [name, array] of Object.entries(attrs)) assert.equal(geometry.attributes[name].array, array);
    for (const node of after.nodes) {
      finite(node.position.toArray());
      finite(node.scale.toArray());
      if (node.isInstancedMesh) finite(node.instanceMatrix.array);
    }
    const player = { x: 0, y: -55, z: -145 };
    world.update(.5, 40, player, 'medium');
    const fog = scene.fog.color.toArray(), background = scene.background.toArray();
    const intensity = [...after.materials].map(material => material.emissiveIntensity);
    for (let n = 0; n < 120; n++) world.update(0, 40, player, 'medium');
    assert.deepEqual(scene.fog.color.toArray(), fog);
    assert.deepEqual(scene.background.toArray(), background);
    assert.deepEqual([...after.materials].map(material => material.emissiveIntensity), intensity);
  } finally { world.dispose(); }
});

test('caustic materials inject finite shared shader uniforms into real Three standard shaders', () => {
  const world = createAbyssWorld(new THREE.Scene());
  try {
    const materials = [...resources(world.root).materials].filter(material => material.customProgramCacheKey().startsWith('abyss-caustics'));
    assert.ok(materials.length >= 8);
    const clocks = new Set();
    for (const material of materials) {
      const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
      material.onBeforeCompile(shader);
      assert.ok(shader.vertexShader.includes('vAbyssWorld=(modelMatrix*abyssPosition).xyz;'));
      assert.ok(shader.fragmentShader.includes('outgoingLight+=vec3(.075,.22,.19)'));
      assert.equal((shader.vertexShader.match(/varying vec3 vAbyssWorld/g) || []).length, 1);
      finite([shader.uniforms.uAbyssTime.value, shader.uniforms.uAbyssCaustics.value]);
      clocks.add(shader.uniforms.uAbyssTime);
    }
    assert.equal(clocks.size, 1);
    world.update(1, 73, { x: 0, y: -3, z: 18 });
    assert.equal([...clocks][0].value, 73);
  } finally { world.dispose(); }
});

test('world disposal is idempotent, releases each resource once and restores owned scene state', () => {
  const scene = new THREE.Scene(), fog = new THREE.Fog(0xffffff, 1, 50), background = new THREE.Color(0x123456);
  scene.fog = fog;
  scene.background = background;
  const world = createAbyssWorld(scene), initial = resources(world.root), disposalCounts = new Map();
  for (const object of [...initial.geometries, ...initial.materials]) object.addEventListener('dispose', () => disposalCounts.set(object, (disposalCounts.get(object) || 0) + 1));
  world.dispose();
  world.dispose();
  world.update(1, 100, { x: 1, y: -4, z: 2 }, 'high');
  assert.equal(scene.fog, fog);
  assert.equal(scene.background, background);
  assert.ok(!scene.children.includes(world.root));
  assert.equal(world.colliders.length, 0);
  assert.equal(disposalCounts.size, initial.geometries.size + initial.materials.size);
  for (const count of disposalCounts.values()) assert.equal(count, 1);
  const other = createAbyssWorld(scene), externalFog = new THREE.Fog(0, 0, 1), externalBackground = new THREE.Color(0);
  scene.fog = externalFog;
  scene.background = externalBackground;
  other.dispose();
  assert.equal(scene.fog, externalFog);
  assert.equal(scene.background, externalBackground);
});

function syntheticGltf() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 2);
  const texture = new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2);
  const material = new THREE.MeshStandardMaterial({ map: texture });
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  return { scene, animations: [new THREE.AnimationClip('swim', 2, [new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1, 2], [0, .5, 0])])] };
}
const flushLoads = async () => { await Promise.resolve(); await Promise.resolve(); };

test('life loads each LOD once, switches with hysteresis, and never damages through invisible unloaded creatures', async t => {
  const calls = [], assets = [];
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => { calls.push(url); return syntheticGltf(); });
  const scene = new THREE.Scene(), life = createAbyssLife(scene, { onAsset: value => assets.push(value),
    jellyTextureLoader: { loadAsync: async () => new THREE.Texture() } });
  try {
    life.update(0, 0, { x: 1000, y: -20, z: 1000 }, 'medium');
    assert.equal(calls.length, 0);
    assert.equal(life.threats.length, 0);
    const shark = life.creatures.find(creature => creature.id === 'shark');
    const player = { x: shark.center.x, y: shark.center.y, z: shark.center.z + shark.orbit[2] };
    life.update(1 / 60, 0, player, 'medium');
    assert.equal(life.threats.length, 0, 'loading creatures must not cause invisible damage');
    await flushLoads();
    life.update(1 / 60, 0, player, 'medium');
    assert.equal(shark.lowState, 'ready');
    assert.equal(shark.highState, 'idle');
    assert.equal(shark.lowObject.visible, true);
    assert.ok(life.threats.includes(shark.threat));
    life.update(1 / 60, 0, player, 'high');
    await flushLoads();
    life.update(1 / 60, 0, player, 'high');
    assert.equal(shark.highState, 'ready');
    assert.equal(shark.highObject.visible, true);
    assert.equal(shark.lowObject.visible, false);
    life.update(0, 0, { ...player, x: player.x + shark.near + 2 }, 'high');
    assert.equal(shark.highObject.visible, true, 'near boundary should retain high LOD inside hysteresis');
    life.update(0, 0, { ...player, x: player.x + shark.near + 8 }, 'high');
    assert.equal(shark.highObject.visible, false);
    assert.equal(shark.lowObject.visible, true);
    for (let n = 0; n < 15; n++) life.update(1 / 60, 0, player, n % 2 ? 'low' : 'high');
    assert.equal(calls.filter(url => url.endsWith('/shark-lod.glb')).length, 1);
    assert.equal(calls.filter(url => url.endsWith('/shark.glb')).length, 1);
    assert.ok(assets.every(asset => asset.status === 'ready'));
    assert.ok(assets.some(asset => asset.id === 'jelly-tissue' && asset.tier === 'shared'));
    assert.equal(life.snapshot().jellyTissue, 'ready');
    life.update(0, 0, { x: 1000, y: 0, z: 1000 }, 'low');
    assert.equal(life.threats.length, 0);
    assert.ok(life.creatures.every(creature => !creature.root.visible));
  } finally { life.dispose(); }
});

test('fish and creature animation stays finite, pooled, frame-rate independent and frozen with fixed time', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => syntheticGltf());
  const scene = new THREE.Scene(), life = createAbyssLife(scene), player = { x: -15, y: -24, z: -65 };
  try {
    life.update(0, 0, player, 'high');
    await flushLoads();
    // Preload every LOD so stability assertions do not count intentional asset arrivals.
    for (const creature of life.creatures) {
      life.update(0, 0, creature.root.position, 'high');
      await flushLoads();
    }
    const original = resources(scene), threats = life.threats;
    const threatRefs = life.creatures.map(creature => creature.threat);
    for (let n = 0; n < 1800; n++) {
      life.update(1 / 60, n / 60, player, ['low', 'medium', 'high'][Math.floor(n / 180) % 3]);
      assert.equal(life.threats, threats);
      for (const threat of threats) { assert.ok(threatRefs.includes(threat)); finite(Object.values(threat)); }
    }
    const after = resources(scene);
    assert.deepEqual(after.nodes, original.nodes);
    assert.deepEqual(after.geometries, original.geometries);
    assert.deepEqual(after.materials, original.materials);
    for (const [geometry, attrs] of original.attributes) for (const [name, array] of Object.entries(attrs)) assert.equal(geometry.attributes[name].array, array);
    const schools = scene.children.filter(node => node.isInstancedMesh);
    assert.equal(schools.length, 5);
    assert.equal(new Set(schools.map(mesh => mesh.geometry)).size, 1);
    assert.equal(new Set(schools.map(mesh => mesh.material)).size, 1);
    for (const mesh of schools) finite(mesh.instanceMatrix.array);
    for (const [quality, expected] of [['low', 12], ['medium', 25], ['high', 42]]) {
      life.update(1 / 60, 5, { x: -45, y: -15, z: -30 }, quality);
      assert.equal(schools[0].count, expected);
    }
    life.update(1 / 30, 5.3, player, 'high');
    const matrices = schools.map(mesh => mesh.instanceMatrix.array.slice());
    const transforms = life.creatures.map(creature => [creature.root.position.toArray(), creature.root.rotation.toArray(), creature.lowObject?.rotation.toArray(), creature.highObject?.rotation.toArray()]);
    for (let n = 0; n < 90; n++) life.update(0, 5.3, player, 'high');
    schools.forEach((mesh, index) => assert.deepEqual(mesh.instanceMatrix.array, matrices[index]));
    assert.deepEqual(life.creatures.map(creature => [creature.root.position.toArray(), creature.root.rotation.toArray(), creature.lowObject?.rotation.toArray(), creature.highObject?.rotation.toArray()]), transforms);
    life.update(1 / 120, 5.3, player, 'high');
    schools.forEach((mesh, index) => assert.deepEqual(mesh.instanceMatrix.array, matrices[index]));
  } finally { life.dispose(); }
});

test('life disposal cancels activity and safely releases delayed shared GLB resources once', async t => {
  const pending = [], assets = [], disposals = new Map();
  t.mock.method(GLTFLoader.prototype, 'loadAsync', url => new Promise(resolve => pending.push({ url, resolve })));
  const scene = new THREE.Scene(), life = createAbyssLife(scene, { onAsset: asset => assets.push(asset) });
  life.update(1 / 60, 0, { x: -9, y: -20, z: -24 }, 'high');
  assert.ok(pending.length >= 2);
  const before = life.creatures.map(creature => creature.root.position.toArray());
  life.dispose();
  life.dispose();
  for (const load of pending) {
    const gltf = syntheticGltf(), owned = resources(gltf.scene);
    const texture = gltf.scene.children[0].material.map;
    for (const object of [...owned.geometries, ...owned.materials, texture]) {
      disposals.set(object, 0);
      object.addEventListener('dispose', () => disposals.set(object, disposals.get(object) + 1));
    }
    load.resolve(gltf);
  }
  await flushLoads();
  const loadCount = pending.length;
  life.update(1, 25, { x: -9, y: -20, z: -24 }, 'high');
  assert.equal(pending.length, loadCount);
  assert.equal(scene.children.length, 0);
  assert.equal(life.threats.length, 0);
  assert.equal(assets.length, 0);
  assert.deepEqual(life.creatures.map(creature => creature.root.position.toArray()), before);
  assert.ok(life.creatures.every(creature => creature.root.children.length === 0));
  for (const count of disposals.values()) assert.equal(count, 1);
});

test('failed creature assets report once, remain nonhazardous and do not retry every frame', async t => {
  const calls = [], reports = [];
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => { calls.push(url); throw new Error('fixture network failure'); });
  const life = createAbyssLife(new THREE.Scene(), { onAsset: report => reports.push(report) });
  try {
    const player = { x: -9, y: -20, z: -24 };
    life.update(0, 0, player, 'high');
    await flushLoads();
    const count = calls.length;
    for (let n = 0; n < 60; n++) life.update(1 / 60, n / 60, player, 'high');
    assert.equal(calls.length, count);
    assert.equal(reports.length, count);
    assert.ok(reports.every(report => report.status === 'error' && report.message === 'fixture network failure'));
    assert.equal(life.threats.length, 0);
  } finally { life.dispose(); }
});

// These check deterministic light inputs and scene objects. They do not draw
// pixels or establish perceived luminance, GPU shadow quality or frame rate.
test('lighting preserves shallow daylight and has explicit darker deep endpoints', () => {
  const world = createAbyssWorld(new THREE.Scene());
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
  try {
    const hemisphere = world.root.children.find(node => node.isHemisphereLight);
    const directional = world.root.children.filter(node => node.isDirectionalLight);
    const snapshot = world.stats.lighting;
    world.update(0, 0, { x: 0, y: -4.4, z: 18, status: 'menu' });
    assert.equal(snapshot.darkness, 0); assert.equal(snapshot.indoors, false);
    close(hemisphere.intensity, 2); close(directional[0].intensity, 2.5); close(directional[1].intensity, .65);
    world.update(0, 0, { x: 45, y: -130, z: -335, status: 'paused' });
    assert.equal(snapshot.darkness, 1); close(hemisphere.intensity, .14); close(directional[0].intensity, .055); close(directional[1].intensity, .045);
    close(snapshot.ambient, hemisphere.intensity); close(snapshot.sunlight, directional[0].intensity); close(snapshot.fill, directional[1].intensity);
    assert.ok(snapshot.ambient < .48); assert.ok(snapshot.sunlight < .24); assert.ok(snapshot.fill < .24);
    assert.equal(world.stats.lighting, snapshot);
  } finally { world.dispose(); }
});

test('only explicit room containment applies indoor lighting factors, not air or walking alone', () => {
  const world = createAbyssWorld(new THREE.Scene());
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
  try {
    const deep = { x: 45, y: -130, z: -335, status: 'paused' };
    world.update(0, 0, deep); const outside = { ...world.stats.lighting };
    world.update(0, 0, { ...deep, indoors: true });
    const inside = world.stats.lighting;
    assert.equal(inside.indoors, true); close(inside.ambient, outside.ambient * .5); close(inside.sunlight, outside.sunlight * .08); close(inside.fill, outside.fill * .08);
    for (const extra of [{ indoors: false }, { indoors: undefined, inAir: true }, { indoors: undefined, movementMode: 'walk' }, { indoors: 'true' }]) {
      world.update(0, 0, { ...deep, ...extra });
      assert.deepEqual(world.stats.lighting, outside);
    }
    world.update(0, 0, { x: 0, y: .1, z: 18, status: 'paused', inAir: true });
    close(world.stats.lighting.ambient, 2); close(world.stats.lighting.sunlight, 2.5); close(world.stats.lighting.fill, .65);
  } finally { world.dispose(); }
});

test('lighting interpolation stays finite, monotone and tier-independent without changing geometry', () => {
  const world = createAbyssWorld(new THREE.Scene()), before = resources(world.root);
  try {
    let previous = { ambient: Infinity, sunlight: Infinity, fill: Infinity };
    for (let i = 0; i <= 100; i++) {
      world.update(0, 0, { x: 0, y: -4 - i * 1.3, z: 18 - i * 3.6, status: 'paused' });
      const light = world.stats.lighting;
      for (const key of ['ambient', 'sunlight', 'fill']) { assert.ok(Number.isFinite(light[key]) && light[key] > 0); assert.ok(light[key] <= previous[key]); }
      previous = { ...light };
    }
    for (const tier of ['low', 'medium', 'high']) {
      world.update(0, 0, { x: 0, y: -134, z: -342, status: 'paused' }, tier);
      assert.deepEqual(world.stats.lighting, previous);
    }
    const after = resources(world.root); assert.deepEqual(after.geometries, before.geometries); assert.deepEqual(after.materials, before.materials);
    for (const [geometry, attributes] of before.attributes) for (const [key, array] of Object.entries(attributes)) assert.equal(geometry.attributes[key].array, array);
  } finally { world.dispose(); }
});
