import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

/** Caps are GLOBAL across species, not per pool. Distances are metres to roots. */
export const VEGETATION_TIERS = Object.freeze({
  high: Object.freeze({ full: 96, total: 320, fullEnter: 22, fullExit: 27, enter: 85, exit: 94 }),
  medium: Object.freeze({ full: 64, total: 220, fullEnter: 18, fullExit: 23, enter: 66, exit: 74 }),
  low: Object.freeze({ full: 0, total: 140, fullEnter: 0, fullExit: 0, enter: 48, exit: 56 })
});
export const VEGETATION_SPECIES = Object.freeze([
  'ribbon_kelp', 'split_kelp', 'eelgrass', 'red_algae', 'sea_fan', 'plate_coral'
]);
const STRENGTH = Object.freeze({ ribbon_kelp: .085, split_kelp: .075, eelgrass: .095, red_algae: .05, sea_fan: .025, plate_coral: .0005 });
const DEFAULT_URL = './assets/abyss/vegetation.glb';
const MAX_VISIBLE = VEGETATION_TIERS.high.total;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const tierName = value => Object.hasOwn(VEGETATION_TIERS, value) ? value : 'medium';

// A bounded cantilever/drag approximation, not a fluid solver. The phase is
// rooted in world space, never the pool slot, so compaction and LOD do not reset
// it. Two slow current frequencies and increasing distal lag avoid lockstep.
// The y correction approximates length conservation; the matching Jacobian
// deforms lighting normals as well as positions. Zero flexibility stays fixed.
const SWAY_GLSL = `
attribute float aVegFlex;
attribute vec2 aVegMotion;
uniform float uVegTime;
vec3 abyssVegRoot() {
  vec4 root = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    root = instanceMatrix * root;
  #endif
  return (modelMatrix * root).xyz;
}
void abyssVegMotion(out vec3 offset, out vec3 slope) {
  float f = clamp(aVegFlex, 0.0, 1.0);
  float h = aVegMotion.x;
  float s = aVegMotion.y;
  vec3 root = abyssVegRoot();
  float phase = uVegTime * 0.68 + root.x * 0.117 + root.z * 0.093;
  float a = phase - 1.15 * f;
  float b = phase * 0.57 - 1.55 * f + 1.8;
  float c = phase * 0.83 - 1.3 * f + 0.65;
  vec2 wave = vec2(sin(a) + 0.22 * sin(b), 0.55 * cos(c));
  vec2 derivative = vec2(-1.15 * cos(a) - 0.341 * cos(b), 0.715 * sin(c));
  vec2 lateral = h * s * f * f * wave;
  vec2 lateralSlope = s * (2.0 * f * wave + f * f * derivative);
  float shortening = -0.5 * h * s * s * f * f * f * dot(wave, wave);
  float verticalSlope = -0.5 * s * s * (3.0 * f * f * dot(wave, wave)
    + 2.0 * f * f * f * dot(wave, derivative));
  offset = vec3(lateral.x, shortening, lateral.y);
  slope = vec3(lateralSlope.x, verticalSlope, lateralSlope.y);
}
`;

/** CPU reference of the shader, for diagnostics/tests; pass out to reuse it. */
export function sampleVegetationSway(time, x, z, flexibility, height, strength = .085, out = {}) {
  const f = clamp(Number.isFinite(flexibility) ? flexibility : 0, 0, 1);
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const s = clamp(Number.isFinite(strength) ? strength : 0, 0, .12);
  const phase = (Number.isFinite(time) ? time : 0) * .68 + (Number.isFinite(x) ? x : 0) * .117 + (Number.isFinite(z) ? z : 0) * .093;
  const a = phase - 1.15 * f, b = phase * .57 - 1.55 * f + 1.8, c = phase * .83 - 1.3 * f + .65;
  const wx = Math.sin(a) + .22 * Math.sin(b), wz = .55 * Math.cos(c);
  const dx = -1.15 * Math.cos(a) - .341 * Math.cos(b), dz = .715 * Math.sin(c);
  out.x = h * s * f * f * wx;
  out.y = -.5 * h * s * s * f * f * f * (wx * wx + wz * wz);
  out.z = h * s * f * f * wz;
  out.slopeX = s * (2 * f * wx + f * f * dx);
  out.slopeY = -.5 * s * s * (3 * f * f * (wx * wx + wz * wz) + 2 * f * f * f * (wx * dx + wz * dz));
  out.slopeZ = s * (2 * f * wz + f * f * dz);
  return out;
}

