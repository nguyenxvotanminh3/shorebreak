// Real Three.js and the complete Blender GLB. Node replaces PNG bitmap decode
// only; these are structural/CPU checks, not a WebGL compile or frame-rate claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { terrainHeight as baseTerrain } from './fixtures/abyss-world-229ad9d.mjs';
import { sampleIslandTerrain, sampleIslandInfluence, distanceToIslandPath, ISLAND_LAYOUT, ISLAND_SAFE_PATH, ISLET_SAFE_PATH } from '../dist/abyss-island-terrain.js';
import { createIslandWorld, ISLAND_SPECIES, ISLAND_TIERS, ISLAND_DRAW_LIMIT, ISLAND_ASSET_URL, sampleIslandWind } from '../dist/abyss-island-world.js';

const raw = await readFile(new URL('../dist/assets/abyss/island/coast_ecosystem.glb', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../dist/assets/abyss/island/manifest.json', import.meta.url), 'utf8'));
const document = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)));
const terrain = (x, z) => sampleIslandTerrain(x, z, baseTerrain);
const close = (actual, expected, epsilon = 1e-4) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const finite = array => { for (const value of array) assert.ok(Number.isFinite(value), `Nonfinite value: ${value}`); };
const near = { x: 115, y: 15, z: 155 };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const instanceMeshes = world => world.root.children.filter(node => node.isInstancedMesh);
const terrainMeshes = world => world.root.children.filter(node => node.userData.islandTerrain);

function pngInfo(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[25]];
  assert.equal(bytes[24], 8); assert.equal(bytes[28], 0); assert.ok(channels);
  let offset = 8, ended = false; const parts = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString();
    assert.ok(offset + 12 + length <= bytes.length);
    if (type === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') ended = true;
    offset += 12 + length;
  }
  assert.ok(ended); assert.equal(offset, bytes.length);
  const rows = inflateSync(Buffer.concat(parts)); assert.equal(rows.length, height * (width * channels + 1));
  return { width, height };
}
async function actualAsset() {
  const loader = new GLTFLoader();
  loader.register(parser => {
    const cache = new Map();
    parser.loadImageSource = source => {
      if (!cache.has(source)) cache.set(source, (async () => {
        const info = parser.json.images[source], bytes = Buffer.from(await parser.getDependency('bufferView', info.bufferView));
        const image = { ...pngInfo(bytes), closed: 0, close() { this.closed++; } };
        return new THREE.Texture(image);
      })());
      return cache.get(source);
    };
    return { name: 'NODE_skip_bitmap_decode_only' };
  });
  return loader.parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
}
function resources(root) {
  const all = new Set(), images = new Set();
  root.traverse(node => {
    if (node.isInstancedMesh) all.add(node);
    if (node.geometry) all.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      all.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        all.add(value); const image = value.source?.data || value.image;
        if (image?.close) images.add(image);
      }
    }
  });
  return { all, images };
}
function track(resources) {
  const counts = new Map();
  for (const resource of resources) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); }
  return counts;
}
function once(counts) { for (const [resource, count] of counts) assert.equal(count, 1, `${resource.name || resource.type}: ${count} releases`); }
async function readyWorld(t, options = {}) {
  const gltf = await actualAsset(), calls = [], reports = [];
  const scene = new THREE.Scene();
  const world = createIslandWorld(scene, { terrain, loader: { async loadAsync(url) { calls.push(url); return gltf; } }, onAsset: event => reports.push(event), ...options });
  t.after(() => world.dispose());
  world.update(1 / 60, 1, near, 'high');
  assert.equal(await world.ready, true, world.stats.error);
  return { world, gltf, calls, reports, scene };
}

test('immutable manifest-matched fifteen-species and global budgets', () => {
  assert.ok(Object.isFrozen(ISLAND_SPECIES)); assert.ok(Object.isFrozen(ISLAND_TIERS));
  assert.equal(ISLAND_SPECIES.length, 15); assert.equal(ISLAND_DRAW_LIMIT, 30);
  assert.deepEqual(Object.values(ISLAND_TIERS).map(tier => [tier.full, tier.total]), [[80, 500], [40, 320], [0, 180]]);
  for (const species of ISLAND_SPECIES) {
    assert.ok(Object.isFrozen(species));
    const source = manifest.assets.find(asset => asset.id === species.id); assert.ok(source);
    close(species.radius, source.collision_radius_m); close(species.trunkHeight, source.clear_trunk_height_m);
    close(species.height, source.lods[0].bounds_gltf.max[1]);
    assert.equal(species.slopeLimit, source.placement.slope_limit_degrees);
  }
});

