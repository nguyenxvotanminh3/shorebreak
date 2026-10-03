// Real vendored Three objects/math/shader source. Renderer stand-in acknowledges
// shadow requests and updates the real shadow camera, but DOES NOT draw pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { createAbyssWorld, terrainHeight } from '../dist/abyss-world.js';
import { createDeepBasin } from '../dist/abyss-deep-zone.js';
import { createDeepRig } from '../dist/abyss-rig.js';
import { createAbyssFlashlight, FLASHLIGHT_TIERS, FLASHLIGHT_OPTICS,
  flashlightAttenuation, limitFlashlightOnMaterial } from '../dist/abyss-flashlight.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const vectorClose = (a, b, tolerance = 1e-8) => close(a.distanceTo(b), 0, tolerance);
function solid(name = '', geometry = new THREE.BoxGeometry(1, 1, 1)) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); mesh.name = name; return mesh;
}
function fixture(t, quality = 'medium', extra = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, .08, 330);
  scene.add(camera); const root = new THREE.Group(); scene.add(root);
  const renderer = { shadowMap: { enabled: false, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false }, passes: 0,
    render() {
      scene.updateMatrixWorld(true);
      if (flashlight.light.visible && flashlight.light.shadow.needsUpdate) {
        flashlight.light.shadow.updateMatrices(flashlight.light);
        flashlight.light.shadow.needsUpdate = false; this.shadowMap.needsUpdate = false; this.passes++;
      }
    } };
  const flashlight = createAbyssFlashlight({ scene, camera, renderer, roots: [root], quality, ...extra });
  t.after(() => flashlight.dispose());
  return { scene, camera, root, renderer, flashlight };
}
const tick = (f, dt = 1 / 60, context = {}) => { f.flashlight.update(dt, { status: 'playing', enabled: true, ...context }); f.renderer.render(); };

test('one real spotlight has a centered near-eye mount and bounded inverse-square optics', t => {
  const f = fixture(t), light = f.flashlight.light;
  assert.equal(THREE.REVISION, '170'); assert.ok(light.isSpotLight); assert.equal(light.parent, f.camera);
  assert.equal(f.flashlight.target.parent, f.camera); assert.equal(f.camera.children.filter(n => n.isLight).length, 1);
  assert.equal(light.position.x, 0); assert.ok(light.position.z < 0 && light.position.z > -.2);
  assert.equal(light.decay, 2); assert.equal(light.castShadow, true); assert.equal(light.shadow.autoUpdate, false);
  assert.equal(f.renderer.shadowMap.type, THREE.PCFSoftShadowMap); assert.equal(f.renderer.shadowMap.enabled, true);
  close(light.angle, .55); close(light.penumbra, .42); close(light.shadow.camera.near, .06);
  assert.ok(light.shadow.normalBias < .03); assert.equal(light.shadow.mapSize.x, 512);
  assert.equal(light.map, null); assert.equal(f.root.children.length, 0);
});

test('existing YXZ forward basis and target matrices agree across yaw, pitch and translated parents', t => {
  const f = fixture(t), carrier = new THREE.Group(); carrier.position.set(7, -19, 31); f.scene.add(carrier); carrier.add(f.camera);
  for (const yaw of [-Math.PI, -1.7, -.4, 0, .8, Math.PI]) for (const pitch of [-1.48, -.7, 0, .6, 1.48]) {
    f.camera.position.set(15, -37, 52); f.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    tick(f, .1);
    const expected = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const p = new THREE.Vector3().setFromMatrixPosition(f.flashlight.light.matrixWorld);
    const target = new THREE.Vector3().setFromMatrixPosition(f.flashlight.target.matrixWorld);
    vectorClose(target.clone().sub(p).normalize(), expected);
    vectorClose(f.camera.getWorldDirection(new THREE.Vector3()), expected);
    vectorClose(new THREE.Vector3(...f.flashlight.snapshot().direction), expected);
    vectorClose(f.flashlight.viewPosition.value, f.flashlight.light.position);
    const projected = target.clone().project(f.flashlight.light.shadow.camera);
    close(projected.x, 0); close(projected.y, 0); assert.ok(projected.z > -1 && projected.z < 1);
  }
});