function makeOpaque(material) {
  // COLOR_0.a is flexibility, never coverage. RGB remains an ordinary tint.
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.alphaHash = false;
  material.alphaToCoverage = false;
  material.alphaMap = null;
  material.depthTest = true;
  material.depthWrite = true;
  material.vertexColors = true;
  material.blending = THREE.NormalBlending;
  if ('transmission' in material) material.transmission = 0;
}

function decorateMaterial(material, clock, decorator) {
  makeOpaque(material);
  if (decorator) {
    const decorated = decorator(material);
    if (decorated && decorated !== material) throw new Error('materialDecorator must decorate and return the same material, or return nothing');
  }
  makeOpaque(material);
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      throw new Error('Vegetation requires the standard begin_vertex and beginnormal_vertex shader chunks');
    }
    shader.uniforms.uVegTime = clock;
    shader.vertexShader = SWAY_GLSL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vec3 vegOffset, vegSlope;
      abyssVegMotion(vegOffset, vegSlope);
      objectNormal.y = (objectNormal.y - vegSlope.x * objectNormal.x - vegSlope.z * objectNormal.z) / max(0.8, 1.0 + vegSlope.y);
      #ifdef USE_TANGENT
        objectTangent += vec3(vegSlope.x, vegSlope.y, vegSlope.z) * objectTangent.y;
      #endif`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed += vegOffset;`);
  };
  material.customProgramCacheKey = () => `${previousKey}|abyss-vegetation-v1`;
  material.needsUpdate = true;
}

/**
 * Standalone, opt-in vegetation controller; it does not alter world/life code.
 *
 * options.sites: deterministic [{ x, z, y?, species?, rotation?, scale?,
 *   targetHeight?, color? }]. rotation is a yaw in radians or XYZ Euler object;
 *   scale is positive scalar or {x,y,z}; targetHeight overrides scale uniformly.
 *   Missing y uses terrain(x,z), otherwise 0. Unknown/invalid sites are skipped.
 * options.speciesMapping: { callerAlias: 'ribbon_kelp' }; unspecified species
 *   cycle through available names in sorted order. Site input is copied at call.
 * options.loader: GLTFLoader-compatible loadAsync(url); assets are OWNED by this
 *   controller, so a custom loader must return fresh, exclusively owned resources.
 * options.assetURL: defaults to ./assets/abyss/vegetation.glb.
 * options.materialDecorator(material): decorate in place (e.g. world caustics).
 *   Preserve standard shader include anchors and the opaque atlas contract.
 * options.onAsset({ id:'vegetation', status:'ready'|'error', message? }).
 *
 * const plants = createAbyssVegetation(scene, options);
 * await plants.ready; // boolean, errors and disposal resolve false, never reject
 * plants.update(dt, absoluteSimulationTime, playerOrCamera, quality?);
 * plants.setQuality('high'|'medium'|'low'); // immediate, no reload/reallocation
 * plants.dispose(); // idempotent; late async arrivals are released too
 *
 * dt <= 0 freezes shader time even if absoluteSimulationTime changes. For dt > 0
 * finite absolute time is authoritative; omit it to integrate dt. Observer may
 * be {x,y,z} or an object with .position. root stays identity in world coordinates.
 * No per-frame objects, mesh clones, geometry uploads, or instance attributes are
 * created. Visibility is distance-based; each visible plant occupies ONE LOD.
 * snapshot() allocates a diagnostic copy; stats itself is stable and read-only
 * by convention. GPU/shader compilation still requires real-browser QA.
 */
