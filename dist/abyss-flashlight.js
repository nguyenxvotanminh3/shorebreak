import * as THREE from './vendor/three.module.js';

/** A single real, shadowed light; no bloom, fullscreen pass or cone-mesh light. */
export const FLASHLIGHT_TIERS = Object.freeze({
  low: Object.freeze({ mapSize: 256, updatesPerSecond: 12, distance: 30 }),
  medium: Object.freeze({ mapSize: 512, updatesPerSecond: 20, distance: 38 }),
  high: Object.freeze({ mapSize: 768, updatesPerSecond: 30, distance: 46 })
});
export const FLASHLIGHT_OPTICS = Object.freeze({
  color: 0xdcefff, underwaterIntensity: 320, airIntensity: 140,
  angle: .55, penumbra: .42, decay: 2, near: .06,
  x: 0, y: .035, z: -.12, targetDistance: 24, armIrradiance: .48
});
const tierName = name => Object.hasOwn(FLASHLIGHT_TIERS, name) ? name : 'medium';
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const stockCompile = THREE.Material.prototype.onBeforeCompile;
const armPatches = new WeakMap();

/** CPU reference of r170 lights_pars_begin, useful for numerical regression QA.
 * This is incident intensity before the surface BRDF, water path and tone map.
 * It is not a luminance/pixel prediction and does not sample a GPU shadow map.
 */
export function flashlightAttenuation(distance, angle = 0, cutoff = 38) {
  const d = Math.max(0, Number.isFinite(distance) ? distance : Infinity);
  const a = Math.abs(Number.isFinite(angle) ? angle : Math.PI);
  const outer = Math.cos(FLASHLIGHT_OPTICS.angle);
  const inner = Math.cos(FLASHLIGHT_OPTICS.angle * (1 - FLASHLIGHT_OPTICS.penumbra));
  const t = clamp((Math.cos(a) - outer) / (inner - outer), 0, 1);
  const cone = t * t * (3 - 2 * t);
  const range = cutoff > 0 ? Math.max(0, 1 - (d / cutoff) ** 4) ** 2 : 1;
  return cone * range / Math.max(d ** FLASHLIGHT_OPTICS.decay, .01);
}

/** Arm-only material hook for the vendored r170 standard lighting chunk.
 * Match the torch by view-space position, never by a brittle light-array index.
 * Cap its incident irradiance BEFORE BRDF evaluation, retaining textured diffuse,
 * specular, normal maps, other lights and ordinary world depth occlusion.
 * Light.layers is deliberately not used: it does not filter lights per mesh.
 * Call on the owned arm materials after loading; keep the returned undo callback
 * if those materials outlive the arms. Existing shader hooks/cache keys are kept.
 */
export function limitFlashlightOnMaterial(material, {
  viewPosition = { value: new THREE.Vector3(FLASHLIGHT_OPTICS.x, FLASHLIGHT_OPTICS.y, FLASHLIGHT_OPTICS.z) },
  maxIrradiance = FLASHLIGHT_OPTICS.armIrradiance
} = {}) {
  if (!material?.isMeshStandardMaterial) throw new TypeError('Flashlight arm hook requires a standard/physical material');
  if (armPatches.has(material)) return armPatches.get(material);
  const marker = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (THREE.REVISION !== '170' || chunk.split(marker).length !== 2) throw new Error('Flashlight arm hook needs the verified Three r170 spotlight chunk');
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
  // Read the old key before replacing onBeforeCompile: the default key reflects it.
  const baseKey = previousKey.call(material);
  const cap = { value: clamp(Number.isFinite(maxIrradiance) ? maxIrradiance : .48, 0, 2) };
  const patchedChunk = chunk.replace(marker, `${marker}
    if (distance(spotLight.position, uAbyssTorchViewPosition) < 0.001) {
      float torchIrradiance = max(max(directLight.color.r, directLight.color.g), directLight.color.b);
      directLight.color *= min(1.0, uAbyssTorchArmLimit / max(torchIrradiance, 0.00001));
    }`);
  function compile(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) throw new Error('Arm material removed the standard lighting include');
    shader.uniforms.uAbyssTorchViewPosition = viewPosition;
    shader.uniforms.uAbyssTorchArmLimit = cap;
    shader.fragmentShader = 'uniform vec3 uAbyssTorchViewPosition;\nuniform float uAbyssTorchArmLimit;\n' +
      shader.fragmentShader.replace('#include <lights_fragment_begin>', patchedChunk);
  }
  const key = () => `${baseKey}|abyss-flashlight-arms-r170-v1`;
  material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true;
  const undo = () => {
    if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
    if (material.customProgramCacheKey === key) material.customProgramCacheKey = previousKey;
    material.needsUpdate = true; armPatches.delete(material);
  };
  armPatches.set(material, undo);
  return undo;
}

const litOpaque = material => !!material && material.visible !== false && !material.transparent &&
  material.opacity >= .999 && !material.alphaTest && !material.alphaHash && !material.transmission &&
  (material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial);