test('falloff and soft cone match the actual r170 GLSL source, with zero beyond range', () => {
  assert.match(THREE.ShaderChunk.lights_pars_begin, /1\.0 \/ max\( pow\( lightDistance, decayExponent \), 0\.01 \)/);
  assert.match(THREE.ShaderChunk.lights_pars_begin, /pow2\( saturate\( 1\.0 - pow4\( lightDistance \/ cutoffDistance \) \) \)/);
  assert.match(THREE.ShaderChunk.lights_pars_begin, /smoothstep\( coneCosine, penumbraCosine, angleCosine \)/);
  close(flashlightAttenuation(2, 0, 0) / flashlightAttenuation(4, 0, 0), 4);
  const profile = [0, .15, .31, .38, .46, .52, .55, .8].map(a => flashlightAttenuation(5, a));
  for (let i = 1; i < profile.length; i++) assert.ok(profile[i] <= profile[i - 1]);
  close(profile[0], profile[1]); close(profile.at(-1), 0); close(profile.at(-2), 0);
  assert.ok(flashlightAttenuation(10) > flashlightAttenuation(20));
  assert.ok(flashlightAttenuation(37.9) < .00001); close(flashlightAttenuation(38), 0); close(flashlightAttenuation(100), 0);
  assert.ok(Number.isFinite(flashlightAttenuation(0))); close(flashlightAttenuation(Infinity), 0);
  // Incident intensity only; actual output also depends on BRDF, water and tone map.
  assert.ok(flashlightAttenuation(10) * FLASHLIGHT_OPTICS.underwaterIntensity > 3);
  assert.ok(flashlightAttenuation(20) * FLASHLIGHT_OPTICS.underwaterIntensity > .65);
});

test('all quality levels bound moving shadow requests and reuse stationary maps', t => {
  for (const tier of Object.keys(FLASHLIGHT_TIERS)) {
    const f = fixture(t, tier), config = FLASHLIGHT_TIERS[tier];
    for (let i = 0; i < 600; i++) { f.camera.rotation.y += .002; tick(f, 1 / 120); }
    assert.ok(f.renderer.passes <= Math.ceil(5 * config.updatesPerSecond) + 1);
    assert.ok(f.renderer.passes > config.updatesPerSecond * 4);
    assert.equal(f.flashlight.light.shadow.mapSize.x, config.mapSize);
    assert.equal(f.flashlight.light.distance, config.distance);
    // One scheduled pass captures the final movement before the idle baseline.
    tick(f, .1); const before = f.renderer.passes, visited = f.flashlight.snapshot().nodesVisited;
    for (let i = 0; i < 600; i++) tick(f, 1 / 120);
    assert.equal(f.renderer.passes, before); assert.equal(f.flashlight.snapshot().nodesVisited, visited);
  }
});

test('no catch-up burst on long frames and no repeated unconsumed requests', t => {
  const f = fixture(t, 'low');
  for (let i = 0; i < 60; i++) { f.camera.position.x += .1; f.flashlight.update(10, { dynamicOccluders: true }); }
  assert.equal(f.flashlight.snapshot().updatesRequested, 1); assert.equal(f.renderer.passes, 0);
  f.renderer.render(); tick(f, 10, { dynamicOccluders: true }); assert.equal(f.renderer.passes, 2);
  f.camera.position.x += 1; tick(f, .001); assert.equal(f.renderer.passes, 2);
});

test('on/off, air, menu and pause are explicit, with zero paused or disabled shadow work', t => {
  const f = fixture(t); tick(f); const passes = f.renderer.passes;
  for (let i = 0; i < 100; i++) { f.camera.position.x += .1; tick(f, 1 / 60, { status: 'paused', dynamicOccluders: true }); }
  assert.equal(f.renderer.passes, passes); assert.equal(f.flashlight.light.visible, true);
  tick(f, .1, { enabled: false }); assert.equal(f.flashlight.light.visible, false);
  for (let i = 0; i < 100; i++) tick(f, .1, { enabled: false });
  assert.equal(f.renderer.passes, passes);
  tick(f, .1, { enabled: true, inAir: true }); assert.equal(f.renderer.passes, passes + 1);
  assert.equal(f.flashlight.light.intensity, FLASHLIGHT_OPTICS.airIntensity);
  tick(f, .1, { status: 'menu' }); assert.equal(f.flashlight.light.visible, false);
  tick(f, .1); assert.equal(f.flashlight.light.intensity, FLASHLIGHT_OPTICS.underwaterIntensity);
});

