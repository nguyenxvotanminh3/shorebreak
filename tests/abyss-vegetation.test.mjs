// Real Three.js geometry, matrices, materials and GLTFLoader. Shader-source and
// numerical motion checks do not claim real GPU compilation or pixel quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createAbyssVegetation, sampleVegetationSway, VEGETATION_SPECIES, VEGETATION_TIERS } from '../dist/abyss-vegetation.js';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const finite = values => { for (const value of values) assert.ok(Number.isFinite(value), `Nonfinite ${value}`); };
const origin = { x: 0, y: 0, z: 0 };
const heights = [3.1, 1.8, 1, .85, 1.2, .65];
function track(resource, list) {
  const entry = { resource, count: 0 }; list.push(entry);
  resource.addEventListener('dispose', () => entry.count++);
  return resource;
}
function fixture({ names = VEGETATION_SPECIES, missing, alpha = true, shared = false, extra = false } = {}) {
  const scene = new THREE.Group(), resources = [], nodes = [];
  const image = { closed: 0, close() { this.closed++; } };
  const texture = track(new THREE.Texture(image), resources);
  const material = track(new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, transparent: true, opacity: .2, depthWrite: false, alphaTest: .7, vertexColors: true }), resources);
  material.alphaMap = texture;
  let sharedGeometry;
  for (let index = 0; index < names.length; index++) for (const variant of ['full', 'low']) {
    if (`${names[index]}_${variant}` === missing) continue;
    const geometry = sharedGeometry && shared ? sharedGeometry : track(new THREE.BufferGeometry(), resources);
    if (!sharedGeometry || !shared) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .2, .5, 0, 0, 1, 0, -.2, .5, 0], 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([.5, 0, 1, .5, .5, 1, 0, .5], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      if (alpha) geometry.setAttribute('color', new THREE.Uint8BufferAttribute([255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255, 255, 255, 255, 128], 4, true));
      sharedGeometry = geometry;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `veg_${names[index]}_${variant}`;
    mesh.position.set(index * 10, 0, variant === 'low' ? 5 : 0); // Catalogue offsets must not shift roots.
    mesh.scale.set(1, heights[index % heights.length] * (variant === 'low' ? .97 : 1), 1);
    scene.add(mesh); nodes.push(mesh);
  }
  if (extra) {
    const other = track(new THREE.MeshStandardMaterial(), resources), geometry = track(new THREE.BoxGeometry(), resources);
    scene.add(new THREE.Mesh(geometry, other));
  }
  return { scene, scenes: [scene, scene], resources, image, texture, material, nodes };
}
async function setup(t, options = {}, fixtureOptions = {}) {
  const model = fixture(fixtureOptions), scene = new THREE.Scene(), calls = [], reports = [];
  const runtime = createAbyssVegetation(scene, { sites: [{ ...origin, species: 'ribbon_kelp' }], loader: { async loadAsync(url) { calls.push(url); return model; } }, onAsset: result => reports.push(result), ...options });
  if (t) t.after(() => runtime.dispose());
  assert.equal(await runtime.ready, true, runtime.stats.error);
  return { runtime, model, scene, calls, reports };
}
function meshes(runtime) { return runtime.root.children.filter(node => node.isInstancedMesh); }
function findPool(runtime, species, lod) { return meshes(runtime).find(mesh => mesh.userData.vegetation.species === species && mesh.userData.vegetation.lod === lod); }
function visibleMatrices(runtime) {
  const output = [];
  for (const mesh of meshes(runtime)) for (let i = 0; i < mesh.count; i++) output.push({ species: mesh.userData.vegetation.species, lod: mesh.userData.vegetation.lod, matrix: Array.from(mesh.instanceMatrix.array.slice(i * 16, (i + 1) * 16)) });
  return output;
}
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
}

