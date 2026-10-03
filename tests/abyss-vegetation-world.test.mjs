// Actual final Blender GLB + production world + Three.js. Only PNG bitmap
// decoding is replaced in Node; this does not claim GPU compilation or pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createAbyssWorld, terrainHeight } from '../dist/abyss-world.js';
import { VEGETATION_SPECIES, VEGETATION_TIERS } from '../dist/abyss-vegetation.js';
import { createAbyssWorld as createBaselineWorld } from './fixtures/abyss-world-229ad9d.mjs';

const raw = await readFile(new URL('../dist/assets/abyss/vegetation.glb', import.meta.url));
const jsonSize = raw.readUInt32LE(12), document = JSON.parse(raw.subarray(20, 20 + jsonSize));
const binOffset = 20 + jsonSize, bin = raw.subarray(binOffset + 8, binOffset + 8 + raw.readUInt32LE(binOffset));
const expected = {
  ribbon_kelp: { height: 3.1, full: 1220, low: 132 }, split_kelp: { height: 1.8, full: 1042, low: 144 },
  eelgrass: { height: 1, full: 916, low: 132 }, red_algae: { height: .85, full: 1120, low: 152 },
  sea_fan: { height: 1.2, full: 1192, low: 188 }, plate_coral: { height: .65, full: 1080, low: 108 }
};
const close = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const finite = values => { for (const value of values) assert.ok(Number.isFinite(value), `Nonfinite: ${value}`); };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const hash = value => createHash('sha256').update(value).digest('hex');
const player = { x: 0, y: -24, z: 18, status: 'playing' };
const count = (text, expression) => (text.match(expression) || []).length;
function collect(root) {
  const nodes = [], geometries = new Set(), materials = new Set(), textures = new Set(), arrays = new Map();
  root.traverse(node => {
    nodes.push(node);
    if (node.geometry) {
      geometries.add(node.geometry);
      arrays.set(node.geometry, Object.fromEntries(Object.entries(node.geometry.attributes).map(([key, attribute]) => [key, attribute.array])));
    }
    if (node.instanceMatrix) arrays.set(node, { matrix: node.instanceMatrix.array, color: node.instanceColor?.array });
    for (const material of node.material ? Array.isArray(node.material) ? node.material : [node.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { nodes, geometries, materials, textures, arrays };
}
function track(resources) {
  const counts = new Map();
  for (const resource of resources) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); }
  return counts;
}
function assertOnce(counts) { for (const [resource, n] of counts) assert.equal(n, 1, `${resource.type || resource.name} disposed ${n} times`); }
function pngInfo(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), bitDepth = bytes[24], colorType = bytes[25];
  assert.equal(bitDepth, 8); assert.equal(bytes[28], 0, 'non-interlaced PNG');
  const parts = []; let at = 8, ended = false;
  while (at < bytes.length) {
    const size = bytes.readUInt32BE(at), type = bytes.subarray(at + 4, at + 8).toString();
    assert.ok(at + 12 + size <= bytes.length);
    if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + size));
    if (type === 'IEND') { ended = true; assert.equal(size, 0); }
    at += 12 + size;
  }
  assert.ok(ended); assert.equal(at, bytes.length);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]; assert.ok(channels);
  const rows = inflateSync(Buffer.concat(parts)); assert.equal(rows.length, height * (width * channels + 1));
  for (let y = 0; y < height; y++) assert.ok(rows[y * (width * channels + 1)] <= 4);
  return { width, height };
}
async function actualAsset() {
  const loader = new GLTFLoader();
  // Keep the full GLB, real texture-index/material/sampler parsing and every
  // attribute intact. Skip just browser-specific bitmap decoding into pixels.
  loader.register(parser => {
    const cache = new Map();
    parser.loadImageSource = source => {
      if (!cache.has(source)) cache.set(source, (async () => {
        const info = parser.json.images[source], buffer = Buffer.from(await parser.getDependency('bufferView', info.bufferView));
        const image = { ...pngInfo(buffer), closed: 0, close() { this.closed++; } };
        const texture = new THREE.Texture(image); texture.userData.bitmapDecodingSkipped = true; return texture;
      })());
      return cache.get(source);
    };
    return { name: 'NODE_skip_bitmap_decode_only' };
  });
  return loader.parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
}
async function readyWorld(t, options = {}) {
  const calls = [], reports = [];
  const world = createAbyssWorld(new THREE.Scene(), {
    vegetationLoader: { async loadAsync(url) { calls.push(url); return actualAsset(); } }, onAsset: event => reports.push(event), ...options
  });
  t.after(() => world.dispose());
  world.update(1 / 60, 1, player, 'high');
  assert.equal(await world.vegetation.ready, true, world.vegetation.stats.error);
  return { world, calls, reports };
}
function fingerprint(world, kind) {
  const h = createHash('sha256'), geometries = new Set();
  world.root.traverse(node => {
    if (node.userData.vegetation) return;
    if (kind === 'terrain' && node.isMesh && node.geometry.type === 'PlaneGeometry' && node.geometry.parameters.width === 55)
      for (const attribute of Object.values(node.geometry.attributes)) h.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    if (kind === 'instances' && node.isInstancedMesh) {
      h.update(new Uint8Array(node.instanceMatrix.array.buffer));
      if (node.instanceColor) h.update(new Uint8Array(node.instanceColor.array.buffer));
    }
    if (kind === 'particles' && node.isPoints) for (const attribute of Object.values(node.geometry.attributes)) h.update(new Uint8Array(attribute.array.buffer));
    // The frozen fixture excludes rendering-only surface/shafts. Also retain
    // every original prop/landmark geometry, including index and attribute shape.
    if (kind === 'geometry' && node.isMesh && node.name !== 'Ocean surface / underside optics' && node.parent?.name !== 'Soft light shafts' && !geometries.has(node.geometry)) {
      const geometry = node.geometry; geometries.add(geometry);
      h.update(geometry.type);
      for (const [name, attribute] of Object.entries({ ...geometry.attributes, index: geometry.index })) {
        h.update(JSON.stringify([name, attribute?.array.constructor.name, attribute?.itemSize, attribute?.normalized, attribute?.count]));
        if (attribute) h.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      }
    }
  });
  return h.digest('hex');
}