test('pause cannot lose a request that was queued before its first render', t => {
  const f = fixture(t); f.flashlight.update(.1); assert.equal(f.flashlight.light.shadow.needsUpdate, true);
  f.flashlight.update(.1, { status: 'paused' }); assert.equal(f.flashlight.light.shadow.needsUpdate, false);
  tick(f, .1); assert.equal(f.renderer.passes, 1);
});

test('dynamic door invalidation updates still views at tier rate and stops when door stops', t => {
  const f = fixture(t); tick(f); const initial = f.renderer.passes;
  for (let i = 0; i < 120; i++) tick(f, 1 / 120, { dynamicOccluders: true });
  assert.equal(f.renderer.passes - initial, 20);
  const stopped = f.renderer.passes; for (let i = 0; i < 120; i++) tick(f, 1 / 120);
  assert.equal(f.renderer.passes, stopped);
  f.flashlight.invalidateShadow(); tick(f); assert.equal(f.renderer.passes, stopped + 1);
});

test('quality reallocates only at a scheduled active pass and never during pause', t => {
  const f = fixture(t); tick(f); let disposed = 0;
  f.flashlight.light.shadow.map = { dispose() { disposed++; } };
  f.flashlight.setQuality('high'); tick(f, .001); assert.equal(disposed, 0);
  tick(f, 100, { status: 'paused' }); assert.equal(disposed, 0); assert.equal(f.flashlight.light.shadow.mapSize.x, 512);
  tick(f, .1); assert.equal(disposed, 1); assert.equal(f.flashlight.light.shadow.mapSize.x, 768);
  assert.equal(f.flashlight.light.shadow.map, null);
  f.flashlight.setQuality('high'); tick(f, .1); assert.equal(disposed, 1);
  f.flashlight.setQuality('low'); tick(f, .1); assert.equal(f.flashlight.light.shadow.camera.far, 30);
});

test('late opaque assets receive and cast shadows; camera arms, water and particles are excluded', t => {
  const f = fixture(t), room = new THREE.Group(), wall = solid('Wall'), door = solid('Door'); room.add(wall); f.root.add(room);
  assert.equal(wall.castShadow, true); assert.equal(wall.receiveShadow, true);
  room.add(door); assert.equal(door.castShadow, true); assert.equal(door.material.shadowSide, THREE.DoubleSide);
  const arms = solid('Glove'); f.camera.add(arms); assert.equal(arms.castShadow, false); assert.equal(arms.receiveShadow, false);
  const water = solid('Water'); water.material.transparent = true; water.material.opacity = .5; f.root.add(water);
  const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()); f.root.add(points);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial()); f.root.add(glow);
  assert.equal(water.castShadow, false); assert.equal(water.receiveShadow, false); assert.equal(glow.castShadow, false); assert.equal(points.castShadow, false);
  const masked = solid(); masked.material.alphaTest = .5; f.root.add(masked); assert.equal(masked.castShadow, false);
  const skin = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); f.root.add(skin); assert.equal(skin.castShadow, false);
  tick(f); const passes = f.renderer.passes; room.add(solid()); tick(f, .1); assert.equal(f.renderer.passes, passes + 1);
});

test('deformed vegetation receives but does not cast undeformed silhouettes; matching depth is explicit', t => {
  const f = fixture(t), plant = solid(), staticCaustic = solid(), supported = solid(), fallback = solid();
  plant.material.onBeforeCompile = () => {}; plant.material.customProgramCacheKey = () => 'abyss-caustics-water-v2-0|abyss-vegetation-v1';
  staticCaustic.material.onBeforeCompile = () => {}; staticCaustic.material.customProgramCacheKey = () => 'abyss-caustics-water-v2-0';
  supported.material.onBeforeCompile = () => {}; supported.customDepthMaterial = new THREE.MeshDepthMaterial();
  fallback.userData.vegetationFallback = true;
  f.root.add(plant, staticCaustic, supported, fallback);
  assert.equal(plant.castShadow, false); assert.equal(plant.receiveShadow, true); assert.equal(fallback.castShadow, false);
  assert.equal(staticCaustic.castShadow, true); assert.equal(supported.castShadow, true);
  for(const [key,eligible] of [['abyss-caustics-water-v3-0',true],['abyss-caustics-water-v3-1',false],['abyss-caustics-water-v3-0|abyss-vegetation-v1',false]]){
    const mesh=solid();mesh.material.onBeforeCompile=()=>{};mesh.material.customProgramCacheKey=()=>key;f.root.add(mesh);assert.equal(mesh.castShadow,eligible,key);
  }
});