test('actual GLB has thirty rooted UV1 prototypes, one opaque 512 atlas, no vertex tint', async () => {
  assert.equal(raw.readUInt32LE(0), 0x46546c67); assert.equal(raw.readUInt32LE(8), raw.length);
  assert.equal(document.nodes.length, 30); assert.equal(document.meshes.length, 30);
  assert.equal(document.materials.length, 1); assert.equal(document.images.length, 1);
  assert.equal(document.materials[0].alphaMode || 'OPAQUE', 'OPAQUE');
  assert.equal(document.materials[0].doubleSided, true);
  for (const species of ISLAND_SPECIES) for (const lod of [0, 1]) {
    const node = document.nodes.find(node => node.name === `${species.id}_LOD${lod}`); assert.ok(node);
    const mesh = document.meshes[node.mesh]; assert.equal(mesh.primitives.length, 1);
    const primitive = mesh.primitives[0]; assert.ok('TEXCOORD_1' in primitive.attributes); assert.equal('COLOR_0' in primitive.attributes, false);
    const position = document.accessors[primitive.attributes.POSITION], uv1 = document.accessors[primitive.attributes.TEXCOORD_1];
    close(position.min[1], 0); assert.equal(position.count, uv1.count); assert.equal(uv1.type, 'VEC2');
    const triangles = document.accessors[primitive.indices].count / 3;
    assert.equal(triangles, manifest.assets.find(asset => asset.id === species.id).lods[lod].triangles);
  }
  const model = await actualAsset(), owned = resources(model.scene);
  try { assert.equal(owned.images.size, 1); for (const image of owned.images) assert.deepEqual([image.width, image.height], [512, 512]); }
  finally { for (const item of owned.all) item.dispose(); for (const image of owned.images) image.close(); }
});

test('five fixed terrain tiles sample actual height and seamless analytic normals without unchanged-floor triangles', t => {
  const world = createIslandWorld(new THREE.Scene(), { terrain }); t.after(() => world.dispose());
  assert.equal(world.stats.terrainTiles, 5); assert.ok(world.stats.terrainTriangles < 40000);
  const boundary = new Map(); let triangleCount = 0;
  for (const mesh of terrainMeshes(world)) {
    const { position, normal, color } = mesh.geometry.attributes;
    finite(position.array); finite(normal.array); finite(color.array);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      close(y, terrain(x, z), .00015);
      close(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)), 1);
      const key = `${x}:${z}`, vector = [normal.getX(i), normal.getY(i), normal.getZ(i)];
      if (boundary.has(key)) assert.deepEqual(vector, boundary.get(key)); else boundary.set(key, vector);
    }
    const index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      let influence = 0;
      for (let j = 0; j < 3; j++) { const vertex = index.getX(i + j); influence = Math.max(influence, sampleIslandInfluence(position.getX(vertex), position.getZ(vertex))); }
      assert.ok(influence > .0000008, 'zero-uplift floor face must be omitted'); triangleCount++;
    }
  }
  assert.equal(triangleCount, world.stats.terrainTriangles);
  world.update(.1, 1, { x: 1000, y: -120, z: -1000 }, 'low'); assert.equal(world.stats.visibleTiles, 0); assert.equal(world.root.visible, false);
});