// Freeze expectations from the actual pre-integration generator in this engine,
// never from the current world. Comparisons remain exact bytes/numbers: no
// rounding, epsilon or platform-hash allowlist. This runs in source ZIPs too.
const originalWorld = (() => {
  const world = createBaselineWorld(new THREE.Scene());
  try {
    return {
      fingerprints: Object.fromEntries(['terrain', 'instances', 'particles', 'geometry'].map(kind => [kind, fingerprint(world, kind)])),
      colliders: structuredClone(world.colliders), airBell: { ...world.airBell },
      landmarks: Object.fromEntries(Object.entries(world.landmarks).map(([id, target]) => [id, target.position.toArray()]))
    };
  } finally { world.dispose(); }
})();
function assertOriginalWorld(world) {
  for (const [kind, expected] of Object.entries(originalWorld.fingerprints)) assert.equal(fingerprint(world, kind), expected, kind);
  assert.deepEqual(world.colliders, originalWorld.colliders, 'colliders');
  assert.deepEqual(world.airBell, originalWorld.airBell, 'air bell');
  assert.deepEqual(Object.fromEntries(Object.entries(world.landmarks).map(([id, target]) => [id, target.position.toArray()])), originalWorld.landmarks, 'landmarks');
}

test('final Blender GLB has exact bytes, species/LOD budgets, one opaque atlas and three bounded embedded PNGs', async () => {
  assert.equal(raw.length, 1586968); assert.equal(hash(raw), '84fac5f7e06cf021ca2993648f5562ec0c9adbc8abd2a9f5808c2e9ab713c3fa');
  assert.equal(raw.readUInt32LE(0), 0x46546c67); assert.equal(raw.readUInt32LE(4), 2); assert.equal(raw.readUInt32LE(8), raw.length);
  assert.equal(raw.readUInt32LE(16), 0x4e4f534a); assert.equal(raw.readUInt32LE(binOffset + 4), 0x004e4942);
  assert.equal(document.nodes.length, 12); assert.equal(document.meshes.length, 12); assert.equal(document.materials.length, 1);
  assert.equal(document.materials[0].alphaMode || 'OPAQUE', 'OPAQUE'); assert.equal(document.materials[0].doubleSided, true);
  assert.ok(!document.materials[0].extensions?.KHR_materials_transmission); assert.ok(!document.skins?.length); assert.ok(!document.animations?.length);
  assert.ok(document.buffers.every(buffer => !buffer.uri));
  for (const view of document.bufferViews) assert.ok((view.byteOffset || 0) + view.byteLength <= bin.length);
  const dimensions = [];
  for (const image of document.images) {
    assert.ok(Number.isInteger(image.bufferView)); assert.ok(!image.uri); assert.equal(image.mimeType, 'image/png');
    const view = document.bufferViews[image.bufferView]; dimensions.push(pngInfo(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)));
  }
  assert.deepEqual(dimensions.map(({ width, height }) => [width, height]).sort(), [[512, 512], [512, 512], [1024, 1024]].sort());
  const names = [];
  for (const node of document.nodes) {
    const match = /^veg_(.+)_(full|low)$/.exec(node.name); assert.ok(match); const [, species, lod] = match;
    names.push(node.name); assert.deepEqual(node.translation || [0, 0, 0], [0, 0, 0]); assert.deepEqual(node.scale || [1, 1, 1], [1, 1, 1]);
    assert.deepEqual(node.rotation || [0, 0, 0, 1], [0, 0, 0, 1]); assert.ok(!node.matrix);
    const mesh = document.meshes[node.mesh]; assert.equal(mesh.primitives.length, 1);
    const primitive = mesh.primitives[0]; assert.equal(primitive.material, 0); assert.equal(primitive.mode ?? 4, 4);
    assert.equal(document.accessors[primitive.indices].count / 3, expected[species][lod]);
    assert.deepEqual(Object.keys(primitive.attributes).sort(), ['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0']);
    assert.equal(document.accessors[primitive.attributes.COLOR_0].type, 'VEC4');
  }
  assert.deepEqual(names.sort(), VEGETATION_SPECIES.flatMap(species => ['full', 'low'].map(lod => `veg_${species}_${lod}`)).sort());
  const model = await actualAsset(), resources = collect(model.scene), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  try {
    assert.equal(resources.materials.size, 1); assert.equal(resources.textures.size, 3);
    for (const node of resources.nodes.filter(node => node.isMesh)) {
      const [, species, lod] = /^veg_(.+)_(full|low)$/.exec(node.name), geometry = node.geometry, positions = geometry.attributes.position;
      for (const attribute of Object.values(geometry.attributes)) finite(attribute.array);
      geometry.computeBoundingBox(); close(geometry.boundingBox.min.y, 0); close(geometry.boundingBox.max.y, expected[species].height);
      assert.equal(geometry.index.count / 3, expected[species][lod]);
      const alpha = geometry.attributes.color; assert.equal(alpha.itemSize, 4);
      let min = 1, max = 0;
      for (let i = 0; i < alpha.count; i++) { min = Math.min(min, alpha.getW(i)); max = Math.max(max, alpha.getW(i)); }
      close(min, 0); close(max, 1);
      for (let i = 0; i < geometry.index.count; i += 3) {
        const ids = [geometry.index.getX(i), geometry.index.getX(i + 1), geometry.index.getX(i + 2)];
        assert.ok(ids.every(index => index >= 0 && index < positions.count));
        a.fromBufferAttribute(positions, ids[0]); b.fromBufferAttribute(positions, ids[1]); c.fromBufferAttribute(positions, ids[2]);
        assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-14, 'no degenerate triangle');
      }
    }
  } finally { for (const resource of [...resources.geometries, ...resources.materials, ...resources.textures]) resource.dispose(); }
});

