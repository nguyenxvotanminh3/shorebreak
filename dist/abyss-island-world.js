import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { ISLAND_LAYOUT, sampleIslandInfluence, biomeAt, distanceToIslandPath } from './abyss-island-terrain.js';

// All caps are global across the two islands and all fifteen species.
export const ISLAND_TIERS = Object.freeze({
  high: Object.freeze({ full: 80, total: 500, fullEnter: 30, fullExit: 36, enter: 155, exit: 170, terrain: 440 }),
  medium: Object.freeze({ full: 40, total: 320, fullEnter: 24, fullExit: 29, enter: 120, exit: 132, terrain: 360 }),
  low: Object.freeze({ full: 0, total: 180, fullEnter: 0, fullExit: 0, enter: 92, exit: 104, terrain: 290 })
});
export const ISLAND_DRAW_LIMIT = 30;
export const ISLAND_ASSET_URL = './assets/abyss/island/coast_ecosystem.glb';
// Manifest-derived metres, slope limits and uniformly scaled root pivots.
export const ISLAND_SPECIES = Object.freeze([
  ['palm_tall', .38, 5.8, 9.147624, 12, .038],
  ['palm_leaning', .45, 4.6, 7.814475, 12, .042],
  ['palm_young', .28, 2.7, 5.383824, 12, .047],
  ['pandanus', .7, .9, 3.869836, 12, .034],
  ['pandanus_young', .35, .4, 2.256737, 12, .042],
  ['coastal_broadleaf', .46, 1.4, 5.259209, 22, .025],
  ['canopy_umbrella', .62, 3.7, 9.67656, 38, .022],
  ['canopy_irregular', .56, 2.7, 7.902326, 38, .027],
  ['shrub_round', .34, 0, .905443, 12, .042],
  ['shrub_tall', .42, 0, 1.667967, 22, .04],
  ['fern_cluster', 0, 0, .532976, 22, .065],
  ['dune_grass', 0, 0, .808464, 12, .085],
  ['rock_boulder', 1.12, 0, 1.731812, 26, 0],
  ['rock_slab', 1.25, 0, .80646, 26, 0],
  ['rock_cluster', 1.3, 0, 1.786559, 26, 0]
].map(([id, radius, trunkHeight, height, slopeLimit, wind]) => Object.freeze({ id, radius, trunkHeight, height, slopeLimit, wind })));
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const qualityName = value => Object.hasOwn(ISLAND_TIERS, value) ? value : 'medium';
const TAU = Math.PI * 2;
const islands = [ISLAND_LAYOUT.main, ISLAND_LAYOUT.islet];
const seedRandom = (seed = 913467) => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
  n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
};
function normalAt(terrain, x, z, out) {
  const dx = (terrain(x + .25, z) - terrain(x - .25, z)) * 2;
  const dz = (terrain(x, z + .25) - terrain(x, z - .25)) * 2;
  const length = Math.hypot(dx, 1, dz);
  out.x = -dx / length; out.y = 1 / length; out.z = -dz / length;
  out.slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  return out;
}

// UV1 carries bend weight and leaf phase, never coverage or material tint.
// The same world-root phase survives LOD swaps and instance-pool compaction.
const WIND_GLSL = `
attribute vec4 aIslandWind;
uniform float uIslandTime;
void islandWind(out vec3 displacement, out vec3 slope) {
  vec4 root = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    root = instanceMatrix * root;
  #endif
  root = modelMatrix * root;
  float f = clamp(aIslandWind.x, 0.0, 1.0);
  float phase = uIslandTime * 0.84 + root.x * 0.071 + root.z * 0.053 + aIslandWind.y * 6.28318530718;
  float a = phase - f * 0.9;
  float b = phase * 0.61 - f * 1.4 + 1.2;
  vec2 wave = vec2(sin(a) + 0.23 * sin(b), 0.58 * cos(a * 0.83));
  vec2 derivative = vec2(-0.9 * cos(a) - 0.322 * cos(b), 0.43326 * sin(a * 0.83));
  float h = aIslandWind.z, strength = aIslandWind.w;
  vec2 lateral = h * strength * f * f * wave;
  vec2 normalSlope = strength * (2.0 * f * wave + f * f * derivative);
  float shortening = -0.5 * h * strength * strength * f * f * f * dot(wave, wave);
  float shorteningSlope = -0.5 * strength * strength * (3.0 * f * f * dot(wave, wave) + 2.0 * f * f * f * dot(wave, derivative));
  displacement = vec3(lateral.x, shortening, lateral.y);
  slope = vec3(normalSlope.x, shorteningSlope, normalSlope.y);
}
`;

