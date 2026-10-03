import * as THREE from './vendor/three.module.js';

// Original, bounded water-advected smoke approximation, not a fluid solver.
// Every position is WORLD space: clouds stay at the siphon release point while
// the animal escapes. No screen overlay, render target, texture or asset load.
const MAX_CLOUDS = 2, MAX_PUFFS = 24, MAX_INSTANCES = MAX_CLOUDS * MAX_PUFFS;
const TIERS = Object.freeze({ low: 12, medium: 18, high: 24 });
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const boundedPoint = p => finitePoint(p) && Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) <= 1e6;

export const INK_CLOUD_LIMITS = Object.freeze({
  maxClouds: MAX_CLOUDS, puffsPerCloud: TIERS, maxInstances: MAX_INSTANCES,
  maxDrawCalls: 1, maxTriangles: MAX_INSTANCES * 2,
  minLifetime: 9.6, maxLifetime: 11.2, textures: 0, renderTargets: 0
});

const VERTEX_SHADER = `
  attribute vec3 inkCenter;
  attribute vec4 inkPuff;
  attribute vec2 inkNoise;
  varying vec2 vInkUv;
  varying vec2 vInkNoise;
  varying float vInkAlpha;
  #include <fog_pars_vertex>
  void main() {
    // View-facing WORLD billboards: scene depth still clips each fragment.
    vec4 mvPosition = viewMatrix * vec4(inkCenter, 1.);
    float c = cos(inkPuff.w), s = sin(inkPuff.w);
    vec2 corner = position.xy * inkPuff.xy;
    mvPosition.xy += mat2(c, s, -s, c) * corner;
    gl_Position = projectionMatrix * mvPosition;
    vInkUv = position.xy;
    vInkNoise = inkNoise;
    vInkAlpha = inkPuff.z;
    #include <fog_vertex>
  }
`;
const FRAGMENT_SHADER = `
  varying vec2 vInkUv;
  varying vec2 vInkNoise;
  varying float vInkAlpha;
  #include <fog_pars_fragment>
  float inkHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float inkNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
    return mix(mix(inkHash(i), inkHash(i + vec2(1., 0.)), u.x),
      mix(inkHash(i + vec2(0., 1.)), inkHash(i + vec2(1., 1.)), u.x), u.y);
  }
  void main() {
    vec2 p = vInkUv;
    float age = vInkNoise.y, seed = vInkNoise.x;
    // Slowly curling, layered irregular edges rather than a flat black disc.
    float r2 = dot(p, p);
    if (r2 > 1.) discard;
    float curl = (1. - r2) * (1.25 + .17 * age) + seed;
    float c = cos(curl), s = sin(curl);
    vec2 q = mat2(c, s, -s, c) * p;
    q += vec2(seed * 7.13, seed * 3.71) + vec2(.07, -.11) * age;
    float broad = inkNoise(q * 2.8);
    float detail = inkNoise(q * 6.7 + broad * 1.3);
    float edge = 1. - smoothstep(.27 + .27 * broad, 1., r2);
    float core = exp(-r2 * 3.4);
    float alpha = vInkAlpha * edge * (.48 + .38 * broad + .14 * detail) * (.72 + .28 * core);
    if (alpha < .002) discard;
    // Near-black pigment, with subdued blue-gray light only at the wisps.
    vec3 pigment = mix(vec3(.0018, .0032, .006), vec3(.009, .015, .024), (1. - core) * .48);
    gl_FragColor = vec4(pigment, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function makeCloud() {
  return { active: false, id: null, order: 0, age: 0, lifetime: 10.4, seed: 0,
    releasedAt: null, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1,
    ux: 1, uy: 0, uz: 0, vx: 0, vy: 1, vz: 0,
    tx: 0, ty: 0, tz: 1, bx: 1, by: 0, bz: 0, bendAngle: 0,
    bdx: 0, bdy: 0, bdz: 1,
    x: 0, y: 0, z: 0, axialRadius: 0, radialRadius: 0, strength: 0 };
}

/**
 * emit direction is the ink jet direction, normally opposite escape travel.
 * Optional bendDirection gently redirects the plume after its first .2s.
 * update's dt owns age; absolute time is diagnostic and cannot unpause a cloud.
 * observer is a world {x,y,z}, used only for transparent back-to-front order.
 * sampleDensity is a compact world-space approximation in [0,1], independent
 * of the camera and quality. Callers may use it for a LOCAL inside-cloud veil.
 */
export function createInkClouds(scene) {
  const clouds = [makeCloud(), makeCloud()];
  const centers = new Float32Array(MAX_INSTANCES * 3);
  const puffs = new Float32Array(MAX_INSTANCES * 4);
  const noise = new Float32Array(MAX_INSTANCES * 2);
  // Canonical particle state and sorting scratch are allocated once. Sorting
  // does not allocate an Array, comparator, Vector or Matrix on each update.
  const poses = new Float64Array(MAX_INSTANCES * 8);
  const order = new Uint8Array(MAX_INSTANCES);
  const distances = new Float64Array(MAX_INSTANCES);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const centerAttribute = new THREE.InstancedBufferAttribute(centers, 3).setUsage(THREE.DynamicDrawUsage);
  const puffAttribute = new THREE.InstancedBufferAttribute(puffs, 4).setUsage(THREE.DynamicDrawUsage);
  const noiseAttribute = new THREE.InstancedBufferAttribute(noise, 2).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('inkCenter', centerAttribute);
  geometry.setAttribute('inkPuff', puffAttribute);
  geometry.setAttribute('inkNoise', noiseAttribute);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    name: 'Abyss / pooled blue-black ink', transparent: true,
    depthTest: true, depthWrite: false, side: THREE.FrontSide, fog: true,
    blending: THREE.NormalBlending,
    uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Abyss / world ink billboards';
  // Custom shader ignores the group's model matrix. Global-space centres and
  // expanding billboards cannot use the unit quad's automatic bounding sphere.
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
  const root = new THREE.Group();
  root.name = 'Kraken defensive ink'; root.add(mesh); scene.add(root);
  let disposed = false, quality = 'medium', elapsed = 0, lastTime = 0, serial = 0;
  let eyeX = 0, eyeY = 0, eyeZ = 0, activeCount = 0;

  function orientBasis(c) {
    if (Math.abs(c.ty) < .95) { c.ux = c.tz; c.uy = 0; c.uz = -c.tx; }
    else { c.ux = 0; c.uy = -c.tz; c.uz = c.ty; }
    const inv = 1 / Math.hypot(c.ux, c.uy, c.uz);
    c.ux *= inv; c.uy *= inv; c.uz *= inv;
    c.vx = c.ty * c.uz - c.tz * c.uy;
    c.vy = c.tz * c.ux - c.tx * c.uz;
    c.vz = c.tx * c.uy - c.ty * c.ux;
  }

  function refreshCloud(c) {
    // Analytic advection: a straight initial ejection followed by a gentle
    // bounded turn. This never instantly teleports ink sideways at the nozzle.
    const angle = c.bendAngle * smooth(.2, 1.3, c.age), cs = Math.cos(angle), sn = Math.sin(angle);
    c.tx = c.dx * cs + c.bx * sn; c.ty = c.dy * cs + c.by * sn; c.tz = c.dz * cs + c.bz * sn;
    orientBasis(c);
    const age = c.age, jet = 1 - Math.exp(-age * 1.65), spread = .22 + .245 * age;
    const advance = 1.72 * jet;
    c.x = c.ox + c.tx * advance + .105 * age;
    c.y = c.oy + c.ty * advance + .032 * age;
    c.z = c.oz + c.tz * advance + .055 * age;
    c.axialRadius = .8 + 1.35 * spread + 1.6 * jet;
    c.radialRadius = .72 + 1.45 * spread;
    c.strength = smooth(0, .22, age) * (1 - smooth(3.2, c.lifetime, age));
  }

  function pack() {
    let count = 0;
    const budget = TIERS[quality];
    activeCount = 0;
    for (let k = 0; k < MAX_CLOUDS; k++) {
      const c = clouds[k];
      if (!c.active) continue;
      activeCount++;
      const age = c.age, jet = 1 - Math.exp(-age * 1.65), spread = .22 + .245 * age;
      for (let j = 0; j < budget; j++) {
        const core = j < 6, f = fract(j * .61803398875 + c.seed * .31);
        const turn = j * 2.3999632297 + c.seed * TAU;
        const curl = turn + age * (core ? .20 : .34) + .24 * Math.sin(age * .65 + turn);
        const radial = (core ? .25 : .5 + f * .82) * spread;
        const u = Math.cos(curl) * radial, v = Math.sin(curl) * radial * (.73 + .24 * f);
        const axial = jet * (core ? .4 + f * 2.15 : .65 + f * 3.9);
        const x = c.ox + c.tx * axial + c.ux * u + c.vx * v + .105 * age;
        const y = c.oy + c.ty * axial + c.uy * u + c.vy * v + .032 * age;
        const z = c.oz + c.tz * axial + c.uz * u + c.vz * v + .055 * age;
        const radius = (core ? .64 + f * .40 : .40 + f * .48) + age * (core ? .16 : .19);
        const alpha = c.strength * (core ? .43 : .22) * Math.min(1.65, MAX_PUFFS / budget);
        const o = count * 8;
        poses[o] = x; poses[o + 1] = y; poses[o + 2] = z;
        poses[o + 3] = radius; poses[o + 4] = radius * (core ? .9 : .64 + f * .4);
        poses[o + 5] = alpha; poses[o + 6] = turn + age * (core ? -.075 : .11);
        poses[o + 7] = c.seed + f * 5;
        noise[count * 2 + 1] = age;
        const ex = eyeX - x, ey = eyeY - y, ez = eyeZ - z;
        distances[count] = ex * ex + ey * ey + ez * ez;
        // Bounded insertion sort, at most 48 puffs, in far-to-near order.
        let at = count;
        while (at > 0 && distances[order[at - 1]] < distances[count]) { order[at] = order[at - 1]; at--; }
        order[at] = count++;
      }
    }
    // Keep ages in scratch too, because sorted destinations may overwrite the
    // unsorted noise buffer before another instance reads its age.
    for (let i = 0; i < count; i++) distances[i] = noise[i * 2 + 1];
    for (let i = 0; i < count; i++) {
      const source = order[i], a = source * 8, b = i * 3, p = i * 4;
      centers[b] = poses[a]; centers[b + 1] = poses[a + 1]; centers[b + 2] = poses[a + 2];
      puffs[p] = poses[a + 3]; puffs[p + 1] = poses[a + 4]; puffs[p + 2] = poses[a + 5]; puffs[p + 3] = poses[a + 6];
      noise[i * 2] = poses[a + 7]; noise[i * 2 + 1] = distances[source];
    }
    geometry.instanceCount = count; mesh.visible = count > 0;
    centerAttribute.needsUpdate = true; puffAttribute.needsUpdate = true; noiseAttribute.needsUpdate = true;
  }

  function emit(event) {
    if (disposed || !event || !boundedPoint(event.origin) || !boundedPoint(event.direction)) return false;
    const id = typeof event.id === 'string' || typeof event.id === 'number' ? event.id : null;
    if (id !== null) for (let i = 0; i < MAX_CLOUDS; i++) if (clouds[i].active && clouds[i].id === id) return false;
    let c = clouds[0];
    for (let i = 0; i < MAX_CLOUDS; i++) {
      if (!clouds[i].active) { c = clouds[i]; break; }
      if (clouds[i].order < c.order) c = clouds[i];
    }
    const d = event.direction, length = Math.hypot(d.x, d.y, d.z);
    c.dx = length > 1e-9 ? d.x / length : 0;
    c.dy = length > 1e-9 ? d.y / length : -.19611613513818404;
    c.dz = length > 1e-9 ? d.z / length : .9805806756909202;
    c.tx = c.dx; c.ty = c.dy; c.tz = c.dz;
    orientBasis(c);
    c.bdx = c.dx; c.bdy = c.dy; c.bdz = c.dz; c.bendAngle = 0;
    c.bx = c.ux; c.by = c.uy; c.bz = c.uz;
    if (boundedPoint(event.bendDirection)) {
      const b = event.bendDirection, length = Math.hypot(b.x, b.y, b.z);
      if (length > 1e-9) {
        c.bdx = b.x / length; c.bdy = b.y / length; c.bdz = b.z / length;
        const dot = clamp(c.dx * c.bdx + c.dy * c.bdy + c.dz * c.bdz, -1, 1);
        const bx = c.bdx - dot * c.dx, by = c.bdy - dot * c.dy, bz = c.bdz - dot * c.dz;
        const span = Math.hypot(bx, by, bz);
        if (span > 1e-8) { c.bx = bx / span; c.by = by / span; c.bz = bz / span; }
        c.bendAngle = Math.min(Math.PI * .42, Math.acos(dot));
      }
    }
    c.active = true; c.id = id; c.order = ++serial; c.age = 0;
    c.seed = fract(serial * .7548776662466927); c.lifetime = 9.6 + c.seed * 1.6;
    c.releasedAt = Number.isFinite(event.time) ? event.time : lastTime;
    c.ox = event.origin.x; c.oy = event.origin.y; c.oz = event.origin.z;
    refreshCloud(c); pack(); return true;
  }

  function update(dt, time, observer, tier = quality) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    // Analytic motion has no catch-up loop. A large stall expires old clouds.
    const delta = Math.min(dt, 60);
    elapsed += delta;
    if (Number.isFinite(time)) lastTime = time;
    if (Object.hasOwn(TIERS, tier)) quality = tier;
    if (boundedPoint(observer)) { eyeX = observer.x; eyeY = observer.y; eyeZ = observer.z; }
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const c = clouds[i];
      if (!c.active) continue;
      c.age += delta;
      if (c.age >= c.lifetime) { c.active = false; c.strength = 0; continue; }
      refreshCloud(c);
    }
    pack();
  }

  function sampleDensity(point) {
    if (disposed || !finitePoint(point)) return 0;
    let transmission = 1;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const c = clouds[i];
      if (!c.active || c.strength <= 0) continue;
      const x = point.x - c.x, y = point.y - c.y, z = point.z - c.z;
      const axial = (x * c.tx + y * c.ty + z * c.tz) / c.axialRadius;
      const u = (x * c.ux + y * c.uy + z * c.uz) / c.radialRadius;
      const v = (x * c.vx + y * c.vy + z * c.vz) / c.radialRadius;
      const r2 = axial * axial + u * u + v * v;
      if (r2 >= 1) continue;
      transmission *= 1 - c.strength * (1 - smooth(.04, 1, r2));
    }
    return clamp(1 - transmission, 0, 1);
  }

  function reset() {
    if (disposed) return;
    for (let i = 0; i < MAX_CLOUDS; i++) { clouds[i].active = false; clouds[i].id = null; clouds[i].age = 0; clouds[i].strength = 0; }
    serial = 0; elapsed = 0; lastTime = 0; activeCount = 0;
    geometry.instanceCount = 0; mesh.visible = false;
    centers.fill(0); puffs.fill(0); noise.fill(0);
    centerAttribute.needsUpdate = true; puffAttribute.needsUpdate = true; noiseAttribute.needsUpdate = true;
  }

  function snapshot() {
    return { disposed, time: elapsed, lastTime, quality, activeClouds: activeCount,
      instances: geometry.instanceCount, drawCalls: mesh.visible && !disposed ? 1 : 0,
      clouds: clouds.filter(c => c.active).map(c => ({ id: c.id, order: c.order, age: c.age,
        lifetime: c.lifetime, releasedAt: c.releasedAt, strength: c.strength,
        origin: { x: c.ox, y: c.oy, z: c.oz }, direction: { x: c.dx, y: c.dy, z: c.dz },
        bendDirection: { x: c.bdx, y: c.bdy, z: c.bdz },
        plumeDirection: { x: c.tx, y: c.ty, z: c.tz },
        center: { x: c.x, y: c.y, z: c.z }, axialRadius: c.axialRadius, radialRadius: c.radialRadius })) };
  }

  function dispose() {
    if (disposed) return;
    reset(); disposed = true; root.removeFromParent(); geometry.dispose(); material.dispose();
  }
  return { root, emit, update, sampleDensity, snapshot, reset, dispose, stats: INK_CLOUD_LIMITS };
}