test('world gate leaves menu and pause empty, starts once on a real dive, then replaces old plants atomically', async t => {
  let deliver; const calls = [], reports = [];
  const world = createAbyssWorld(new THREE.Scene(), { vegetationAssetURL: 'local-vegetation.glb', vegetationLoader: { loadAsync(url) { calls.push(url); return new Promise(resolve => { deliver = resolve; }); } }, onAsset: event => reports.push(event) });
  t.after(() => world.dispose());
  const original = collect(world.root), fallbacks = original.nodes.filter(node => node.userData.vegetationFallback);
  assert.equal(world.vegetation.root.parent, world.root); assert.equal(world.vegetation.root.children.length, 0); assert.equal(world.stats.vegetation.status, 'idle');
  assert.ok(fallbacks.some(node => node.visible)); assert.equal(world.stats.vegetation.fallbackActive, true);
  for (const dt of [0, -1, NaN, Infinity]) world.update(dt, 200, player);
  for (const position of [{ x: 0, y: -4.4, z: 18 }, { ...player, status: 'menu' }, { ...player, status: 'paused' }]) world.update(1 / 60, 10, position);
  await flush(); assert.equal(calls.length, 0); assert.deepEqual(collect(world.root).nodes, original.nodes);
  world.update(1 / 60, 11, player); await flush();
  assert.deepEqual(calls, ['local-vegetation.glb']); assert.equal(world.stats.vegetation.status, 'loading'); assert.ok(fallbacks.some(node => node.visible));
  world.update(1 / 60, 12, player); assert.equal(calls.length, 1);
  deliver(await actualAsset()); assert.equal(await world.vegetation.ready, true);
  assert.deepEqual(reports, [{ id: 'vegetation', status: 'ready' }]); assert.equal(world.stats.vegetation.status, 'ready');
  assert.equal(world.stats.vegetation.fallbackActive, false); assert.ok(fallbacks.every(node => !node.visible));
  assert.equal(world.stats.materials, 17); assert.equal(world.stats.geometries, 75);
  assert.equal(world.stats.materials, collect(world.root).materials.size); assert.equal(world.stats.geometries, collect(world.root).geometries.size);
  for (const quality of ['low', 'high', 'medium']) { world.setQuality(quality); world.update(1, 15, player); assert.ok(fallbacks.every(node => !node.visible)); }
});

