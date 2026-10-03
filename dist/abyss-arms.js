import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

export const ARM_CLIPS = Object.freeze(['idle', 'swim', 'sprint', 'scan']);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const wrappedAngle = n => Math.atan2(Math.sin(n), Math.cos(n));

/** Short camera-local hand-space probes, using the same physical seafloor/solids.
 * This gently retracts the view rig near a wall; ordinary scene depth testing
 * remains authoritative. It is not full two-arm contact IK.
 */
export function armClearance(player, terrain, colliders = [], reach = 1.4) {
  if (typeof terrain !== 'function') return reach;
  const sy = Math.sin(player.yaw || 0), cy = Math.cos(player.yaw || 0);
  const sp = Math.sin(player.pitch || 0), cp = Math.cos(player.pitch || 0);
  const dx = -sy * cp, dy = sp, dz = -cy * cp;
  let nearest = reach;
  for (const side of [-.26, 0, .26]) {
    const ox = player.x + cy * side - sy * sp * .13;
    const oy = player.y - cp * .13;
    const oz = player.z - sy * side - cy * sp * .13;
    for (let d = 0; d <= nearest; d += .09) {
      if (oy + dy * d <= terrain(ox + dx * d, oz + dz * d) + .035) { nearest = d; break; }
    }
    const a = dx * dx + dz * dz;
    for (const solid of colliders) {
      const x = ox - solid.x, z = oz - solid.z, radius = solid.radius + .07;
      if (x * x + z * z > (reach + radius) ** 2) continue;
      let enter = 0, leave = nearest;
      if (a < 1e-8) { if (x * x + z * z > radius * radius) continue; }
      else {
        const b = x * dx + z * dz, discriminant = b * b - a * (x * x + z * z - radius * radius);
        if (discriminant < 0) continue;
        const q = Math.sqrt(discriminant); enter = Math.max(0, (-b - q) / a); leave = Math.min(nearest, (-b + q) / a);
        if (leave < enter) continue;
      }
      const bottom = solid.y - solid.height / 2, top = solid.y + solid.height / 2;
      if (Math.abs(dy) < 1e-8) { if (oy < bottom || oy > top) continue; }
      else {
        const y0 = (bottom - oy) / dy, y1 = (top - oy) / dy;
        enter = Math.max(enter, Math.min(y0, y1)); leave = Math.min(leave, Math.max(y0, y1));
        if (leave < enter) continue;
      }
      nearest = Math.min(nearest, enter);
    }
  }
  return clamp(nearest, 0, reach);
}