test('a real wall and target share shadow projection, with wall depth nearer; depth pass flags are present', t => {
  const f = fixture(t), wall = solid('Opaque wall', new THREE.BoxGeometry(4, 4, .25));
  wall.position.set(0, 0, -4); f.root.add(wall);
  const target = solid('Surface behind wall'); target.position.set(0, 0, -8); f.root.add(target); tick(f);
  const camera = f.flashlight.light.shadow.camera;
  const front = new THREE.Vector3(0, .035, -3.875).project(camera), behind = new THREE.Vector3(0, .035, -7.5).project(camera);
  close(front.x, behind.x); close(front.y, behind.y); assert.ok(front.z < behind.z);
  assert.ok(f.flashlight.light.shadow.getFrustum().intersectsObject(wall));
  assert.equal(wall.castShadow, true); assert.equal(target.receiveShadow, true);
  const ray = new THREE.Raycaster(f.flashlight.light.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0, -1), .06, 38);
  const hits = ray.intersectObjects([wall, target]); assert.equal(hits[0].object, wall);
  assert.match(THREE.ShaderChunk.lights_fragment_begin, /directLight\.visible && receiveShadow.*getShadow\( spotShadowMap/);
  // This proves coherent setup/math, not rendered shadow pixels or leak-free bias.
});

test('shader arm cap chains the existing hook and targets this spotlight without array indexing', () => {
  const material = new THREE.MeshStandardMaterial(), viewPosition = { value: new THREE.Vector3(0, .035, -.12) };
  const previousCompile = shader => { shader.uniforms.prior = { value: 42 }; }, previousKey = () => 'prior';
  material.onBeforeCompile = previousCompile; material.customProgramCacheKey = previousKey;
  const undo = limitFlashlightOnMaterial(material, { viewPosition });
  assert.equal(limitFlashlightOnMaterial(material), undo);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.prior.value, 42); assert.equal(shader.uniforms.uAbyssTorchViewPosition, viewPosition);
  assert.equal(shader.uniforms.uAbyssTorchArmLimit.value, .48);
  assert.match(shader.fragmentShader, /distance\(spotLight.position, uAbyssTorchViewPosition\)/);
  assert.doesNotMatch(shader.fragmentShader, /spotLights\[\s*0\s*\]/);
  assert.ok(shader.fragmentShader.indexOf('torchIrradiance') < shader.fragmentShader.indexOf('getShadow( spotShadowMap'));
  assert.match(shader.fragmentShader, /RE_Direct\( directLight, geometryPosition/);
  assert.equal(material.depthTest, true); assert.equal(material.depthWrite, true); assert.equal(material.transparent, false);
  assert.match(material.customProgramCacheKey(), /^prior\|abyss-flashlight/);
  undo(); assert.equal(material.onBeforeCompile, previousCompile); assert.equal(material.customProgramCacheKey, previousKey);
});

test('arm material hook fails explicitly for incompatible shaders and preserves non-torch light equations', () => {
  assert.throws(() => limitFlashlightOnMaterial(new THREE.MeshBasicMaterial()), /standard\/physical/);
  const material = new THREE.MeshStandardMaterial(); limitFlashlightOnMaterial(material);
  assert.throws(() => material.onBeforeCompile({ uniforms: {}, fragmentShader: 'void main(){}' }), /lighting include/);
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader }; material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('getPointLightInfo( pointLight, geometryPosition, directLight );'));
  assert.ok(shader.fragmentShader.includes('getDirectionalLightInfo( directionalLight, directLight );'));
  // Equal near-field incident values are capped symmetrically; normal/BRDF variation remains.
  const left = Math.min(.48, FLASHLIGHT_OPTICS.underwaterIntensity * flashlightAttenuation(.5));
  const right = Math.min(.48, FLASHLIGHT_OPTICS.underwaterIntensity * flashlightAttenuation(.52)); close(left, right);
});