test('actual imported atlas composes one water path, one caustic pass and only the adapter bend; pause freezes both clocks', async t => {
  const { world } = await readyWorld(t), meshes = world.vegetation.root.children;
  assert.equal(meshes.length, 12); assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 1);
  const material = meshes[0].material;
  assert.ok(material.map?.isTexture && material.normalMap?.isTexture && material.roughnessMap?.isTexture);
  assert.equal(material.metalnessMap, material.roughnessMap);
  // The final Blender export binds the ORM image as metallic-roughness only;
  // preserve the source contract instead of inventing an occlusion assignment.
  assert.equal(material.aoMap, null); assert.ok(!document.materials[0].occlusionTexture);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace); assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.transparent, false); assert.equal(material.opacity, 1); assert.equal(material.alphaTest, 0); assert.equal(material.alphaMap, null); assert.equal(material.depthWrite, true);
  for (const mesh of meshes) { assert.equal(mesh.geometry.attributes.color.itemSize, 3); assert.ok(mesh.geometry.attributes.aVegFlex); }
  const library = material.isMeshPhysicalMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader: library.vertexShader, fragmentShader: library.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.equal(count(shader.vertexShader, /transformed \+= vegOffset;/g), 1); assert.equal(count(shader.vertexShader, /varying vec3 vAbyssWorld/g), 1);
  assert.equal(count(shader.fragmentShader, /float waterPath=length/g), 1); assert.equal(count(shader.fragmentShader, /outgoingLight\*=waterTransmission/g), 1);
  assert.equal(count(shader.fragmentShader, /outgoingLight\+=vec3\(\.075,\.22,\.19\)/g), 1); assert.equal(count(shader.fragmentShader, /#include <fog_fragment>/g), 0);
  assert.ok(!shader.vertexShader.includes('pow(max(position.y,0.)/4.')); assert.ok(material.customProgramCacheKey().startsWith('abyss-caustics-water-v3-0|'));
  world.update(.1, 37, player); assert.equal(shader.uniforms.uAbyssTime.value, 37); assert.equal(shader.uniforms.uVegTime.value, 37);
  const matrices = meshes.map(mesh => mesh.instanceMatrix.array.slice());
  for (let n = 0; n < 60; n++) world.update(0, 1000 + n, { ...player, status: 'paused' });
  assert.equal(shader.uniforms.uAbyssTime.value, 37); assert.equal(shader.uniforms.uVegTime.value, 37);
  meshes.forEach((mesh, index) => assert.deepEqual(mesh.instanceMatrix.array, matrices[index]));
});