test('deterministic biome placement is rooted, manifest-scaled, slope-limited and clears both routes', t => {
  const a = createIslandWorld(new THREE.Scene(), { terrain }), b = createIslandWorld(new THREE.Scene(), { terrain });
  t.after(() => { a.dispose(); b.dispose(); });
  assert.deepEqual(a.snapshot().sites, b.snapshot().sites); assert.deepEqual(a.colliders, b.colliders);
  const sites = a.snapshot().sites; assert.ok(sites.length > 450);
  assert.equal(new Set(sites.map(site => site.species)).size, 15);
  assert.ok(sites.some(site => site.x < 0), 'islet receives its own ecosystem');
  for (const site of sites) {
    const spec = ISLAND_SPECIES[site.speciesIndex];
    assert.equal(site.y, terrain(site.x, site.z)); assert.ok(site.y >= .32);
    assert.ok(site.scale >= .82 && site.scale <= 1.18); assert.ok(site.slope <= spec.slopeLimit);
    assert.ok(distanceToIslandPath(site.x, site.z) >= site.clearance);
    close(site.matrix[12], site.x); close(site.matrix[13], site.y); close(site.matrix[14], site.z);
    finite(site.matrix);
  }
  for (const collider of a.colliders) {
    const site = sites.find(site => site.x === collider.x && site.z === collider.z); assert.ok(site);
    const spec = ISLAND_SPECIES[site.speciesIndex]; assert.ok(site.speciesIndex < 8 || site.speciesIndex >= 12);
    close(collider.radius, spec.radius * site.scale);
    close(collider.height, (site.speciesIndex < 8 ? spec.trunkHeight : spec.height) * site.scale);
    close(collider.y - collider.height / 2, site.y);
    assert.ok(distanceToIslandPath(collider.x, collider.z) - collider.radius >= 4);
  }
  for (const point of [...ISLAND_SAFE_PATH, ...ISLET_SAFE_PATH]) {
    for (const collider of a.colliders) assert.ok(Math.hypot(point.x - collider.x, point.z - collider.z) > collider.radius + 3.99);
  }
});

test('rendered triangles stay within 7.5cm of the analytic walking floor on both 4m-wide routes', t => {
  const world = createIslandWorld(new THREE.Scene(), { terrain }); t.after(() => world.dispose());
  const tiles = terrainMeshes(world).map(mesh => {
    const positions = mesh.geometry.attributes.position; let columns = 1;
    while (columns < positions.count && positions.getZ(columns) === positions.getZ(0)) columns++;
    return { positions, columns, rows: positions.count / columns,
      x0: positions.getX(0), z0: positions.getZ(0), x1: positions.getX(columns - 1), z1: positions.getZ(positions.count - 1) };
  });
  function renderedHeight(x, z) {
    for (const tile of tiles) {
      if (x < tile.x0 || x > tile.x1 || z < tile.z0 || z > tile.z1) continue;
      const u = (x - tile.x0) / (tile.x1 - tile.x0) * (tile.columns - 1), v = (z - tile.z0) / (tile.z1 - tile.z0) * (tile.rows - 1);
      const ix = Math.min(tile.columns - 2, Math.floor(u)), iz = Math.min(tile.rows - 2, Math.floor(v)), fx = u - ix, fz = v - iz;
      const a = iz * tile.columns + ix, b = a + 1, c = a + tile.columns, d = c + 1, p = tile.positions;
      // Exact barycentric height for the renderer's a,c,b and b,c,d faces.
      return fx + fz <= 1 ? p.getY(a) + (p.getY(b) - p.getY(a)) * fx + (p.getY(c) - p.getY(a)) * fz
        : p.getY(d) + (p.getY(c) - p.getY(d)) * (1 - fx) + (p.getY(b) - p.getY(d)) * (1 - fz);
    }
    assert.fail('Walking route fell outside island tiles');
  }
  for (const path of [ISLAND_SAFE_PATH, ISLET_SAFE_PATH]) for (const lateral of [-2, 0, 2]) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), steps = Math.ceil(length / .1);
      for (let j = 0; j <= steps; j++) {
        const x = a.x + dx * j / steps - dz / length * lateral, z = a.z + dz * j / steps + dx / length * lateral;
        close(renderedHeight(x, z), terrain(x, z), .075);
      }
    }
  }
});