// A self-contained GLB with normalized unsigned-byte COLOR_0 and shared primitive
// accessors exercises the actual loader (no bitmap decoder or mock Three module).
function makeGLB() {
  const positions = new Float32Array([0, 0, 0, .2, .5, 0, 0, 1, 0]);
  const colors = new Uint8Array([255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(colors)]);
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [],
    buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: colors.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [.2, 1, 0] }, { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4', normalized: true }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .9 } }] };
  for (let i = 0; i < VEGETATION_SPECIES.length; i++) for (const variant of ['full', 'low']) {
    const index = document.nodes.length;
    document.scenes[0].nodes.push(index);
    document.nodes.push({ name: `veg_${VEGETATION_SPECIES[i]}_${variant}`, mesh: index, translation: [i * 10, 0, 0], scale: [1, heights[i], 1] });
    document.meshes.push({ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }] });
  }
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const output = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16); padded.copy(output, 20);
  const next = 20 + padded.length;
  output.writeUInt32LE(bin.length, next); output.writeUInt32LE(0x004e4942, next + 4); bin.copy(output, next + 8);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

test('exact species and immutable conservative global tier budgets', () => {
  assert.deepEqual(VEGETATION_SPECIES, ['ribbon_kelp', 'split_kelp', 'eelgrass', 'red_algae', 'sea_fan', 'plate_coral']);
  assert.deepEqual(Object.values(VEGETATION_TIERS).map(tier => [tier.full, tier.total]), [[96, 320], [64, 220], [0, 140]]);
  assert.ok(Object.isFrozen(VEGETATION_SPECIES)); assert.ok(Object.isFrozen(VEGETATION_TIERS));
  for (const tier of Object.values(VEGETATION_TIERS)) { assert.ok(Object.isFrozen(tier)); assert.ok(tier.exit > tier.enter); assert.ok(tier.fullExit >= tier.fullEnter); }
});

test('actual GLTFLoader accepts independent nodes and normalized alpha; no synthetic Three replacements', async t => {
  const gltf = await new GLTFLoader().parseAsync(makeGLB(), '');
  const plants = createAbyssVegetation(new THREE.Scene(), { sites: VEGETATION_SPECIES.map((species, i) => ({ x: i, y: 0, z: 0, species })), loader: { async loadAsync() { return gltf; } } });
  t.after(() => plants.dispose()); assert.equal(await plants.ready, true, plants.stats.error);
  assert.equal(plants.stats.species, 6); assert.equal(plants.stats.pools, 12); assert.equal(plants.stats.geometries, 12);
  for (const mesh of meshes(plants)) {
    assert.ok(mesh instanceof THREE.InstancedMesh);
    assert.equal(mesh.geometry.attributes.color.itemSize, 3);
    assert.deepEqual(Array.from(mesh.geometry.attributes.aVegFlex.array), [0, Math.fround(128 / 255), 1]);
    for (const attribute of Object.values(mesh.geometry.attributes)) finite(attribute.array);
    finite(mesh.instanceMatrix.array); close(mesh.geometry.boundingBox.min.y, 0);
  }
});

test('one shared opaque material and one shared prepared geometry per variant, with no per-site meshes', async t => {
  const sites = Array.from({ length: 120 }, (_, i) => ({ x: i / 10, y: 0, z: 0, species: VEGETATION_SPECIES[i % 6] }));
  const { runtime, model, calls, reports, scene } = await setup(t, { sites }, { shared: true, extra: true });
  assert.deepEqual(calls, ['./assets/abyss/vegetation.glb']);
  assert.equal(runtime.root.parent, scene); assert.equal(runtime.root.children.length, 12);
  assert.equal(new Set(meshes(runtime).map(mesh => mesh.material)).size, 1);
  assert.equal(new Set(meshes(runtime).map(mesh => mesh.geometry)).size, 12);
  assert.deepEqual(reports, [{ id: 'vegetation', status: 'ready' }]);
  assert.equal(runtime.stats.sites, 120); assert.equal(runtime.stats.materials, 1);
  for (const mesh of meshes(runtime)) {
    assert.equal(mesh.material, model.material); assert.equal(mesh.material.transparent, false); assert.equal(mesh.material.opacity, 1);
    assert.equal(mesh.material.alphaTest, 0); assert.equal(mesh.material.alphaMap, null);
    assert.equal(mesh.material.depthWrite, true); assert.equal(mesh.material.depthTest, true);
    assert.equal(mesh.material.vertexColors, true); assert.equal(mesh.geometry.attributes.color.itemSize, 3);
    assert.equal(mesh.frustumCulled, false); assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
    assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage); assert.equal(mesh.instanceColor.usage, THREE.DynamicDrawUsage);
    assert.ok(mesh.count <= mesh.instanceMatrix.count);
  }
  assert.equal(model.resources.find(item => item.resource.isBufferGeometry).count, 1, 'source geometry released after preparing variants');
  assert.equal(model.resources.find(item => item.resource === model.material).count, 0, 'shared atlas is still owned and live');
});