test('all pre-integration terrain, seeded props/particles, objectives and collider data remain byte-identical', async t => {
  const { world } = await readyWorld(t); assertOriginalWorld(world);
  const colliders = world.colliders, refs = [...colliders], airBell = { ...world.airBell };
  for (let n = 0; n < 120; n++) world.update(.5, n, { x: Math.sin(n) * 180, y: -45, z: 50 - n * 2 }, ['low', 'medium', 'high'][n % 3]);
  assertOriginalWorld(world); assert.equal(world.colliders, colliders); world.colliders.forEach((value, i) => assert.equal(value, refs[i])); assert.deepEqual(world.airBell, airBell);
});

test('same-runtime world baseline rejects even one-ULP placement, collider and geometry changes', t => {
  const world = createAbyssWorld(new THREE.Scene()); t.after(() => world.dispose());
  assertOriginalWorld(world);
  const instance = collect(world.root).nodes.find(node => node.isInstancedMesh && !node.userData.vegetation);
  const matrix = instance.instanceMatrix.array, placement = matrix[12];
  // Integer views flip the last mantissa bit in-place, without any rounding or
  // assumed cross-platform numeric answer. Each mutation is one representable step.
  new Uint32Array(matrix.buffer, matrix.byteOffset + 12 * 4, 1)[0] ^= 1;
  assert.notEqual(matrix[12], placement);
  assert.throws(() => assertOriginalWorld(world), { code: 'ERR_ASSERTION', message: /instances/ });
  matrix[12] = placement;
  const radius = world.colliders[0].radius, changedRadius = new Float64Array([radius]);
  new BigUint64Array(changedRadius.buffer)[0] ^= 1n; world.colliders[0].radius = changedRadius[0];
  assert.notEqual(world.colliders[0].radius, radius);
  assert.throws(() => assertOriginalWorld(world), { code: 'ERR_ASSERTION', message: /colliders/ });
  world.colliders[0].radius = radius;
  const positions = instance.geometry.attributes.position.array, vertex = positions[0];
  new Uint32Array(positions.buffer, positions.byteOffset, 1)[0] ^= 1;
  assert.notEqual(positions[0], vertex);
  assert.throws(() => assertOriginalWorld(world), { code: 'ERR_ASSERTION', message: /geometry/ });
  positions[0] = vertex;
  assertOriginalWorld(world);
});