/** CPU reference only; matching equations do not establish GPU compilation. */
export function sampleIslandWind(time, x, z, flexibility, leafPhase, height, strength, out = {}) {
  const f = clamp(Number.isFinite(flexibility) ? flexibility : 0, 0, 1);
  const s = clamp(Number.isFinite(strength) ? strength : 0, 0, .1);
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const phase = (Number.isFinite(time) ? time : 0) * .84 + (Number.isFinite(x) ? x : 0) * .071 + (Number.isFinite(z) ? z : 0) * .053 + (Number.isFinite(leafPhase) ? leafPhase : 0) * TAU;
  const a = phase - f * .9, b = phase * .61 - f * 1.4 + 1.2;
  const wx = Math.sin(a) + .23 * Math.sin(b), wz = .58 * Math.cos(a * .83);
  const dx = -.9 * Math.cos(a) - .322 * Math.cos(b), dz = .43326 * Math.sin(a * .83);
  out.x = h * s * f * f * wx; out.z = h * s * f * f * wz;
  out.y = -.5 * h * s * s * f * f * f * (wx * wx + wz * wz);
  out.slopeX = s * (2 * f * wx + f * f * dx);
  out.slopeZ = s * (2 * f * wz + f * f * dz);
  out.slopeY = -.5 * s * s * (3 * f * f * (wx * wx + wz * wz) + 2 * f * f * f * (wx * dx + wz * dz));
  return out;
}

function windMaterial(material, clock) {
  material.transparent = false; material.opacity = 1; material.alphaTest = 0;
  material.alphaMap = null; material.vertexColors = false; material.depthWrite = true;
  material.depthTest = true; material.side = THREE.DoubleSide;
  material.alphaHash = false; material.alphaToCoverage = false;
  if ('transmission' in material) material.transmission = 0;
  material.onBeforeCompile = shader => {
    shader.uniforms.uIslandTime = clock;
    shader.vertexShader = WIND_GLSL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vec3 islandOffset, islandSlope;
      islandWind(islandOffset, islandSlope);
      objectNormal.y = (objectNormal.y - islandSlope.x * objectNormal.x - islandSlope.z * objectNormal.z) / max(0.8, 1.0 + islandSlope.y);
      #ifdef USE_TANGENT
        objectTangent += islandSlope * objectTangent.y;
      #endif`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += islandOffset;');
  };
  material.customProgramCacheKey = () => 'abyss-island-uv1-wind-v1';
  material.needsUpdate = true;
}

/**
 * Isolated opt-in island renderer. terrain(x,z) MUST be the final composed
 * physics height, not the base seafloor. Root transforms remain identity.
 * loader.loadAsync owns fresh GLB resources; no shared asset-cache resources.
 * Loading starts once, near an island and above -42m. ready resolves boolean
 * after that attempt or disposal; it stays pending while the player is distant.
 * A lightweight rooted fallback remains usable after network/asset failure.
 * update(dt,time,player,tier): dt<=0 freezes wind; .position observers accepted.
 * Terrain and instance storage are fixed. snapshot() alone allocates diagnostics.
 * No shadows, collision with soft leaves, per-frame cloning, or GPU claims.
 */