test('removal, reparenting, explicit refresh and disposal restore owned flags/materials and listeners', t => {
  const f = fixture(t), group = new THREE.Group(), wall = solid(), sibling = new THREE.Mesh(wall.geometry, wall.material);
  wall.receiveShadow = true; group.add(wall, sibling); f.root.add(group);
  group.remove(wall); assert.equal(wall.castShadow, false); assert.equal(wall.receiveShadow, true);
  assert.equal(wall.material.shadowSide, THREE.DoubleSide); group.remove(sibling); assert.equal(wall.material.shadowSide, null);
  group.add(wall); wall.material = new THREE.MeshBasicMaterial(); f.flashlight.refresh(wall); assert.equal(wall.castShadow, false);
  const newWall = solid(); group.add(newWall); let mapDisposed = 0;
  f.flashlight.light.shadow.map = { dispose() { mapDisposed++; } };
  f.flashlight.dispose(); f.flashlight.dispose(); assert.equal(mapDisposed, 1);
  assert.equal(f.camera.children.length, 0); assert.equal(newWall.castShadow, false); assert.equal(newWall.receiveShadow, false);
  assert.equal(newWall.material.shadowSide, null); assert.equal(f.renderer.shadowMap.enabled, false); assert.equal(f.renderer.shadowMap.type, THREE.PCFShadowMap);
  const late = solid(); group.add(late); assert.equal(late.castShadow, false);
  const before = f.flashlight.snapshot(); tick(f); f.flashlight.setQuality('high'); f.flashlight.refresh(group); f.flashlight.invalidateShadow();
  assert.equal(f.flashlight.snapshot().updatesRequested, before.updatesRequested); assert.equal(f.flashlight.snapshot().trackedNodes, 0);
});

test('default scene ownership excludes every camera subtree and explicit excluded subtree', t => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), arms = solid(), excluded = new THREE.Group(), wall = solid();
  camera.add(arms); scene.add(camera, excluded); excluded.userData.flashlightShadow = 'exclude'; excluded.add(wall);
  const f = createAbyssFlashlight({ scene, camera, renderer: { shadowMap: {} } }); t.after(() => f.dispose());
  assert.equal(arms.castShadow, false); assert.equal(wall.castShadow, false);
  excluded.add(solid()); assert.equal(f.snapshot().casters, 0);
});

test('implementation neither changes light layers nor allocates postprocessing or traverses per update', async () => {
  const source = await readFile(new URL('../dist/abyss-flashlight.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.layers\.(set|enable|disable)\(/);
  assert.doesNotMatch(source, /EffectComposer|BloomPass|ShaderPass|new THREE\.(ConeGeometry|WebGLRenderTarget)/);
  const update = source.slice(source.indexOf('  function update('), source.indexOf('  function invalidateShadow('));
  assert.doesNotMatch(update, /\.traverse\(|register\(|new THREE\./);
});


test('actual seeded world, basin and rig solids are eligible while their water and swaying foliage are not', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const world = createAbyssWorld(scene), basin = createDeepBasin(scene, { terrain: terrainHeight });
  const rig = createDeepRig(scene, { terrain: terrainHeight });
  const f = createAbyssFlashlight({ scene, camera, renderer: { shadowMap: {} }, roots: [world.root, basin.root, rig.root] });
  try {
    let terrain = 0, plants = 0, solids = 0;
    world.root.traverse(node => {
      if (!node.isMesh) return;
      if (node.userData.vegetationFallback) { plants++; assert.equal(node.castShadow, false); assert.equal(node.receiveShadow, true); }
      if (node.geometry.type === 'PlaneGeometry' && node.geometry.parameters.width === 55) { terrain++; assert.equal(node.castShadow, true); assert.equal(node.receiveShadow, true); }
    });
    assert.equal(terrain, 48); assert.ok(plants > 40);
    basin.root.traverse(node => { if (node.isMesh) { solids++; assert.equal(node.castShadow, true); assert.equal(node.receiveShadow, true); } });
    assert.equal(solids, 33);
    const water = world.root.getObjectByName('Ocean surface / underside optics'); assert.equal(water.castShadow, false);
    assert.equal(rig.root.getObjectByName('Wet lock / descending local water surface').castShadow, false);
    const fallback = rig.root.getObjectByName('Rig load fallback / real collision envelope');
    fallback.traverse(node => { if (node.isMesh) { assert.equal(node.castShadow, true); assert.equal(node.receiveShadow, true); } });
    assert.ok(f.snapshot().casters > 100);
  } finally { f.dispose(); world.dispose(); basin.dispose(); rig.dispose(); }
});