const safeDepth = (node, material) => !!node.customDepthMaterial || material.onBeforeCompile === stockCompile ||
  ['abyss-caustics-water-v2-0','abyss-caustics-water-v3-0'].includes(material.customProgramCacheKey?.());

/** Integrate after world construction, before rendering.
 * roots limits ownership to world/deep-basin/rig roots (defaults to scene).
 * update runs after camera/rig poses. Pass dynamicOccluders while a door moves,
 * or call invalidateShadow after a non-camera occluder changes in place.
 * childadded/childremoved maintain late GLB/LOD membership without scene scans.
 * The one shadow projection uses r170 frustum culling; no artificial caster cap
 * discards walls. Map dimensions and update cadence bound the extra pass cost.
 * Between scheduled passes shadows are cached (max 83/50/33ms while moving),
 * so this is an intentionally bounded approximation, not per-frame ray tracing.
 */
export function createAbyssFlashlight({ scene, camera, renderer, roots = [scene], quality = 'medium' } = {}) {
  if (!scene?.isObject3D || !camera?.isCamera || !renderer?.shadowMap) throw new TypeError('Flashlight requires a scene, camera and renderer.shadowMap');
  let disposed = false, activeTier = tierName(quality), requestedTier = activeTier;
  let dirty = true, elapsed = Infinity, hadPose = false, wasEnabled = false;
  let updatesRequested = 0, registrations = 0, nodesVisited = 0;
  const tracked = new Map(), shadowSides = new Map();
  const previousShadow = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type };
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Global autoUpdate is left alone. Per-light autoUpdate=false is authoritative;
  // needsUpdate also wakes renderers whose global autoUpdate is disabled.
  const light = new THREE.SpotLight(FLASHLIGHT_OPTICS.color, FLASHLIGHT_OPTICS.underwaterIntensity,
    FLASHLIGHT_TIERS[activeTier].distance, FLASHLIGHT_OPTICS.angle, FLASHLIGHT_OPTICS.penumbra, FLASHLIGHT_OPTICS.decay);
  light.name = 'Diver torch / one bounded shadowed spotlight';
  light.position.set(FLASHLIGHT_OPTICS.x, FLASHLIGHT_OPTICS.y, FLASHLIGHT_OPTICS.z);
  light.target.name = 'Diver torch / forward target';
  light.target.position.copy(light.position); light.target.position.z -= FLASHLIGHT_OPTICS.targetDistance;
  light.visible = false; light.castShadow = true;
  light.shadow.autoUpdate = false; light.shadow.needsUpdate = false;
  light.shadow.mapSize.setScalar(FLASHLIGHT_TIERS[activeTier].mapSize);
  light.shadow.camera.near = FLASHLIGHT_OPTICS.near;
  light.shadow.camera.far = light.distance;
  light.shadow.bias = -.00015; light.shadow.normalBias = .025; light.shadow.radius = 1;
  camera.add(light, light.target);
  const worldPosition = new THREE.Vector3(), worldTarget = new THREE.Vector3(), direction = new THREE.Vector3();
  const lastPosition = new THREE.Vector3(), lastDirection = new THREE.Vector3();
  const viewPosition = { value: light.position.clone() };

  function excluded(node) {
    for (let at = node; at; at = at.parent) {
      if (at === camera || at.userData?.flashlightShadow === 'exclude') return true;
      if (at === scene) break;
    }
    return false;
  }
  function useDoubleSidedShadow(material) {
    if (!shadowSides.has(material)) shadowSides.set(material, { previous: material.shadowSide, users: 0 });
    shadowSides.get(material).users++; material.shadowSide = THREE.DoubleSide;
  }
  function register(node) {
    if (tracked.has(node) || excluded(node)) return;
    nodesVisited++;
    const entry = { cast: node.castShadow, receive: node.receiveShadow,
      added: event => { register(event.child); dirty = true; },
      removed: event => { unregister(event.child); dirty = true; } };
    tracked.set(node, entry);
    node.addEventListener('childadded', entry.added); node.addEventListener('childremoved', entry.removed);
    if (node.isMesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const opaque = materials.length > 0 && materials.every(litOpaque);
      // GPU plant sway is not reproduced by stock MeshDepthMaterial. Receiving
      // shadows remains correct because its regular vertex shader is deformed.
      const casts = opaque && !node.isSkinnedMesh && !node.userData.vegetationFallback &&
        materials.every(material => safeDepth(node, material));
      node.castShadow = casts; node.receiveShadow = opaque;
      entry.materials = casts ? [...new Set(materials)] : [];
      for (const material of entry.materials) useDoubleSidedShadow(material);
      registrations++;
    }
    for (const child of node.children) register(child);
    dirty = true;
  }
  function unregister(node) {
    for (const child of node.children) unregister(child);
    const entry = tracked.get(node); if (!entry) return;
    node.removeEventListener('childadded', entry.added); node.removeEventListener('childremoved', entry.removed);
    node.castShadow = entry.cast; node.receiveShadow = entry.receive; tracked.delete(node);
    for (const material of entry.materials || []) {
      const side = shadowSides.get(material);
      if (side && --side.users === 0) {
        if (material.shadowSide === THREE.DoubleSide) material.shadowSide = side.previous;
        shadowSides.delete(material);
      }
    }
  }
  for (const root of new Set(roots.filter(Boolean))) register(root);

  function setQuality(tier) { if (!disposed) requestedTier = tierName(tier); }
  function applyQuality() {
    if (activeTier === requestedTier) return;
    activeTier = requestedTier;
    const config = FLASHLIGHT_TIERS[activeTier];
    light.distance = config.distance; light.shadow.camera.far = config.distance;
    light.shadow.mapSize.setScalar(config.mapSize);
    light.shadow.map?.dispose(); light.shadow.map = null;
    light.shadow.mapPass?.dispose(); light.shadow.mapPass = null;
    light.shadow.camera.updateProjectionMatrix(); dirty = true;
  }
  function update(dt, context = {}) {
    if (disposed) return;
    const status = context.status || 'playing';
    const enabled = context.enabled !== false && status !== 'menu';
    light.visible = enabled;
    light.intensity = context.inAir ? FLASHLIGHT_OPTICS.airIntensity : FLASHLIGHT_OPTICS.underwaterIntensity;
    if (enabled !== wasEnabled) { dirty = true; wasEnabled = enabled; }
    if (!enabled) light.shadow.needsUpdate = false;
    // Camera's YXZ -Z forward already matches the swimming controls. Both light
    // and target inherit the same camera transform; no yaw sign fix is needed.
    camera.updateWorldMatrix(true, false);
    light.updateWorldMatrix(false, false); light.target.updateWorldMatrix(false, false);
    worldPosition.setFromMatrixPosition(light.matrixWorld); worldTarget.setFromMatrixPosition(light.target.matrixWorld);
    direction.subVectors(worldTarget, worldPosition).normalize();
    viewPosition.value.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
    if (status !== 'playing') {
      if (light.shadow.needsUpdate) dirty = true;
      light.shadow.needsUpdate = false; return;
    }
    elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (!enabled || light.shadow.needsUpdate) return;
    const moved = !hadPose || lastPosition.distanceToSquared(worldPosition) > .000025 || lastDirection.dot(direction) < .999998;
    const interval = 1 / FLASHLIGHT_TIERS[requestedTier].updatesPerSecond;
    if (elapsed + 1e-9 < interval || !(dirty || moved || context.dynamicOccluders || activeTier !== requestedTier)) return;
    applyQuality();
    light.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
    lastPosition.copy(worldPosition); lastDirection.copy(direction); hadPose = true;
    dirty = false; elapsed = 0; updatesRequested++;
  }
  function invalidateShadow() { if (!disposed) dirty = true; }
  function refresh(root) {
    if (disposed || !root) return;
    // Explicit escape hatch for in-place material replacement, not a frame loop.
    unregister(root); register(root); dirty = true;
  }
  function snapshot() {
    let casters = 0, receivers = 0;
    for (const node of tracked.keys()) if (node.isMesh) { casters += +node.castShadow; receivers += +node.receiveShadow; }
    return { disposed, enabled: light.visible, quality: activeTier, requestedQuality: requestedTier,
      intensity: light.intensity, distance: light.distance, decay: light.decay, angle: light.angle,
      penumbra: light.penumbra, mapSize: light.shadow.mapSize.x,
      maxUpdatesPerSecond: FLASHLIGHT_TIERS[activeTier].updatesPerSecond,
      updatesRequested, pendingShadow: light.shadow.needsUpdate, casters, receivers,
      trackedNodes: tracked.size, registrations, nodesVisited,
      worldPosition: worldPosition.toArray(), worldTarget: worldTarget.toArray(), direction: direction.toArray() };
  }
  function dispose() {
    if (disposed) return; disposed = true;
    // Iterating a copy permits subtree removal without invalidating traversal.
    for (const node of [...tracked.keys()]) unregister(node);
    for (const [material, state] of shadowSides) if (material.shadowSide === THREE.DoubleSide) material.shadowSide = state.previous;
    shadowSides.clear();
    light.visible = false; light.shadow.needsUpdate = false;
    light.removeFromParent(); light.target.removeFromParent(); light.dispose();
    light.shadow.map = null; light.shadow.mapPass = null;
    renderer.shadowMap.enabled = previousShadow.enabled; renderer.shadowMap.type = previousShadow.type;
  }
  return { light, target: light.target, viewPosition, update, setQuality, invalidateShadow, refresh, snapshot, dispose,
    limitArmMaterial: material => limitFlashlightOnMaterial(material, { viewPosition }) };
}