function releaseModel(model) {
  const geometry = new Set(), material = new Set(), textures = new Set(), skeletons = new Set();
  model.traverse(node => {
    if (node.geometry) geometry.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    for (const m of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
      material.add(m); for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const s of skeletons) s.dispose();
  for (const texture of textures) texture.dispose();
  for (const m of material) m.dispose();
  for (const g of geometry) g.dispose();
}

/** Camera-parented actual skinned geometry, rendered in the world depth pass.
 * No foreground overlay, second renderer or third-person body is introduced.
 */
export function createDiverArms(camera, options = {}) {
  const loader = options.loader || new GLTFLoader();
  const group = new THREE.Group(); group.name = 'Diver / first-person arms'; group.visible = false; camera.add(group);
  const weights = { idle: 1, swim: 0, sprint: 0, scan: 0 };
  const targets = { idle: 1, swim: 0, sprint: 0, scan: 0 };
  const actions = {}, materialCleanups = [];
  const reportAsset = event => { try { options.onAsset?.(event); } catch {} };
  function clearMaterialDecorators() {
    while (materialCleanups.length) { try { materialCleanups.pop()(); } catch {} }
  }
  let disposed = false, model = null, mixer = null, loadState = 'loading';
  let previousYaw = null, previousPitch = null, animationTime = 0, smoothedSpeed = 0, retract = 0, clearance = 1.4, probeClock = 1;
  let loadedGeometry = 0, loadedTriangles = 0, loadedBones = 0, loadedMaterials = 0;
  let pose = 'idle';

  const ready = (async () => {
    let loaded;
    try {
      loaded = await loader.loadAsync(options.url || './assets/abyss/diver-arms.glb');
      if (disposed) { releaseModel(loaded.scene); return false; }
      for (const name of ARM_CLIPS) if (!loaded.animations.some(clip => clip.name === name)) throw new Error('Missing diver animation: ' + name);
      model = loaded.scene; model.name = 'Diver gloves / animated rig';
      const materials = new Set(), geometry = new Set(), bones = new Set();
      model.traverse(node => {
        if (node.isBone) bones.add(node);
        if (!node.isMesh) return;
        node.frustumCulled = false; node.castShadow = false; node.receiveShadow = false; node.renderOrder = 0;
        if (!geometry.has(node.geometry)) {
          geometry.add(node.geometry);
          loadedTriangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
        }
        for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
          if (materials.has(m)) continue;
          materials.add(m); m.depthTest = true; m.depthWrite = true; m.transparent = false;
          // A material can be shared by several skinned primitives. Decorate
          // once after the owned material's ordinary world-depth settings.
          const cleanup = options.materialDecorator?.(m);
          if (typeof cleanup === 'function') materialCleanups.push(cleanup);
        }
      });
      loadedGeometry = geometry.size; loadedBones = bones.size; loadedMaterials = materials.size;
      group.add(model); mixer = new THREE.AnimationMixer(model);
      for (const name of ARM_CLIPS) {
        const action = mixer.clipAction(loaded.animations.find(clip => clip.name === name));
        action.setLoop(THREE.LoopRepeat, Infinity); action.setEffectiveWeight(weights[name]); action.play(); actions[name] = action;
      }
      mixer.setTime(0); loadState = 'ready'; reportAsset({ status: 'ready', triangles: loadedTriangles, bones: loadedBones, materials: loadedMaterials });
      return true;
    } catch (error) {
      // A decorator can fail after model assignment but before group attachment.
      // Release the entire owned GLB and any earlier hooks in either case.
      mixer?.stopAllAction(); if (model) mixer?.uncacheRoot(model); mixer = null;
      clearMaterialDecorators();
      const failedModel = model || loaded?.scene;
      if (failedModel) { failedModel.removeFromParent(); releaseModel(failedModel); }
      model = null; group.clear(); group.visible = false;
      for (const name of Object.keys(actions)) delete actions[name];
      loadedGeometry = loadedTriangles = loadedBones = loadedMaterials = 0;
      if (disposed) return false;
      loadState = 'error'; reportAsset({ status: 'error', message: error.message }); return false;
    }
  })();

  function reset() {
    if (disposed) return;
    weights.idle = 1; weights.swim = weights.sprint = weights.scan = 0;
    animationTime = 0; previousYaw = previousPitch = null; smoothedSpeed = 0; retract = 0; clearance = 1.4; probeClock = 1; pose = 'idle';
    group.position.set(0, 0, 0); group.rotation.set(0, 0, 0);
    for (const name of ARM_CLIPS) actions[name]?.setEffectiveWeight(weights[name]);
    mixer?.setTime(0);
  }

  function update(dt, context = {}) {
    if (disposed) return;
    group.visible = loadState === 'ready' && context.status !== 'menu' && context.status !== undefined;
    if (!group.visible || dt <= 0 || context.status !== 'playing') return;
    dt = Math.min(dt, .06); animationTime += dt;
    const speed = Math.hypot(context.vx || 0, context.vy || 0, context.vz || 0);
    smoothedSpeed = damp(smoothedSpeed, speed, 8, dt);
    const moving = clamp((smoothedSpeed - .12) / 3.9, 0, 1);
    const land=context.onLand===true,walkSway=land&&!context.reducedMotion?clamp((context.groundSpeed||0)/5,0,1):0;
    const fast = context.sprinting ? clamp((smoothedSpeed - 4.4) / 3.4, 0, 1) : 0;
    const scanning = !!context.scanHeld && !!context.nearTarget;
    targets.scan = scanning ? 1 : 0;
    targets.idle = scanning ? 0 : 1 - moving;
    targets.swim = scanning ? 0 : moving * (1 - fast);
    targets.sprint = scanning ? 0 : moving * fast;
    let strongest = 0;
    for (const name of ARM_CLIPS) {
      weights[name] = damp(weights[name], targets[name], scanning ? 10 : 7, dt);
      actions[name].setEffectiveWeight(weights[name]);
      if (weights[name] > strongest) { strongest = weights[name]; pose = name; }
    }
    actions.idle.setEffectiveTimeScale(context.reducedMotion ? 0 : 1);
    actions.swim.setEffectiveTimeScale(.72 + smoothedSpeed * .065);
    actions.sprint.setEffectiveTimeScale(.9 + smoothedSpeed * .045);
    actions.scan.setEffectiveTimeScale(1);
    mixer.update(dt);

    const aspect = camera.aspect || 1.7;
    const baseFramingZ = -clamp((1.15 - aspect) * .26, 0, .2);
    // Fit the measured animated palm envelope by depth, preserving its anatomy.
    // Blend in below square; cap adaptation at the tested 320 x 844 viewport.
    const fitDepth = clamp(.5 / (Math.tan((camera.fov || 70) * Math.PI / 360) * Math.max(aspect, 320 / 844) * .9) - .48, 0, 1.65);
    const portraitForward = Math.max(0, fitDepth + baseFramingZ) * clamp((1 - aspect) / .2, 0, 1);
    probeClock += dt;
    if (probeClock >= .1) { probeClock = 0; clearance = armClearance(context, context.terrain, context.colliders, 1.4 + portraitForward); }
    retract = damp(retract, clamp((.96 - clearance) / .65, 0, 1), 11, dt);
    // Look farther ahead for the extended rig, then remove only its extra reach
    // near solids. Keep the existing physical depth pass and close-wall motion.
    const framingZ = baseFramingZ - Math.min(portraitForward, Math.max(0, clearance - 1.2)) * (1 - retract);
    const yaw = context.yaw || 0, pitch = context.pitch || 0;
    const yawSpeed = previousYaw === null ? 0 : wrappedAngle(yaw - previousYaw) / dt;
    const pitchSpeed = previousPitch === null ? 0 : (pitch - previousPitch) / dt;
    previousYaw = yaw; previousPitch = pitch;
    const swayX = context.reducedMotion ? 0 : clamp(pitchSpeed * .012, -.035, .035);
    const swayY = context.reducedMotion ? 0 : clamp(yawSpeed * -.016, -.04, .04);
    group.rotation.x = damp(group.rotation.x, swayX, 9, dt);
    group.rotation.y = damp(group.rotation.y, swayY, 9, dt);
    group.position.z = damp(group.position.z, framingZ + retract * .14, 10, dt);
    group.position.x = damp(group.position.x, Math.sin(animationTime*5.4)*.016*walkSway, 10, dt);
    group.position.y = damp(group.position.y, (aspect < .8 ? .035 : 0) - retract * .035 - (land?.105:0) + Math.cos(animationTime*10.8)*.006*walkSway, 10, dt);
  }

  function dispose() {
    if (disposed) return;
    disposed = true; group.visible = false; camera.remove(group); mixer?.stopAllAction();
    clearMaterialDecorators();
    if (model) { mixer?.uncacheRoot(model); releaseModel(model); group.clear(); model = null; }
  }
  function snapshot() {
    return { status: loadState, visible: group.visible, pose, weights: { ...weights }, speed: smoothedSpeed,
      time: animationTime, mixerTime: mixer?.time || 0, clearance, retraction: retract,
      offset: { x: group.position.x, y: group.position.y, z: group.position.z },
      rotation: { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
      triangles: loadedTriangles, bones: loadedBones, materials: loadedMaterials, geometries: loadedGeometry, disposed };
  }
  return { group, ready, update, reset, dispose, snapshot };
}