test('species mapping, optional terrain, transforms, tint and full-height normalization survive LOD changes', async t => {
  const sites = [{ x: 4, z: 5, species: 'canopy', rotation: Math.PI / 2, targetHeight: 6.2, color: '#80ff80' },
    { x: 1, y: 2, z: 3, species: 'eelgrass', rotation: { x: .1, y: .2, z: .3 }, scale: { x: .8, y: 1.2, z: .9 } }];
  const samples = [];
  const { runtime } = await setup(t, { sites, speciesMapping: { canopy: 'ribbon_kelp' }, terrain: (x, z) => { samples.push([x, z]); return -4; } });
  assert.deepEqual(samples, [[4, 5]]);
  const full = findPool(runtime, 'ribbon_kelp', 'full'), low = findPool(runtime, 'ribbon_kelp', 'low');
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  full.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
  assert.deepEqual(position.toArray(), [4, -4, 5]); close(scale.x, 2); close(scale.y, 2); close(scale.z, 2);
  close(rotation.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)), 0);
  const tint = new THREE.Color('#80ff80'); close(full.instanceColor.getX(0), tint.r); close(full.instanceColor.getY(0), tint.g);
  runtime.update(.1, 8, { x: 40, y: 0, z: 5 });
  assert.equal(full.count, 0); assert.equal(low.count, 1);
  const lowMatrix = new THREE.Matrix4(); low.getMatrixAt(0, lowMatrix); assert.deepEqual(lowMatrix.elements, matrix.elements);
  close(full.geometry.attributes.aVegMotion.getX(0), 3.1); close(low.geometry.attributes.aVegMotion.getX(0), 3.1);
  assert.ok(low.geometry.boundingBox.max.y < full.geometry.boundingBox.max.y, 'different authored LOD shape does not change instance scaling');
});

test('hard budgets apply across all species and nearest sites win deterministically', async t => {
  const sites = Array.from({ length: 900 }, (_, i) => ({ x: (i % 30) * .15, y: 0, z: Math.floor(i / 30) * .15, species: VEGETATION_SPECIES[i % 6] }));
  const { runtime } = await setup(t, { sites, quality: 'high' });
  const original = meshes(runtime).map(mesh => ({ mesh, geometry: mesh.geometry, material: mesh.material, matrix: mesh.instanceMatrix.array, colors: mesh.instanceColor.array }));
  for (const tier of ['high', 'medium', 'low', 'high', 'invalid']) {
    runtime.setQuality(tier);
    const effective = tier === 'invalid' ? 'medium' : tier, budget = VEGETATION_TIERS[effective];
    assert.equal(runtime.stats.fullVisible, budget.full); assert.equal(runtime.stats.visible, budget.total);
    assert.equal(meshes(runtime).reduce((sum, mesh) => sum + mesh.count, 0), budget.total);
    const state = runtime.snapshot(); assert.equal(state.lod.filter(value => value === 2).length, budget.full);
    assert.equal(state.lod.filter(Boolean).length, budget.total);
    const expected = sites.map((site, index) => ({ index, d: site.x ** 2 + site.z ** 2 })).sort((a, b) => a.d - b.d || a.index - b.index).slice(0, budget.total);
    for (const item of expected) assert.ok(state.lod[item.index], `near site ${item.index} should be selected`);
    for (const saved of original) { assert.equal(saved.mesh.geometry, saved.geometry); assert.equal(saved.mesh.material, saved.material); assert.equal(saved.mesh.instanceMatrix.array, saved.matrix); assert.equal(saved.mesh.instanceColor.array, saved.colors); }
  }
});