test('all six species reuse original sites, stay metre-scaled, and plate colonies are inset into exact rock tops', async t => {
  const { world } = await readyWorld(t), legacy = collect(world.root).nodes.filter(node => node.isInstancedMesh && !node.userData.vegetation);
  const roots = new Map(), rocks = new Map(), matrix = new THREE.Matrix4(), probe = new THREE.Mesh(), ray = new THREE.Raycaster();
  ray.ray.direction.set(0, -1, 0);
  const key = (x, z) => `${x}:${z}`;
  for (const mesh of legacy) {
    if (mesh.userData.vegetationFallback) for (let i = 0; i < mesh.instanceMatrix.count; i++) {
      mesh.getMatrixAt(i, matrix); const e = matrix.elements; roots.set(key(e[12], e[14]), e[13]);
    }
    if (mesh.geometry.type === 'IcosahedronGeometry') for (let i = 0; i < mesh.instanceMatrix.count; i++) {
      mesh.getMatrixAt(i, matrix); const e = matrix.elements; rocks.set(key(e[12], e[14]), { matrix: matrix.clone(), geometry: mesh.geometry, material: mesh.material });
    }
  }
  const seen = new Map(), counts = new Map(), scale = new THREE.Vector3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  for (let z = -214; z <= 78; z += 22) for (let x = -209; x <= 209; x += 22) {
    world.update(.4, 2, { x, y: terrainHeight(x, z) + 3, z }, 'high');
    const snapshot = world.vegetation.snapshot(); assert.ok(snapshot.fullVisible <= 96 && snapshot.visible <= 320); assert.ok(snapshot.drawCalls <= 12);
    for (const mesh of world.vegetation.root.children) for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
      const species = mesh.userData.vegetation.species, id = key(position.x, position.z), old = seen.get(id);
      if (old) { assert.equal(old, species); continue; } seen.set(id, species); counts.set(species, (counts.get(species) || 0) + 1);
      const height = scale.y * mesh.geometry.userData.vegetation.height; finite([...matrix.elements, height]);
      close(scale.x, scale.y); close(scale.y, scale.z);
      if (species === 'ribbon_kelp' || species === 'split_kelp') assert.ok(height >= 3 - 1e-5 && height <= 7.8 + 1e-5);
      else assert.ok(height >= 1 - 1e-5 && height <= (species === 'eelgrass' ? 2 : 3.6) + 1e-5);
      if (species !== 'plate_coral') { assert.ok(roots.has(id)); close(position.y, roots.get(id)); }
      else {
        const rock = rocks.get(id); assert.ok(rock, 'plates use original rock centres');
        probe.geometry = rock.geometry; probe.material = rock.material; probe.matrix.copy(rock.matrix); probe.matrixAutoUpdate = false; probe.updateMatrixWorld(true);
        ray.ray.origin.set(position.x, position.y + 20, position.z); const hit = ray.intersectObject(probe, false)[0]; assert.ok(hit); close(position.y, hit.point.y - .07, 2e-5);
      }
    }
  }
  assert.deepEqual([...counts.keys()].sort(), [...VEGETATION_SPECIES].sort());
  assert.equal(seen.size, world.vegetation.stats.sites); assert.equal(seen.size - counts.get('plate_coral'), world.stats.kelp + world.stats.fans);
  assert.ok(counts.get('plate_coral') > 40); assert.ok(world.vegetation.stats.sites < 1800);
});

test('loaded world maintains finite fixed resource/buffer identities and global quality budgets over 1800 frames', async t => {
  const { world, calls } = await readyWorld(t), before = collect(world.root), stats = world.stats.vegetation;
  for (let n = 0; n < 1800; n++) {
    const quality = ['low', 'medium', 'high'][Math.floor(n / 120) % 3], tier = VEGETATION_TIERS[quality];
    world.update(1 / 60, n / 60, { x: Math.sin(n * .013) * 180, y: -22 - (n % 600) / 12, z: 55 - n % 280 }, quality);
    assert.equal(world.stats.vegetation, stats); assert.equal(stats.quality, quality); assert.ok(stats.fullVisible <= tier.full); assert.ok(stats.visible <= tier.total);
    assert.equal(stats.visible, stats.fullVisible + stats.lowVisible); assert.ok(stats.drawCalls <= 12);
  }
  const after = collect(world.root); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.geometries, before.geometries); assert.deepEqual(after.materials, before.materials);
  for (const [resource, attributes] of before.arrays) for (const [key, values] of Object.entries(attributes)) {
    const actual = resource.isInstancedMesh ? key === 'matrix' ? resource.instanceMatrix.array : resource.instanceColor?.array : resource.attributes[key].array;
    assert.equal(actual, values); if (actual) finite(actual);
  }
  assert.deepEqual(calls, ['./assets/abyss/vegetation.glb']); assert.equal(stats.materials, 1); assert.equal(stats.geometries, 12); assert.equal(stats.pools, 12);
  world.update(.1, 40, { x: 10000, y: -30, z: 10000 }, 'high'); assert.equal(stats.visible, 0); assert.equal(world.vegetation.root.visible, false);
});