export function createAbyssVegetation(scene, options = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('A Three scene/group is required');
  const root = new THREE.Group(); root.name = 'Abyss instanced vegetation'; root.visible = false; scene.add(root);
  const rawSites = Array.isArray(options.sites) ? options.sites.map(site => {
    if (!site || typeof site !== 'object') return null;
    return { ...site, rotation: typeof site.rotation === 'object' && site.rotation ? { ...site.rotation } : site.rotation,
      scale: typeof site.scale === 'object' && site.scale ? { ...site.scale } : site.scale,
      color: site.color?.isColor ? site.color.clone() : site.color };
  }) : [];
  const mapping = { ...options.speciesMapping };
  const loader = options.loader || new GLTFLoader();
  const clock = { value: 0 }, geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set(), skeletons = new Set();
  const released = new WeakSet(), instanceMeshes = new Set(), pools = [], species = [], entries = [];
  const candidate = new Int32Array(MAX_VISIBLE);
  let positions = new Float64Array(0), matrices = new Float32Array(0), colors = new Float32Array(0);
  let distances = new Float64Array(0), desired = new Uint8Array(0), lod = new Uint8Array(0), speciesIndices = new Uint16Array(0);
  let quality = tierName(options.quality), disposed = false, readyState = false, sharedMaterial = null;
  let observerX = 0, observerY = 0, observerZ = 0;
  const stats = { status: 'loading', quality, inputSites: rawSites.length, sites: 0, skippedSites: 0, species: 0, geometries: 0, materials: 0,
    pools: 0, fullVisible: 0, lowVisible: 0, visible: 0, drawCalls: 0, fullLimit: VEGETATION_TIERS[quality].full, totalLimit: VEGETATION_TIERS[quality].total, time: 0, error: null };

  function report(status, message) {
    try { options.onAsset?.({ id: 'vegetation', status, ...(message ? { message } : {}) }); } catch { /* A reporting callback cannot strand GPU resources. */ }
  }
  function registerMaterial(material) {
    if (!material) return;
    materials.add(material);
    for (const value of Object.values(material)) {
      if (value?.isTexture) {
        textures.add(value);
        const image = value.source?.data || value.image;
        if (Array.isArray(image)) { for (const item of image) if (item?.close) images.add(item); }
        else if (image?.close) images.add(image);
      }
    }
  }
  function registerAsset(gltf) {
    const scenes = new Set(gltf?.scenes || []);
    if (gltf?.scene) scenes.add(gltf.scene);
    for (const asset of scenes) asset.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.skeleton) skeletons.add(node.skeleton);
      if (Array.isArray(node.material)) node.material.forEach(registerMaterial); else registerMaterial(node.material);
    });
  }
  function release(resource, owners) {
    owners.delete(resource);
    if (!released.has(resource)) { released.add(resource); resource.dispose(); }
  }
  function releaseAll() {
    // InstancedMesh owns instance buffers, not its geometry/material.
    for (const mesh of instanceMeshes) release(mesh, instanceMeshes);
    for (const pool of pools) { pool.count = 0; pool.mesh.count = 0; pool.mesh.visible = false; }
    for (const resource of skeletons) release(resource, skeletons);
    for (const resource of geometries) release(resource, geometries);
    for (const resource of materials) release(resource, materials);
    for (const resource of textures) release(resource, textures);
    for (const resource of images) {
      if (!released.has(resource)) { released.add(resource); resource.close(); }
    }
    images.clear(); root.clear(); root.visible = false;
  }
  function prepareGeometry(node, mesh, referenceHeight) {
    if (mesh.isSkinnedMesh || mesh.geometry.morphAttributes.position?.length) throw new Error(`${node.name}: vegetation must be static, rooted geometry`);
    const geometry = mesh.geometry.clone(); geometries.add(geometry);
    const transform = mesh.matrixWorld.clone();
    // The named node's pivot is the planting point, even if a catalogue scene
    // laid different species out apart. Keep authored rotation/scale and child offsets.
    const e = transform.elements, pivot = node.matrixWorld.elements;
    e[12] -= pivot[12]; e[13] -= pivot[13]; e[14] -= pivot[14];
    geometry.applyMatrix4(transform);
    const position = geometry.getAttribute('position'), color = geometry.getAttribute('color');
    if (!position || position.itemSize !== 3 || position.count < 3) throw new Error(`${node.name}: missing plant positions`);
    for (const attribute of Object.values(geometry.attributes)) {
      const values = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
      for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) throw new Error(`${node.name}: nonfinite geometry`);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) {
      const index = geometry.index.getX(i);
      if (!Number.isInteger(index) || index < 0 || index >= position.count) throw new Error(`${node.name}: invalid geometry index`);
    }
    if (color && (color.count !== position.count || (color.itemSize !== 3 && color.itemSize !== 4))) throw new Error(`${node.name}: COLOR_0 count mismatch`);
    geometry.computeBoundingBox();
    const height = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
    if (!Number.isFinite(height) || height <= 1e-5) throw new Error(`${node.name}: invalid plant height`);
    const flexibility = new Float32Array(position.count), tint = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      // getW honours normalized integer glTF vertex attributes.
      flexibility[i] = color?.itemSize === 4 ? clamp(color.getW(i), 0, 1) : clamp(Math.max(0, position.getY(i)) / (referenceHeight || height), 0, 1);
      tint[i * 3] = color ? color.getX(i) : 1;
      tint[i * 3 + 1] = color ? color.getY(i) : 1;
      tint[i * 3 + 2] = color ? color.getZ(i) : 1;
    }
    geometry.setAttribute('aVegFlex', new THREE.BufferAttribute(flexibility, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.name = node.name;
    return { geometry, height };
  }
  function discover(gltf) {
    if (!gltf?.scene?.isObject3D) throw new Error('Vegetation asset has no scene');
    gltf.scene.updateMatrixWorld(true);
    const variants = new Map();
    gltf.scene.traverse(node => {
      const match = /^veg_(.+)_(full|low)$/.exec(node.name);
      if (!match) return;
      const name = match[1], variant = match[2], meshes = [];
      node.traverse(child => { if (child.isMesh) meshes.push(child); });
      if (meshes.length !== 1) throw new Error(`${node.name}: expected exactly one static mesh`);
      const mesh = meshes[0];
      if (Array.isArray(mesh.material) && mesh.material.length !== 1) throw new Error(`${node.name}: expected one atlas material`);
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material?.isMeshStandardMaterial && !material?.isMeshPhongMaterial && !material?.isMeshLambertMaterial) throw new Error(`${node.name}: expected a lit standard atlas material`);
      const pair = variants.get(name) || {}; variants.set(name, pair);
      if (pair[variant]) throw new Error(`Duplicate vegetation node: ${node.name}`);
      pair[variant] = { node, mesh };
      if (!sharedMaterial) sharedMaterial = material;
      // Distinct material wrappers are allowed only if they reference the same
      // atlas; different maps cannot be represented by the one-material renderer.
      else if (material.map !== sharedMaterial.map) throw new Error('Vegetation variants must share one atlas texture');
    });
    if (!variants.size) throw new Error('No veg_<species>_full/low nodes found');
    for (const name of [...variants.keys()].sort()) {
      const pair = variants.get(name);
      if (!pair.full || !pair.low) throw new Error(`${name}: full and low variants are required`);
      const full = prepareGeometry(pair.full.node, pair.full.mesh), low = prepareGeometry(pair.low.node, pair.low.mesh, full.height);
      const strength = STRENGTH[name] ?? .05;
      for (const variant of [full, low]) {
        const values = new Float32Array(variant.geometry.getAttribute('position').count * 2);
        for (let i = 0; i < values.length; i += 2) { values[i] = full.height; values[i + 1] = strength; }
        variant.geometry.setAttribute('aVegMotion', new THREE.BufferAttribute(values, 2));
        variant.geometry.userData.vegetation = { species: name, height: full.height, strength };
      }
      species.push({ name, height: full.height, strength, full: full.geometry, low: low.geometry, count: 0, fullPool: null, lowPool: null });
    }
    try { decorateMaterial(sharedMaterial, clock, options.materialDecorator); }
    finally { registerMaterial(sharedMaterial); } // Own decorator additions even when its callback throws.
  }
  function initializeSites() {
    const byName = new Map(species.map((item, index) => [item.name, index]));
    const temporary = new THREE.Object3D(), color = new THREE.Color();
    for (let i = 0; i < rawSites.length; i++) {
      const site = rawSites[i];
      if (!site || !Number.isFinite(site.x) || !Number.isFinite(site.z)) continue;
      const name = site.species === undefined ? species[i % species.length].name : (mapping[site.species] ?? site.species);
      const speciesIndex = byName.get(name);
      if (speciesIndex === undefined) continue;
      let y = site.y;
      if (y === undefined) y = typeof options.terrain === 'function' ? options.terrain(site.x, site.z) : 0;
      if (disposed) return; // A caller's terrain callback may dispose re-entrantly.
      if (!Number.isFinite(y)) continue;
      const item = species[speciesIndex];
      let sx = 1, sy = 1, sz = 1;
      if (site.targetHeight !== undefined) sx = sy = sz = site.targetHeight / item.height;
      else if (typeof site.scale === 'number') sx = sy = sz = site.scale;
      else if (site.scale !== undefined) { sx = site.scale?.x; sy = site.scale?.y; sz = site.scale?.z; }
      if (![sx, sy, sz].every(value => Number.isFinite(value) && value > 0 && value < 1e4)) continue;
      let rx = 0, ry = 0, rz = 0;
      if (typeof site.rotation === 'number') ry = site.rotation;
      else if (site.rotation !== undefined) { rx = site.rotation?.x ?? 0; ry = site.rotation?.y ?? 0; rz = site.rotation?.z ?? 0; }
      if (![rx, ry, rz].every(Number.isFinite)) continue;
      temporary.position.set(site.x, y, site.z); temporary.rotation.set(rx, ry, rz, 'XYZ'); temporary.scale.set(sx, sy, sz); temporary.updateMatrix();
      color.set(site.color ?? 0xffffff);
      if (![color.r, color.g, color.b, ...temporary.matrix.elements].every(value => Number.isFinite(value) && Math.abs(value) < 1e30)) continue;
      entries.push({ x: site.x, y, z: site.z, speciesIndex, matrix: temporary.matrix.toArray(), color: color.toArray() });
      item.count++;
    }
    const count = entries.length;
    positions = new Float64Array(count * 3); matrices = new Float32Array(count * 16); colors = new Float32Array(count * 3);
    distances = new Float64Array(count); desired = new Uint8Array(count); lod = new Uint8Array(count); speciesIndices = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      const entry = entries[i]; positions[i * 3] = entry.x; positions[i * 3 + 1] = entry.y; positions[i * 3 + 2] = entry.z;
      matrices.set(entry.matrix, i * 16); colors.set(entry.color, i * 3); speciesIndices[i] = entry.speciesIndex;
    }
    entries.length = 0; rawSites.length = 0;
    for (const item of species) {
      for (const variant of ['full', 'low']) {
        const capacity = Math.min(item.count, variant === 'full' ? VEGETATION_TIERS.high.full : MAX_VISIBLE);
        if (!capacity) continue;
        const mesh = new THREE.InstancedMesh(item[variant], sharedMaterial, capacity);
        mesh.name = `Vegetation ${item.name} ${variant}`;
        mesh.userData.vegetation = { species: item.name, lod: variant };
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
        instanceMeshes.add(mesh);
        const pool = { mesh, count: 0 };
        item[`${variant}Pool`] = pool; pools.push(pool); root.add(mesh);
      }
    }
    // Retain exactly one prepared geometry per node and one atlas material.
    const keptGeometries = new Set(species.flatMap(item => [item.full, item.low]));
    for (const geometry of geometries) if (!keptGeometries.has(geometry)) release(geometry, geometries);
    for (const material of materials) if (material !== sharedMaterial) release(material, materials);
    const keptTextures = new Set(Object.values(sharedMaterial).filter(value => value?.isTexture));
    for (const texture of textures) if (!keptTextures.has(texture)) release(texture, textures);
    stats.sites = count; stats.skippedSites = stats.inputSites - count; stats.species = species.length;
    stats.geometries = geometries.size; stats.materials = 1; stats.pools = pools.length;
  }

  // Fixed-capacity max heap: closest sites win; exact ties preserve input order.
  function worse(a, b) { return distances[a] > distances[b] || (distances[a] === distances[b] && a > b); }
  function sink(index, length) {
    const value = candidate[index];
    while (index * 2 + 1 < length) {
      let child = index * 2 + 1;
      if (child + 1 < length && worse(candidate[child + 1], candidate[child])) child++;
      if (!worse(candidate[child], value)) break;
      candidate[index] = candidate[child]; index = child;
    }
    candidate[index] = value;
  }
  function refresh() {
    if (!readyState || disposed) return;
    const tier = VEGETATION_TIERS[quality];
    let size = 0;
    for (let i = 0; i < stats.sites; i++) {
      const dx = positions[i * 3] - observerX, dy = positions[i * 3 + 1] - observerY, dz = positions[i * 3 + 2] - observerZ;
      const distance = dx * dx + dy * dy + dz * dz;
      distances[i] = distance;
      const range = lod[i] ? tier.exit : tier.enter;
      desired[i] = 0;
      if (distance > range * range) continue;
      const near = lod[i] === 2 ? tier.fullExit : tier.fullEnter;
      desired[i] = tier.full && distance <= near * near ? 2 : 1;
      if (size < tier.total) {
        let index = size++;
        while (index > 0) {
          const parent = (index - 1) >> 1;
          if (!worse(i, candidate[parent])) break;
          candidate[index] = candidate[parent]; index = parent;
        }
        candidate[index] = i;
      } else if (worse(candidate[0], i)) { candidate[0] = i; sink(0, size); }
    }
    for (let end = size - 1; end > 0; end--) {
      const value = candidate[0]; candidate[0] = candidate[end]; candidate[end] = value; sink(0, end);
    }
    lod.fill(0);
    for (let p = 0; p < pools.length; p++) { pools[p].count = 0; }
    let full = 0;
    for (let c = 0; c < size; c++) {
      const index = candidate[c], item = species[speciesIndices[index]];
      const useFull = desired[index] === 2 && full < tier.full;
      const pool = useFull ? item.fullPool : item.lowPool;
      const slot = pool.count++;
      lod[index] = useFull ? 2 : 1;
      if (useFull) full++;
      const matrixTarget = pool.mesh.instanceMatrix.array, colorTarget = pool.mesh.instanceColor.array;
      for (let j = 0; j < 16; j++) matrixTarget[slot * 16 + j] = matrices[index * 16 + j];
      for (let j = 0; j < 3; j++) colorTarget[slot * 3 + j] = colors[index * 3 + j];
    }
    let draws = 0;
    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p]; pool.mesh.count = pool.count; pool.mesh.visible = pool.count > 0;
      if (pool.count) { pool.mesh.instanceMatrix.needsUpdate = true; pool.mesh.instanceColor.needsUpdate = true; draws++; }
    }
    root.visible = size > 0;
    stats.fullVisible = full; stats.lowVisible = size - full; stats.visible = size; stats.drawCalls = draws;
  }
  function setQuality(next) {
    if (disposed) return;
    const value = tierName(next);
    if (quality === value) return;
    quality = value; stats.quality = quality;
    stats.fullLimit = VEGETATION_TIERS[quality].full; stats.totalLimit = VEGETATION_TIERS[quality].total;
    refresh();
  }
  function update(dt, absoluteTime, observer, nextQuality) {
    if (disposed) return;
    let dirty = false;
    if (nextQuality !== undefined && tierName(nextQuality) !== quality) {
      quality = tierName(nextQuality); stats.quality = quality;
      stats.fullLimit = VEGETATION_TIERS[quality].full; stats.totalLimit = VEGETATION_TIERS[quality].total; dirty = true;
    }
    if (Number.isFinite(dt) && dt > 0) {
      const next = Number.isFinite(absoluteTime) ? absoluteTime : clock.value + dt;
      // Very large but finite input must not become an infinite GPU float.
      if (Math.abs(next) < 1e12) clock.value = next;
      stats.time = clock.value;
    }
    const point = observer?.position || observer;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      if (point.x !== observerX || point.y !== observerY || point.z !== observerZ) dirty = true;
      observerX = point.x; observerY = point.y; observerZ = point.z;
    }
    if (dirty) refresh();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; readyState = false; scene.remove(root); releaseAll();
    stats.status = 'disposed'; stats.fullVisible = 0; stats.lowVisible = 0; stats.visible = 0; stats.drawCalls = 0;
    positions = matrices = colors = distances = desired = lod = speciesIndices = null;
    entries.length = 0; rawSites.length = 0;
  }
  function snapshot() {
    return { ...stats, variants: species.map(item => ({ species: item.name, height: item.height, strength: item.strength,
      full: item.fullPool?.mesh.count || 0, low: item.lowPool?.mesh.count || 0 })), lod: lod ? Array.from(lod) : [] };
  }
  const ready = (async () => {
    try {
      const gltf = await loader.loadAsync(options.assetURL || DEFAULT_URL);
      registerAsset(gltf);
      if (disposed) { releaseAll(); return false; }
      discover(gltf);
      if (disposed) { releaseAll(); return false; }
      initializeSites();
      if (disposed) { releaseAll(); return false; }
      readyState = true; stats.status = 'ready'; refresh(); report('ready');
      return !disposed;
    } catch (error) {
      readyState = false; releaseAll();
      if (!disposed) { stats.status = 'error'; stats.error = error?.message || String(error); report('error', stats.error); }
      return false;
    }
  })();
  return { root, ready, stats, update, setQuality, dispose, snapshot };
}