test('full-distance and outer-distance hysteresis prevents boundary jitter; low never uses full', async t => {
  const { runtime } = await setup(t, { quality: 'high' });
  const at = x => { runtime.update(.1, 1, { x, y: 0, z: 0 }); return runtime.snapshot().lod[0]; };
  assert.equal(at(21), 2); assert.equal(at(25), 2); assert.equal(at(28), 1); assert.equal(at(25), 1); assert.equal(at(21), 2);
  assert.equal(at(86), 1); assert.equal(at(92), 1); assert.equal(at(95), 0); assert.equal(at(90), 0); assert.equal(at(84), 1);
  runtime.setQuality('low'); assert.equal(at(0), 1); assert.equal(runtime.stats.fullVisible, 0);
  assert.equal(at(55), 1); assert.equal(at(57), 0); assert.equal(at(50), 0); assert.equal(at(47), 1);
  assert.equal(at(1000), 0); assert.equal(runtime.root.visible, false);
});

test('loading snapshots copied sites, pending observer and quality without creating placeholder geometry', async t => {
  let resolve; const model = fixture(); const sites = [{ x: 70, z: 0, species: 'ribbon_kelp', scale: { x: 1, y: 2, z: 1 } }];
  const scene = new THREE.Scene();
  const runtime = createAbyssVegetation(scene, { sites, loader: { loadAsync: () => new Promise(done => { resolve = done; }) } });
  t.after(() => runtime.dispose());
  assert.equal(runtime.stats.status, 'loading'); assert.equal(runtime.root.children.length, 0);
  sites[0].x = 900; sites[0].scale.y = 100;
  runtime.update(.1, 12, { x: 70, y: 0, z: 0 }, 'low');
  resolve(model); assert.equal(await runtime.ready, true);
  assert.equal(runtime.stats.quality, 'low'); assert.equal(runtime.stats.time, 12); assert.equal(runtime.stats.visible, 1);
  const instance = visibleMatrices(runtime)[0]; close(instance.matrix[13], 0); close(instance.matrix[12], 70); close(instance.matrix[5], 2);
});

test('material decorator composes shared caustic hooks and cache keys without changing time or opacity', async t => {
  let calls = 0;
  const { runtime, model } = await setup(t, { materialDecorator(material) {
    calls++; material.onBeforeCompile = shader => {
      shader.uniforms.uExisting = { value: 4 };
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n// existing caustics begin');
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n// water uses transformed world position');
    };
    material.customProgramCacheKey = () => 'shared-water-v2'; material.transparent = true; return material;
  } });
  assert.equal(calls, 1); assert.equal(model.material.transparent, false);
  const shader = compile(model.material), second = compile(model.material);
  assert.ok(shader.vertexShader.includes('// existing caustics begin')); assert.ok(shader.vertexShader.includes('// water uses transformed world position'));
  assert.ok(shader.vertexShader.includes('transformed += vegOffset')); assert.ok(shader.vertexShader.includes('objectNormal.y ='));
  assert.equal(shader.uniforms.uExisting.value, 4); assert.equal(shader.uniforms.uVegTime, second.uniforms.uVegTime);
  assert.match(model.material.customProgramCacheKey(), /shared-water-v2\|abyss-vegetation-v1/);
  runtime.update(1 / 60, 99, origin); assert.equal(shader.uniforms.uVegTime.value, 99);
  runtime.update(0, 300, origin, 'low'); assert.equal(shader.uniforms.uVegTime.value, 99);
});

test('absolute animation time is frame-rate independent, dt0 pauses, and LOD/compaction never resets phase', async t => {
  const a = await setup(t), b = await setup(t), c = await setup(t);
  for (const [item, hz] of [[a, 30], [b, 60], [c, 120]]) {
    for (let i = 1; i <= hz * 3; i++) item.runtime.update(1 / hz, i / hz, origin);
    assert.equal(item.runtime.stats.time, 3);
    const shader = compile(item.model.material);
    assert.equal(shader.uniforms.uVegTime.value, 3);
  }
  const shader = compile(a.model.material), before = sampleVegetationSway(3, 4, -9, .8, 3.1);
  a.runtime.update(0, 500, { x: 50, y: 0, z: 0 }, 'low');
  assert.equal(a.runtime.stats.time, 3); assert.equal(shader.uniforms.uVegTime.value, 3); assert.equal(a.runtime.stats.fullVisible, 0);
  a.runtime.update(.05, 3.05, origin, 'high'); close(shader.uniforms.uVegTime.value, 3.05);
  a.runtime.update(.05, undefined, origin); close(a.runtime.stats.time, 3.1);
  a.runtime.update(NaN, 900, origin); close(a.runtime.stats.time, 3.1);
  assert.deepEqual(sampleVegetationSway(3, 4, -9, .8, 3.1), before);
  assert.notDeepEqual(sampleVegetationSway(3, 8, -9, .8, 3.1), before, 'individual roots have distinct phase');
  assert.ok(shader.vertexShader.includes('root = instanceMatrix * root'));
  assert.ok(!shader.vertexShader.includes('gl_InstanceID'), 'phase must not depend on compacted slot');
});