test('loader rejection and invalid actual GLB retain procedural fallback without repeated attempts', async t => {
  for (const malformed of [false, true]) {
    let calls = 0; const reports = [];
    const world = createAbyssWorld(new THREE.Scene(), { vegetationLoader: { async loadAsync() { calls++; if (!malformed) throw new Error('offline fixture'); const gltf = await actualAsset(); gltf.scene.children[0].name = 'veg_incomplete_full'; return gltf; } }, onAsset: report => reports.push(report) });
    t.after(() => world.dispose());
    const before = collect(world.root); world.update(.1, 1, player); assert.equal(await world.vegetation.ready, false);
    assert.equal(world.stats.vegetation.status, 'error'); assert.equal(world.stats.vegetation.fallbackActive, true); assert.equal(reports.length, 1); assert.equal(reports[0].status, 'error');
    for (let n = 0; n < 30; n++) world.update(.5, n, player, ['low', 'high'][n % 2]);
    assert.equal(calls, 1); assert.ok(before.nodes.filter(node => node.userData.vegetationFallback).some(node => node.visible));
    assert.deepEqual(collect(world.root).nodes, before.nodes); assert.equal(world.stats.materials, 16); assert.equal(world.stats.geometries, 63); assertOriginalWorld(world);
  }
});

test('disposing before gate or its queued continuation starts prevents all fetches and settles ready false', async () => {
  for (const requested of [false, true]) {
    const scene = new THREE.Scene(), previousFog = new THREE.Fog(0, 1, 10), previousBackground = new THREE.Color(0x123456); scene.fog = previousFog; scene.background = previousBackground;
    let calls = 0; const world = createAbyssWorld(scene, { vegetationLoader: { async loadAsync() { calls++; return actualAsset(); } } });
    const before = collect(world.root), counts = track([...before.geometries, ...before.materials]);
    if (requested) world.update(.1, 1, player);
    world.dispose(); world.dispose(); world.setQuality('high'); world.update(1, 100, player);
    assert.equal(await world.vegetation.ready, false); assert.equal(calls, 0); assertOnce(counts);
    assert.equal(world.stats.vegetation.status, 'disposed'); assert.equal(scene.fog, previousFog); assert.equal(scene.background, previousBackground); assert.ok(!scene.children.includes(world.root));
  }
});

test('late real GLB and ready-world disposal release every owned atlas/geometry/pool once', async () => {
  for (const late of [true, false]) {
    const model = await actualAsset(), source = collect(model.scene), sourceCounts = track([...source.geometries, ...source.materials, ...source.textures]);
    const images = [...source.textures].map(texture => texture.image); let deliver;
    const scene = new THREE.Scene(), reports = [], world = createAbyssWorld(scene, { vegetationLoader: { loadAsync() { return new Promise(resolve => { deliver = resolve; }); } }, onAsset: report => reports.push(report) });
    world.update(.1, 4, player); await flush();
    if (late) world.dispose(); deliver(model); assert.equal(await world.vegetation.ready, !late);
    const runtime = collect(world.vegetation.root), runtimeCounts = track([...runtime.geometries, ...runtime.nodes.filter(node => node.isInstancedMesh)]);
    world.dispose(); world.dispose(); world.update(.1, 10, player); assertOnce(sourceCounts); assertOnce(runtimeCounts);
    assert.ok(images.every(image => image.closed === 1)); assert.equal(reports.length, late ? 0 : 1); assert.equal(world.vegetation.root.children.length, 0); assert.ok(!scene.children.includes(world.root));
  }
});