test('lazy proximity load does not block terrain/fallback, starts once and reports the verified asset', async t => {
  let resolve, calls = 0; const reports = [], model = await actualAsset();
  const world = createIslandWorld(new THREE.Scene(), { terrain, loader: { loadAsync(url) { assert.equal(url, ISLAND_ASSET_URL); calls++; return new Promise(done => { resolve = done; }); } }, onAsset: event => reports.push(event) });
  t.after(() => world.dispose());
  assert.equal(calls, 0); assert.equal(world.stats.status, 'deferred'); assert.equal(world.stats.fallback, true);
  assert.equal(terrainMeshes(world).length, 5); assert.ok(instanceMeshes(world).length > 0);
  const fallbackResources = track(resources(world.root).all);
  // The original diver start and the deep rig do not request island assets.
  world.update(.1, 1, { x: 0, y: -4, z: 18 });
  world.update(.1, 2, { x: 115, y: -100, z: 155 }); await tick(); assert.equal(calls, 0);
  world.update(.1, 3, near, 'high'); await tick(); assert.equal(calls, 1); assert.equal(world.stats.status, 'loading');
  assert.ok(world.stats.visible > 0); assert.ok(world.stats.drawCalls <= 30);
  for (let i = 0; i < 20; i++) world.update(.1, 4 + i, near, 'low'); await tick(); assert.equal(calls, 1);
  resolve(model); assert.equal(await world.ready, true); assert.equal(world.stats.fallback, false); assert.equal(world.stats.quality, 'low');
  assert.deepEqual(reports, [{ id: 'island', status: 'ready' }]);
  assert.equal(instanceMeshes(world).length, 30); assert.equal(world.stats.geometries, 35); assert.equal(world.stats.materials, 2);
  for (const [resource, count] of fallbackResources) {
    const terrainResource = terrainMeshes(world).some(mesh => mesh.geometry === resource || mesh.material === resource);
    assert.equal(count, terrainResource ? 0 : 1);
  }
});

test('hard instance and draw budgets across dense placement, all tiers and nearest selection', async t => {
  // A level analytic test island stresses every global cap independently from
  // the real mountain's naturally sparse steep areas.
  const { world } = await readyWorld(t, { terrain: () => 3 });
  for (const name of ['high', 'medium', 'low', 'high']) {
    world.update(.1, 2, { x: 115, y: 3, z: 155 }, name);
    const tier = ISLAND_TIERS[name];
    assert.equal(world.stats.visible, tier.total); assert.equal(world.stats.fullVisible, tier.full);
    assert.ok(world.stats.drawCalls <= ISLAND_DRAW_LIMIT);
    assert.equal(instanceMeshes(world).reduce((count, mesh) => count + mesh.count, 0), tier.total);
    for (const mesh of instanceMeshes(world)) assert.ok(mesh.count <= mesh.instanceMatrix.count);
    const snapshot = world.snapshot(), expected = snapshot.sites.map((site, i) => ({ i, distance: (site.x - 115) ** 2 + (site.z - 155) ** 2 })).sort((a, b) => a.distance - b.distance || a.i - b.i).slice(0, tier.total);
    for (const { i } of expected) assert.ok(snapshot.lod[i], `nearest site ${i} should render`);
  }
  world.update(.1, 3, { x: 2000, y: 0, z: 2000 }, 'low'); assert.equal(world.stats.visible, 0); assert.equal(world.stats.drawCalls, 0);
});