test('root is exactly fixed; bounded distal lag, geometric shortening, and normals remain finite', () => {
  const out = {};
  for (let time = -100; time <= 100; time += .11) {
    sampleVegetationSway(time, 18, -80, 0, 3.1, .095, out);
    close(out.x, 0, 0); close(out.y, 0, 0); close(out.z, 0, 0);
    for (const flexibility of [.1, .5, 1]) {
      sampleVegetationSway(time, 18, -80, flexibility, 3.1, .095, out);
      finite(Object.values(out)); assert.ok(Math.hypot(out.x, out.z) <= 3.1 * .095 * Math.hypot(1.22, .55) + 1e-8);
      assert.ok(out.y <= 0); assert.ok(Math.abs(out.y) < .03 * 3.1); assert.ok(1 + out.slopeY > .9);
    }
  }
  const near = sampleVegetationSway(1, 0, 0, .3, 3.1), tip = sampleVegetationSway(1, 0, 0, .9, 3.1);
  assert.notEqual(near.x / (.3 ** 2), tip.x / (.9 ** 2), 'distal motion includes phase lag, not only greater amplitude');
  const f = .57, h = 3.1, epsilon = 1e-5;
  const value = sampleVegetationSway(9, 0, 0, f, h), left = sampleVegetationSway(9, 0, 0, f - epsilon, h), right = sampleVegetationSway(9, 0, 0, f + epsilon, h);
  close((right.x - left.x) / (2 * epsilon * h), value.slopeX); close((right.y - left.y) / (2 * epsilon * h), value.slopeY); close((right.z - left.z) / (2 * epsilon * h), value.slopeZ);
});

test('plate coral is effectively rigid and all low variants use full height and the identical sway strength', async t => {
  const { runtime } = await setup(t, { sites: VEGETATION_SPECIES.map((species, x) => ({ x, z: 0, species })) });
  for (const species of VEGETATION_SPECIES) {
    const full = findPool(runtime, species, 'full').geometry.attributes.aVegMotion;
    const low = findPool(runtime, species, 'low').geometry.attributes.aVegMotion;
    close(full.getX(0), low.getX(0), 0); close(full.getY(0), low.getY(0), 0);
  }
  const plate = runtime.snapshot().variants.find(item => item.species === 'plate_coral');
  for (let t = 0; t < 100; t += .2) {
    const delta = sampleVegetationSway(t, 0, 0, 1, plate.height, plate.strength);
    assert.ok(Math.hypot(delta.x, delta.y, delta.z) < .0005, 'coral motion stays below half a millimetre');
  }
});