export function createIslandWorld(scene, options = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('A Three scene/group is required');
  if (typeof options.terrain !== 'function') throw new TypeError('Island world requires the final terrain(x,z) function');
  const terrain = options.terrain, loader = options.loader || new GLTFLoader();
  const root = new THREE.Group(); root.name = 'Abyss sandy mountain islands'; scene.add(root);
  const clock = { value: 0 }, tiles = [], colliders = [], sites = [], pools = [], fallbackPools = [];
  const released = new WeakSet();
  const owner = () => ({ geometries: new Set(), materials: new Set(), textures: new Set(), images: new Set(), meshes: new Set(), skeletons: new Set() });
  const ground = owner(), fallback = owner(), assets = owner();
  let disposed = false, loaded = false, requested = false, quality = qualityName(options.quality);
  let observerX = 0, observerY = -80, observerZ = -400, refreshTime = 0;
  let settleReady;
  const ready = new Promise(resolve => { settleReady = resolve; });
  const stats = { status: 'deferred', quality, sites: 0, species: ISLAND_SPECIES.length, terrainTiles: 0, terrainTriangles: 0,
    visibleTiles: 0, fullVisible: 0, lowVisible: 0, visible: 0, drawCalls: 0, vegetationDrawCalls: 0,
    fullLimit: ISLAND_TIERS[quality].full, totalLimit: ISLAND_TIERS[quality].total, drawLimit: ISLAND_DRAW_LIMIT,
    colliders: 0, geometries: 0, materials: 0, pools: 0, time: 0, loadRequests: 0, error: null, fallback: true };
  function report(status, message) {
    try { options.onAsset?.({ id: 'island', status, ...(message ? { message } : {}) }); } catch { /* Reporting never owns resource lifetime. */ }
  }
  function release(resource) {
    if (!resource || released.has(resource)) return;
    released.add(resource);
    if (resource.dispose) resource.dispose(); else resource.close?.();
  }
  function releaseOwner(group) {
    for (const mesh of group.meshes) { mesh.count = 0; mesh.visible = false; mesh.removeFromParent(); release(mesh); }
    for (const key of ['skeletons', 'geometries', 'materials', 'textures', 'images']) for (const resource of group[key]) release(resource);
    for (const value of Object.values(group)) value.clear();
  }
  function registerMaterial(material) {
    if (!material) return;
    assets.materials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) {
      assets.textures.add(value);
      const data = value.source?.data || value.image;
      for (const image of Array.isArray(data) ? data : [data]) if (image?.close) assets.images.add(image);
    }
  }
  function registerAsset(gltf) {
    const scenes = new Set(gltf?.scenes || []);
    if (gltf?.scene) scenes.add(gltf.scene);
    for (const asset of scenes) asset.traverse(node => {
      if (node.geometry) assets.geometries.add(node.geometry);
      if (node.skeleton) assets.skeletons.add(node.skeleton);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) registerMaterial(material);
    });
  }
  function resourceStats() {
    stats.geometries = ground.geometries.size + fallback.geometries.size + assets.geometries.size;
    stats.materials = ground.materials.size + fallback.materials.size + assets.materials.size;
    stats.pools = 0; for (const pool of loaded ? pools : fallbackPools) if (pool) stats.pools++;
  }

  const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 });
  ground.materials.add(terrainMaterial);
  const sand = new THREE.Color(0xd7c794), wetSand = new THREE.Color(0x698b83), coast = new THREE.Color(0x929d65);
  const rock = new THREE.Color(0x7a807b), highland = new THREE.Color(0x788665), color = new THREE.Color(), normal = {};
  function makeTile(x0, z0, width, depth, name, cellSize) {
    const nx = Math.ceil(width / cellSize), nz = Math.ceil(depth / cellSize), positions = [], normals = [], colors = [], indices = [];
    const influence = new Float32Array((nx + 1) * (nz + 1));
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const x = x0 + width * ix / nx, z = z0 + depth * iz / nz, h = terrain(x, z);
      if (!Number.isFinite(h)) throw new Error('Nonfinite island terrain');
      normalAt(terrain, x, z, normal);
      positions.push(x, h, z); normals.push(normal.x, normal.y, normal.z);
      color.copy(sand).lerp(wetSand, clamp(-h / 15, 0, .88));
      if (h > 2.5) color.lerp(coast, clamp((h - 2.5) / 13, 0, .82));
      if (h > 22) color.lerp(highland, clamp((h - 22) / 28, 0, .75));
      color.lerp(rock, clamp((normal.slope - 24) / 30, 0, .83));
      // A continuous sandy trail reads across tile boundaries.
      if (h > .1) color.lerp(sand, clamp((4 - distanceToIslandPath(x, z)) / 2, 0, .72));
      color.multiplyScalar(.96 + .04 * Math.sin(x * .47 + z * .71));
      colors.push(color.r, color.g, color.b);
      influence[iz * (nx + 1) + ix] = sampleIslandInfluence(x, z);
    }
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
      // No triangle lies wholly on the old unchanged floor. Shared edge vertices
      // are allowed so the new raised surface meets the existing seafloor.
      if (Math.max(influence[a], influence[c], influence[b]) > 1e-6) indices.push(a, c, b);
      if (Math.max(influence[b], influence[c], influence[d]) > 1e-6) indices.push(b, c, d);
    }
    if (!indices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, terrainMaterial); mesh.name = name; mesh.userData.islandTerrain = true;
    root.add(mesh); ground.geometries.add(geometry);
    tiles.push({ mesh, x: x0 + width / 2, z: z0 + depth / 2, radius: Math.hypot(width, depth) / 2 });
    stats.terrainTriangles += indices.length / 3;
  }
  try {
    for (let islandIndex = 0; islandIndex < islands.length; islandIndex++) {
      const island = islands[islandIndex], divisions = islandIndex === 0 ? 2 : 1;
      for (let iz = 0; iz < divisions; iz++) for (let ix = 0; ix < divisions; ix++) makeTile(
        island.x - island.radiusX + ix * island.radiusX * 2 / divisions,
        island.z - island.radiusZ + iz * island.radiusZ * 2 / divisions,
        island.radiusX * 2 / divisions, island.radiusZ * 2 / divisions, `Island terrain ${islandIndex}:${ix}:${iz}`, islandIndex === 0 ? 1.5 : 1.125);
    }
  } catch (error) { releaseOwner(ground); root.removeFromParent(); throw error; }
  stats.terrainTiles = tiles.length;

  const rng = seedRandom(), temporary = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const alignment = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  const speciesCounts = new Uint16Array(ISLAND_SPECIES.length);
  function chooseSpecies(biome, h, chance) {
    if (biome === 'shore' || h < 3.8) return chance < .28 ? Math.floor(rng() * 3) : chance < .42 ? 3 + Math.floor(rng() * 2) : chance < .82 ? 11 : 12 + Math.floor(rng() * 3);
    if (biome === 'coast' || h < 13) return chance < .22 ? 3 + Math.floor(rng() * 3) : chance < .5 ? 8 + Math.floor(rng() * 2) : chance < .72 ? 11 : chance < .86 ? 10 : 12 + Math.floor(rng() * 3);
    if (biome === 'highland' || h > 35) return chance < .16 ? 6 + Math.floor(rng() * 2) : chance < .48 ? 9 : chance < .66 ? 10 : 12 + Math.floor(rng() * 3);
    return chance < .42 ? 5 + Math.floor(rng() * 3) : chance < .65 ? 9 : chance < .82 ? 10 : 12 + Math.floor(rng() * 3);
  }
  for (const island of islands) for (let z0 = island.z - island.radiusZ; z0 < island.z + island.radiusZ; z0 += 2.1) {
    for (let x0 = island.x - island.radiusX; x0 < island.x + island.radiusX; x0 += 2.1) {
      const x = x0 + .3 + rng() * 1.5, z = z0 + .3 + rng() * 1.5, density = rng();
      if (sampleIslandInfluence(x, z) <= 1e-5 || density > .86) continue;
      const y = terrain(x, z);
      if (!Number.isFinite(y) || y < .32) continue;
      const biome = biomeAt(x, z), speciesIndex = chooseSpecies(biome, y, rng()), species = ISLAND_SPECIES[speciesIndex];
      normalAt(terrain, x, z, normal);
      if (normal.slope > species.slopeLimit) continue;
      const scale = .82 + rng() * .36, rotation = rng() * TAU;
      const solid = speciesIndex < 8 || speciesIndex >= 12;
      const clearance = solid ? 4 + species.radius * scale : 2.6 + Math.max(.5, species.radius) * scale;
      if (distanceToIslandPath(x, z) < clearance) continue;
      temporary.position.set(x, y, z); temporary.scale.setScalar(scale); temporary.quaternion.set(0, 0, 0, 1);
      if (speciesIndex >= 12) {
        direction.set(normal.x, normal.y, normal.z); alignment.setFromUnitVectors(up, direction);
        const angle = 2 * Math.acos(clamp(alignment.w, -1, 1));
        if (angle > Math.PI / 15) alignment.slerp(new THREE.Quaternion(), 1 - (Math.PI / 15) / angle);
        yaw.setFromAxisAngle(up, rotation); temporary.quaternion.copy(alignment).multiply(yaw);
      } else temporary.rotation.y = rotation;
      temporary.updateMatrix();
      sites.push({ x, y, z, species: species.id, speciesIndex, biome, scale, rotation, slope: normal.slope, clearance, matrix: temporary.matrix.toArray() });
      speciesCounts[speciesIndex]++;
      if (solid) {
        const height = (speciesIndex < 8 ? species.trunkHeight : species.height) * scale;
        colliders.push({ x, y: y + height / 2, z, radius: species.radius * scale, height, island: true, species: species.id });
      }
    }
  }
  stats.sites = sites.length; stats.colliders = colliders.length;
  const matrices = new Float32Array(sites.length * 16), distances = new Float64Array(sites.length), order = new Int32Array(sites.length);
  const lod = new Uint8Array(sites.length), wanted = new Uint8Array(sites.length), present = new Uint8Array(ISLAND_SPECIES.length), fullSpecies = new Uint8Array(ISLAND_SPECIES.length);
  for (let i = 0; i < sites.length; i++) { matrices.set(sites[i].matrix, i * 16); order[i] = i; }
  const nearestFirst = (a, b) => distances[a] - distances[b] || a - b;
  function createPool(geometry, material, speciesIndex, level, group) {
    const capacity = Math.min(speciesCounts[speciesIndex], level === 0 ? ISLAND_TIERS.high.full : ISLAND_TIERS.high.total);
    if (!capacity) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `Island ${ISLAND_SPECIES[speciesIndex].id} ${level === 2 ? 'fallback' : `LOD${level}`}`;
    mesh.userData.island = { species: ISLAND_SPECIES[speciesIndex].id, speciesIndex, lod: level };
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.visible = false;
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    group.meshes.add(mesh); root.add(mesh);
    return { mesh, count: 0, speciesIndex, level };
  }

  // Small rooted procedural silhouettes keep walking and collision usable while
  // the one optional GLB is pending/unavailable. Discarded once, on successful load.
  const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true });
  fallback.materials.add(fallbackMaterial);
  for (let i = 0; i < ISLAND_SPECIES.length; i++) {
    if (!speciesCounts[i]) { fallbackPools.push(null); continue; }
    const species = ISLAND_SPECIES[i], parts = [];
    const append = (geometry, tint) => {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      const p = g.attributes.position, n = g.attributes.normal;
      for (let j = 0; j < p.count; j++) parts.push(p.getX(j), p.getY(j), p.getZ(j), n.getX(j), n.getY(j), n.getZ(j), tint.r, tint.g, tint.b);
      if (g !== geometry) g.dispose(); geometry.dispose();
    };
    if (i < 8) {
      const trunk = new THREE.CylinderGeometry(species.radius * .65, species.radius, species.height * .8, 5);
      trunk.translate(0, species.height * .4, 0); append(trunk, new THREE.Color(0x83785b));
      const crown = new THREE.IcosahedronGeometry(1, 0);
      crown.scale(species.height * .28, species.height * .2, species.height * .28); crown.translate(0, species.height * .8, 0);
      append(crown, new THREE.Color(0x627e4b));
    } else {
      const bush = new THREE.IcosahedronGeometry(1, 0);
      bush.scale(i >= 12 ? species.radius : species.height * .65, species.height * .5, i >= 12 ? species.radius : species.height * .65);
      bush.translate(0, species.height * .5, 0); append(bush, new THREE.Color(i >= 12 ? 0x818778 : 0x7a9151));
    }
    const g = new THREE.BufferGeometry(), p = [], n = [], c = [];
    for (let j = 0; j < parts.length; j += 9) { p.push(...parts.slice(j, j + 3)); n.push(...parts.slice(j + 3, j + 6)); c.push(...parts.slice(j + 6, j + 9)); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    fallback.geometries.add(g); fallbackPools.push(createPool(g, fallbackMaterial, i, 2, fallback));
  }

  function refresh() {
    if (disposed) return;
    const tier = ISLAND_TIERS[quality]; let tileDraws = 0, count = 0;
    for (const tile of tiles) {
      tile.mesh.visible = Math.hypot(tile.x - observerX, tile.z - observerZ) <= tier.terrain + tile.radius;
      if (tile.mesh.visible) tileDraws++;
    }
    present.fill(0); fullSpecies.fill(0);
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i], d = (site.x - observerX) ** 2 + (site.y - observerY) ** 2 + (site.z - observerZ) ** 2;
      const range = lod[i] ? tier.exit : tier.enter;
      distances[i] = d <= range * range ? d : Infinity;
      wanted[i] = loaded && tier.full && d <= (lod[i] === 2 ? tier.fullExit : tier.fullEnter) ** 2 ? 2 : 1;
    }
    order.sort(nearestFirst);
    while (count < Math.min(tier.total, sites.length) && distances[order[count]] < Infinity) { present[sites[order[count]].speciesIndex] = 1; count++; }
    let lowSpeciesCount = 0; for (let i = 0; i < present.length; i++) lowSpeciesCount += present[i];
    let fullSlots = Math.max(0, ISLAND_DRAW_LIMIT - tileDraws - lowSpeciesCount), full = 0;
    lod.fill(0);
    for (const pool of loaded ? pools : fallbackPools) if (pool) pool.count = 0;
    for (let c = 0; c < count; c++) {
      const index = order[c], speciesIndex = sites[index].speciesIndex;
      const useFull = loaded && wanted[index] === 2 && full < tier.full && (fullSpecies[speciesIndex] || fullSlots > 0);
      if (useFull && !fullSpecies[speciesIndex]) { fullSpecies[speciesIndex] = 1; fullSlots--; }
      const pool = loaded ? pools[speciesIndex * 2 + (useFull ? 0 : 1)] : fallbackPools[speciesIndex];
      const slot = pool.count++;
      const target = pool.mesh.instanceMatrix.array;
      for (let j = 0; j < 16; j++) target[slot * 16 + j] = matrices[index * 16 + j];
      lod[index] = useFull ? 2 : 1; if (useFull) full++;
    }
    let draws = 0;
    for (const pool of loaded ? pools : fallbackPools) if (pool) {
      pool.mesh.count = pool.count; pool.mesh.visible = pool.count > 0;
      if (pool.count) { pool.mesh.instanceMatrix.needsUpdate = true; draws++; }
    }
    stats.visibleTiles = tileDraws; stats.fullVisible = full; stats.lowVisible = count - full; stats.visible = count;
    stats.vegetationDrawCalls = draws; stats.drawCalls = draws + tileDraws;
    root.visible = stats.drawCalls > 0;
  }
  function prepareAsset(gltf) {
    if (!gltf?.scene) throw new Error('Island asset has no scene');
    gltf.scene.updateMatrixWorld(true);
    const variants = new Map(), retained = new Set(); let sharedMaterial = null;
    gltf.scene.traverse(node => {
      if (!ISLAND_SPECIES.some(species => node.name === `${species.id}_LOD0` || node.name === `${species.id}_LOD1`)) return;
      if (variants.has(node.name)) throw new Error(`Duplicate island prototype ${node.name}`);
      const meshes = []; node.traverse(child => { if (child.isMesh) meshes.push(child); });
      if (meshes.length !== 1 || meshes[0].isSkinnedMesh) throw new Error(`${node.name}: one static mesh required`);
      const mesh = meshes[0];
      if (mesh.geometry.morphAttributes.position?.length) throw new Error(`${node.name}: morphs are unsupported`);
      const material = Array.isArray(mesh.material) ? mesh.material.length === 1 ? mesh.material[0] : null : mesh.material;
      if (!material?.isMeshStandardMaterial) throw new Error(`${node.name}: expected one standard atlas material`);
      if (sharedMaterial && sharedMaterial.map !== material.map) throw new Error('Island prototypes must share one atlas');
      sharedMaterial ||= material; variants.set(node.name, { node, mesh });
    });
    for (let speciesIndex = 0; speciesIndex < ISLAND_SPECIES.length; speciesIndex++) {
      const species = ISLAND_SPECIES[speciesIndex];
      for (let level = 0; level < 2; level++) {
        const name = `${species.id}_LOD${level}`, variant = variants.get(name);
        if (!variant) throw new Error(`Missing island prototype ${name}`);
        const { node, mesh } = variant, geometry = mesh.geometry.clone(); assets.geometries.add(geometry); retained.add(geometry);
        const transform = mesh.matrixWorld.clone(), pivot = node.matrixWorld.elements;
        transform.elements[12] -= pivot[12]; transform.elements[13] -= pivot[13]; transform.elements[14] -= pivot[14];
        geometry.applyMatrix4(transform);
        const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv, windUV = geometry.attributes.uv1;
        if (!position || !normal || !uv || !windUV || normal.count !== position.count || normal.itemSize !== 3 || uv.count !== position.count || windUV.count !== position.count || windUV.itemSize !== 2) throw new Error(`${name}: POSITION/NORMAL/UV0/UV1 required`);
        for (const attribute of Object.values(geometry.attributes)) {
          const values = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
          for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) throw new Error(`${name}: nonfinite geometry`);
        }
        if (geometry.index) for (let i = 0; i < geometry.index.count; i++) {
          const value = geometry.index.getX(i);
          if (!Number.isInteger(value) || value < 0 || value >= position.count) throw new Error(`${name}: invalid index`);
        }
        geometry.computeBoundingBox();
        if (Math.abs(geometry.boundingBox.min.y) > .02 || geometry.boundingBox.max.y <= .1) throw new Error(`${name}: prototype must be rooted at ground Y=0`);
        const wind = new Float32Array(position.count * 4);
        for (let i = 0; i < position.count; i++) {
          wind[i * 4] = position.getY(i) <= .02 ? 0 : clamp(windUV.getX(i), 0, 1);
          wind[i * 4 + 1] = windUV.getY(i); wind[i * 4 + 2] = species.height; wind[i * 4 + 3] = species.wind;
        }
        geometry.deleteAttribute('color'); geometry.setAttribute('aIslandWind', new THREE.BufferAttribute(wind, 4));
        geometry.computeBoundingSphere();
        geometry.boundingSphere.radius += species.height * species.wind * 1.5;
        pools.push(createPool(geometry, sharedMaterial, speciesIndex, level, assets));
      }
    }
    windMaterial(sharedMaterial, clock);
    for (const geometry of assets.geometries) if (!retained.has(geometry)) { release(geometry); assets.geometries.delete(geometry); }
    for (const material of assets.materials) if (material !== sharedMaterial) { release(material); assets.materials.delete(material); }
    const retainedTextures = new Set(Object.values(sharedMaterial).filter(value => value?.isTexture));
    for (const texture of assets.textures) if (!retainedTextures.has(texture)) { release(texture); assets.textures.delete(texture); }
  }
  function requestAsset() {
    if (requested || disposed) return;
    requested = true; stats.status = 'loading'; stats.loadRequests++;
    // Also contains synchronous loader failures; construction never awaits it.
    Promise.resolve().then(() => disposed ? null : loader.loadAsync(ISLAND_ASSET_URL)).then(gltf => {
      if (!gltf) { if (disposed) { settleReady(false); return; } throw new Error('Island loader returned no asset'); }
      registerAsset(gltf);
      if (disposed) { releaseOwner(assets); settleReady(false); return; }
      prepareAsset(gltf);
      loaded = true; stats.status = 'ready'; stats.fallback = false;
      releaseOwner(fallback); fallbackPools.length = 0;
      resourceStats(); refresh(); report('ready'); settleReady(!disposed);
    }).catch(error => {
      releaseOwner(assets); pools.length = 0;
      if (!disposed) { loaded = false; stats.status = 'fallback'; stats.error = error?.message || String(error); resourceStats(); refresh(); report('error', stats.error); }
      settleReady(false);
    });
  }
  function update(dt, absoluteTime, observer, nextQuality) {
    if (disposed) return;
    let dirty = false;
    if (Number.isFinite(dt) && dt > 0) {
      clock.value = Number.isFinite(absoluteTime) ? absoluteTime : clock.value + dt;
      stats.time = clock.value; refreshTime += dt;
    }
    if (nextQuality !== undefined && qualityName(nextQuality) !== quality) {
      quality = qualityName(nextQuality); stats.quality = quality;
      stats.fullLimit = ISLAND_TIERS[quality].full; stats.totalLimit = ISLAND_TIERS[quality].total; dirty = true;
    }
    const point = observer?.position || observer;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      dirty ||= point.x !== observerX || point.y !== observerY || point.z !== observerZ;
      observerX = point.x; observerY = point.y; observerZ = point.z;
    }
    if (!requested && observerY > -42) for (const island of islands) {
      if (Math.hypot(observerX - island.x, observerZ - island.z) < Math.max(island.radiusX, island.radiusZ) + 55) { requestAsset(); break; }
    }
    if (dirty || refreshTime >= .2) { refreshTime = 0; refresh(); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; loaded = false; root.removeFromParent();
    releaseOwner(assets); releaseOwner(fallback); releaseOwner(ground); root.clear(); root.visible = false;
    lod.fill(0); pools.length = 0; fallbackPools.length = 0;
    colliders.length = 0; stats.status = 'disposed'; stats.visible = stats.fullVisible = stats.lowVisible = stats.visibleTiles = stats.drawCalls = stats.vegetationDrawCalls = stats.colliders = 0;
    settleReady(false); resourceStats();
  }
  function snapshot() {
    return { ...stats, sites: sites.map(site => ({ ...site, matrix: [...site.matrix] })), lod: Array.from(lod),
      variants: (loaded ? pools : fallbackPools).filter(Boolean).map(pool => ({ species: ISLAND_SPECIES[pool.speciesIndex].id, lod: pool.level, count: pool.count })) };
  }
  resourceStats(); refresh();
  return { root, colliders, stats, ready, update, dispose, snapshot };
}