test('actual asset uses one shared opaque material, fixed wind roots and a normal deformation cue', async t => {
  const { world } = await readyWorld(t);
  const meshes = instanceMeshes(world), materials = new Set(meshes.map(mesh => mesh.material)); assert.equal(materials.size, 1);
  const [material] = materials;
  assert.equal(material.transparent, false); assert.equal(material.opacity, 1); assert.equal(material.alphaTest, 0);
  assert.equal(material.vertexColors, false); assert.equal(material.depthWrite, true); assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.map.image.width, 512);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.ok(shader.vertexShader.includes('transformed += islandOffset'));
  assert.ok(shader.vertexShader.includes('objectNormal.y = (objectNormal.y - islandSlope.x'));
  assert.ok(shader.vertexShader.includes('instanceMatrix * root'));
  assert.ok(!shader.vertexShader.includes('gl_InstanceID'));
  for (const mesh of meshes) {
    const spec = ISLAND_SPECIES[mesh.userData.island.speciesIndex], geometry = mesh.geometry;
    assert.equal(geometry.getAttribute('color'), undefined); assert.equal(geometry.attributes.aIslandWind.itemSize, 4);
    const p = geometry.attributes.position, wind = geometry.attributes.aIslandWind; let roots = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) <= .02) { assert.equal(wind.getX(i), 0); roots++; }
      close(wind.getZ(i), spec.height); close(wind.getW(i), spec.wind);
      if (spec.wind === 0) close(sampleIslandWind(40, 115, 155, wind.getX(i), wind.getY(i), spec.height, 0).x, 0);
    }
    assert.ok(roots > 0); assert.equal(mesh.frustumCulled, false); assert.equal(mesh.castShadow, false);
    assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage); assert.equal(mesh.instanceColor, null);
  }
  const zero = sampleIslandWind(90, 12, 30, 0, .7, 9, .08);
  for (const value of Object.values(zero)) close(value, 0);
  const a = sampleIslandWind(1, 12, 30, 1, .1, 9, .08), b = sampleIslandWind(2, 12, 30, 1, .1, 9, .08);
  assert.notEqual(a.x, b.x); assert.ok(Math.hypot(a.x, a.z) < 1.3); assert.ok(a.y <= 0);
  world.update(0, 100, near); assert.equal(shader.uniforms.uIslandTime.value, 1);
  world.update(.1, 8, near); assert.equal(shader.uniforms.uIslandTime.value, 8);
});

test('full and outer distance hysteresis avoids LOD jitter; low never draws full detail', async t => {
  const { world } = await readyWorld(t);
  const sites = world.snapshot().sites;
  let index = 0; for (let i = 1; i < sites.length; i++) if (sites[i].x > sites[index].x) index = i;
  const site = sites[index], observer = { x: site.x, y: site.y, z: site.z };
  const at = (distance, tier = 'high') => {
    observer.x = site.x + distance; world.update(.1, 2, observer, tier); return world.snapshot().lod[index];
  };
  assert.equal(at(29), 2); assert.equal(at(34), 2); assert.equal(at(37), 1); assert.equal(at(34), 1); assert.equal(at(29), 2);
  assert.equal(at(156), 1); assert.equal(at(169), 1); assert.equal(at(171), 0); assert.equal(at(160), 0); assert.equal(at(154), 1);
  assert.equal(at(0, 'low'), 1); assert.equal(world.stats.fullVisible, 0);
  assert.equal(at(103, 'low'), 1); assert.equal(at(105, 'low'), 0); assert.equal(at(98, 'low'), 0); assert.equal(at(91, 'low'), 1);
});

test('LOD changes preserve authored metre scale and roots; updates keep resource and buffer identity', async t => {
  const { world } = await readyWorld(t);
  const meshes = instanceMeshes(world), identities = meshes.map(mesh => ({ mesh, geometry: mesh.geometry, material: mesh.material, matrix: mesh.instanceMatrix.array,
    attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, value]) => [name, value.array])) }));
  const snapshot = world.snapshot(), sites = snapshot.sites;
  const byRoot = new Map(sites.map(site => [`${Math.fround(site.x)}:${Math.fround(site.z)}`, site]));
  const observer = { ...near };
  for (let frame = 0; frame < 1800; frame++) {
    const angle = frame * .025; observer.x = 115 + Math.sin(angle) * 120; observer.z = 155 + Math.cos(angle) * 120; observer.y = 12 + Math.sin(angle * .23) * 25;
    world.update(1 / 60, frame / 60, observer, ['high', 'medium', 'low'][Math.floor(frame / 100) % 3]);
    assert.ok(world.stats.drawCalls <= 30);
  }
  for (const saved of identities) {
    assert.equal(saved.mesh.geometry, saved.geometry); assert.equal(saved.mesh.material, saved.material); assert.equal(saved.mesh.instanceMatrix.array, saved.matrix);
    for (const [name, array] of Object.entries(saved.attributes)) assert.equal(saved.geometry.attributes[name].array, array);
    const values = saved.mesh.instanceMatrix.array;
    for (let i = 0; i < saved.mesh.count; i++) {
      const at = i * 16, site = byRoot.get(`${values[at + 12]}:${values[at + 14]}`); assert.ok(site);
      assert.equal(saved.mesh.userData.island.species, site.species); close(values[at + 13], site.y);
      close(Math.hypot(values[at], values[at + 1], values[at + 2]), site.scale);
    }
  }
});