test('long moving-view run preserves all mesh/material/buffer identities and finite values', async t => {
  const sites = Array.from({ length: 1000 }, (_, i) => ({ x: Math.sin(i * 2.39) * (i % 110), z: Math.cos(i * 2.39) * (i % 110), y: -(i % 8), species: VEGETATION_SPECIES[i % 6], color: i % 2 ? '#80ba8a' : '#ffffff' }));
  const { runtime } = await setup(t, { sites, quality: 'high' });
  const initial = meshes(runtime).map(mesh => ({ mesh, geometry: mesh.geometry, material: mesh.material, matrix: mesh.instanceMatrix, color: mesh.instanceColor, arrays: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, attr]) => [key, attr.array])) }));
  const point = { x: 0, y: 0, z: 0 };
  for (let i = 1; i <= 2400; i++) {
    point.x = Math.sin(i / 110) * 75; point.z = Math.cos(i / 130) * 75;
    runtime.update(1 / 60, i / 60, point, ['low', 'medium', 'high'][Math.floor(i / 240) % 3]);
    assert.ok(runtime.stats.fullVisible <= VEGETATION_TIERS[runtime.stats.quality].full); assert.ok(runtime.stats.visible <= VEGETATION_TIERS[runtime.stats.quality].total);
    for (const record of initial) assert.ok(record.mesh.count <= record.mesh.instanceMatrix.count);
  }
  for (const record of initial) {
    assert.equal(record.mesh.geometry, record.geometry); assert.equal(record.mesh.material, record.material); assert.equal(record.mesh.instanceMatrix, record.matrix); assert.equal(record.mesh.instanceColor, record.color);
    for (const [key, array] of Object.entries(record.arrays)) { assert.equal(record.geometry.attributes[key].array, array); finite(array); }
    finite(record.mesh.instanceMatrix.array); finite(record.mesh.instanceColor.array);
  }
  const versions = initial.map(record => record.matrix.version);
  for (let i = 0; i < 60; i++) runtime.update(1 / 60, 41 + i / 60, point);
  assert.deepEqual(initial.map(record => record.matrix.version), versions, 'stationary observer only updates shared time, not GPU instance buffers');
});

test('invalid placement data are skipped, absent alpha gets rooted fallback, and an empty colony is safe', async t => {
  const sites = [{ x: 0, z: 0 }, { x: NaN, z: 0 }, { x: 2, z: 0, y: Infinity }, { x: 2, z: 0, scale: 0 }, { x: 2, z: 0, targetHeight: -1 },
    { x: 2, z: 0, species: 'missing' }, { x: 2, z: 0, rotation: NaN }, { x: 1e100, z: 0 }, null];
  const { runtime } = await setup(t, { sites }, { alpha: false });
  assert.equal(runtime.stats.sites, 1); assert.equal(runtime.stats.skippedSites, sites.length - 1);
  const geometry = meshes(runtime)[0].geometry; assert.equal(geometry.attributes.aVegFlex.getX(0), 0); close(geometry.attributes.aVegFlex.getX(2), 1);
  const fallbackLow = meshes(runtime).find(mesh => mesh.userData.vegetation.lod === 'low').geometry;
  close(fallbackLow.attributes.aVegFlex.getX(2), fallbackLow.boundingBox.max.y / geometry.userData.vegetation.height);
  const previous = runtime.snapshot(); runtime.update(.1, 1, { x: NaN, y: 0, z: 0 }); assert.equal(runtime.stats.visible, previous.visible);
  const empty = await setup(t, { sites: [], quality: 'low' });
  assert.equal(empty.runtime.stats.visible, 0); assert.equal(empty.runtime.stats.pools, 0); assert.equal(empty.runtime.root.visible, false);
});

test('load rejection and malformed variants resolve false and report one graceful error', async () => {
  const reports = [];
  const runtime = createAbyssVegetation(new THREE.Scene(), { loader: { async loadAsync() { throw new Error('offline'); } }, onAsset: result => reports.push(result) });
  assert.equal(await runtime.ready, false); assert.equal(runtime.stats.status, 'error'); assert.equal(runtime.stats.error, 'offline');
  assert.deepEqual(reports, [{ id: 'vegetation', status: 'error', message: 'offline' }]);
  runtime.update(.1, 9, origin); runtime.setQuality('high'); runtime.dispose(); runtime.dispose();
  const malformed = fixture({ missing: 'sea_fan_low' });
  const other = createAbyssVegetation(new THREE.Scene(), { loader: { async loadAsync() { return malformed; } } });
  assert.equal(await other.ready, false); assert.match(other.stats.error, /sea_fan.*full and low/);
  assert.equal(other.root.children.length, 0);
  for (const item of malformed.resources) assert.equal(item.count, 1);
  assert.equal(malformed.image.closed, 1); other.dispose();
  for (const item of malformed.resources) assert.equal(item.count, 1);
});