test('network and malformed-asset failures keep usable fallback and never retry automatically', async t => {
  for (const malformed of [false, true]) {
    const gltf = malformed ? await actualAsset() : null;
    if (gltf) gltf.scene.getObjectByName('palm_tall_LOD0').geometry.deleteAttribute('uv1');
    const counts = gltf ? track(resources(gltf.scene).all) : null; let calls = 0;
    const reports = [];
    const world = createIslandWorld(new THREE.Scene(), { terrain, loader: { loadAsync() { calls++; if (gltf) return Promise.resolve(gltf); throw new Error('offline'); } }, onAsset: event => reports.push(event) });
    t.after(() => world.dispose()); world.update(.1, 1, near); assert.equal(await world.ready, false);
    assert.equal(world.stats.status, 'fallback'); assert.ok(world.stats.error); assert.ok(world.stats.visible > 0);
    assert.equal(terrainMeshes(world).length, 5); assert.ok(instanceMeshes(world).every(mesh => mesh.userData.island.lod === 2));
    for (let i = 0; i < 10; i++) world.update(.1, 2 + i, near); await tick(); assert.equal(calls, 1);
    assert.equal(reports.length, 1); assert.equal(reports[0].status, 'error');
    if (counts) once(counts);
  }
});

test('exact-once disposal releases sources, prepared resources, atlas and scene attachment', async t => {
  const gltf = await actualAsset(), source = resources(gltf.scene), sourceCounts = track(source.all), scene = new THREE.Scene();
  const sibling = new THREE.Group(); scene.add(sibling);
  const world = createIslandWorld(scene, { terrain, loader: { async loadAsync() { return gltf; } } }); t.after(() => world.dispose());
  const initial = resources(world.root), initialCounts = track(initial.all);
  world.update(.1, 1, near); assert.equal(await world.ready, true);
  const prepared = resources(world.root), preparedCounts = track([...prepared.all].filter(item => !initial.all.has(item) && !source.all.has(item)));
  world.dispose(); world.dispose(); world.update(.1, 100, near);
  once(sourceCounts); once(initialCounts); once(preparedCounts);
  for (const image of source.images) assert.equal(image.closed, 1);
  assert.equal(world.root.parent, null); assert.equal(world.root.children.length, 0); assert.equal(world.stats.status, 'disposed');
  assert.equal(world.colliders.length, 0); assert.equal(world.stats.drawCalls, 0); assert.deepEqual(scene.children, [sibling]);
});

test('disposal before load and during load settles ready and safely releases late assets', async () => {
  let calls = 0;
  const deferred = createIslandWorld(new THREE.Scene(), { terrain, loader: { loadAsync() { calls++; } } });
  deferred.dispose(); assert.equal(await deferred.ready, false); assert.equal(calls, 0);
  let resolve; const reports = [], gltf = await actualAsset(), owned = resources(gltf.scene), counts = track(owned.all);
  const world = createIslandWorld(new THREE.Scene(), { terrain, loader: { loadAsync() { calls++; return new Promise(done => { resolve = done; }); } }, onAsset: event => reports.push(event) });
  world.update(.1, 1, near); await tick(); assert.equal(calls, 1);
  world.dispose(); assert.equal(await world.ready, false); resolve(gltf); await tick(); await tick();
  once(counts); for (const image of owned.images) assert.equal(image.closed, 1);
  assert.deepEqual(reports, []); assert.equal(world.root.parent, null); assert.equal(world.stats.status, 'disposed');
});

test('required final terrain contract and nonfinite construction fail without scene pollution', () => {
  const scene = new THREE.Scene();
  assert.throws(() => createIslandWorld(scene), /final terrain/); assert.equal(scene.children.length, 0);
  assert.throws(() => createIslandWorld(scene, { terrain: () => NaN }), /Nonfinite island terrain/); assert.equal(scene.children.length, 0);
  assert.ok(ISLAND_LAYOUT.main.peak > ISLAND_LAYOUT.islet.peak);
});