test('nonfinite geometry, broken indices, multiple atlas maps and illegal decorators release owned resources', async () => {
  for (const mutate of [
    model => { model.nodes[0].geometry.attributes.position.array[0] = NaN; },
    model => { model.nodes[0].geometry.setIndex([0, 1, 99]); },
    model => { const material = track(new THREE.MeshStandardMaterial({ map: track(new THREE.Texture(), model.resources) }), model.resources); model.nodes[1].material = material; },
    model => { model.nodes[0].name = 'irrelevant'; },
  ]) {
    const model = fixture(); mutate(model);
    const runtime = createAbyssVegetation(new THREE.Scene(), { loader: { async loadAsync() { return model; } } });
    assert.equal(await runtime.ready, false); assert.equal(runtime.stats.status, 'error'); assert.equal(runtime.root.children.length, 0);
    runtime.dispose(); for (const entry of model.resources) assert.equal(entry.count, 1);
  }
  const model = fixture();
  const extraImage = { closed: 0, close() { this.closed++; } };
  const runtime = createAbyssVegetation(new THREE.Scene(), { loader: { async loadAsync() { return model; } }, materialDecorator(material) {
    material.map = track(new THREE.Texture(extraImage), model.resources);
    throw new Error('decorator failed');
  } });
  assert.equal(await runtime.ready, false); assert.match(runtime.stats.error, /decorator failed/); runtime.dispose();
  for (const entry of model.resources) assert.equal(entry.count, 1);
  assert.equal(extraImage.closed, 1);
});

test('dispose is exactly once for source/derived geometry, one material, textures, images and instance buffers', async () => {
  const { runtime, model, scene } = await setup(null, { sites: VEGETATION_SPECIES.map((species, x) => ({ x, z: 0, species })) }, { shared: true, extra: true });
  const runtimeResources = [];
  for (const mesh of meshes(runtime)) { track(mesh, runtimeResources); track(mesh.geometry, runtimeResources); }
  runtime.dispose(); runtime.dispose(); runtime.update(1, 55, origin); runtime.setQuality('high');
  assert.equal(runtime.stats.status, 'disposed'); assert.equal(runtime.stats.visible, 0); assert.equal(runtime.root.parent, null);
  assert.equal(runtime.root.children.length, 0); assert.ok(!scene.children.includes(runtime.root));
  for (const item of [...model.resources, ...runtimeResources]) assert.equal(item.count, 1);
  assert.equal(model.image.closed, 1); assert.ok(runtime.snapshot().variants.every(item => item.full === 0 && item.low === 0));
});

test('late resolve after disposal releases every shared asset exactly once and never resurrects the colony', async () => {
  let resolve; const model = fixture({ shared: true }), reports = [], scene = new THREE.Scene();
  const runtime = createAbyssVegetation(scene, { sites: [{ x: 0, z: 0 }], loader: { loadAsync: () => new Promise(done => { resolve = done; }) }, onAsset: result => reports.push(result) });
  runtime.dispose(); runtime.dispose(); resolve(model);
  assert.equal(await runtime.ready, false); assert.equal(runtime.stats.status, 'disposed'); assert.equal(runtime.root.parent, null); assert.equal(runtime.root.children.length, 0);
  assert.deepEqual(reports, []); for (const entry of model.resources) assert.equal(entry.count, 1); assert.equal(model.image.closed, 1);
  runtime.dispose(); for (const entry of model.resources) assert.equal(entry.count, 1);
});

test('throwing notifications do not turn a loaded colony into an error or leak resources', async t => {
  const { runtime } = await setup(t, { onAsset() { throw new Error('consumer report failure'); } });
  assert.equal(runtime.stats.status, 'ready'); assert.equal(runtime.stats.visible, 1);
});


test('re-entrant disposal by decoration, terrain, or ready notification cannot resurrect resources', async () => {
  for (const stage of ['materialDecorator', 'terrain', 'onAsset']) {
    const model = fixture({ shared: true }), scene = new THREE.Scene();
    let runtime;
    runtime = createAbyssVegetation(scene, { sites: [{ x: 0, z: 0 }], loader: { async loadAsync() { return model; } },
      [stage]: () => { runtime.dispose(); return stage === 'terrain' ? 0 : undefined; } });
    assert.equal(await runtime.ready, false);
    assert.equal(runtime.stats.status, 'disposed'); assert.equal(runtime.stats.visible, 0);
    assert.equal(runtime.root.parent, null); assert.equal(runtime.root.children.length, 0);
    runtime.dispose();
    for (const entry of model.resources) assert.equal(entry.count, 1);
    assert.equal(model.image.closed, 1);
  }
});
