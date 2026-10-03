import * as THREE from './vendor/three.module.js';

// Original, bounded kinematic/drag approximation. Bell vertices and every
// articulated chain are posed on the CPU; this is not a fluid simulation.
const TAU = Math.PI * 2;
const STEP = 1 / 60;
const TRAIL_RATES = [8,3.2,1.6];
const BELL_RINGS = 14, BELL_SIDES = 32, CHAIN_SEGMENTS = 16;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const fraction = x => x - Math.floor(x);
const contractionAt = cycle => {
  const p = fraction(cycle);
  return p < .24 ? smooth(p / .24) : p < .34 ? 1 : p < .82 ? 1 - smooth((p - .34) / .48) : 0;
};

/** Normalized cycle: quick contraction, a short squeeze, then slow refill. */
export function sampleJellyPulse(cycle, out = {}) {
  const p = fraction(cycle);
  out.phase = p;
  out.contraction = contractionAt(p);
  out.thrust = p < .24 ? Math.sin(Math.PI * p / .24) ** 2 : 0;
  out.stage = p < .24 ? 'contract' : p < .34 ? 'squeeze' : p < .82 ? 'recover' : 'glide';
  return out;
}

const HABITATS = [
  // Shallow animals introduce the silhouette; two larger animals live deeper.
  { x: -10, z: -24, lift: 10, size: .86, phase: .06, rate: .29, hue: .52 },
  { x: 8, z: -47, lift: 13, size: 1.04, phase: .43, rate: .255, hue: .57 },
  { x: 31, z: -111, lift: 16, size: 1.28, phase: .72, rate: .224, hue: .64 },
  { x: -37, z: -173, lift: 18, size: 1.12, phase: .27, rate: .241, hue: .59 }
];
const TIERS = {
  high: { range: 86, filaments: 12, bellStep: 1, poseInterval: 0 },
  medium: { range: 66, filaments: 8, bellStep: 1, poseInterval: 0 },
  low: { range: 43, filaments: 4, bellStep: 2, poseInterval: 1 / 30 }
};

const VERTEX_SHADER = `
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vToEye;
  varying vec2 vJellyUv;
  varying float vDepth;
  varying float vUp;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
    vTint = color;
    vNormal = normalize(normalMatrix * normal);
    vUp = normalize(mat3(modelMatrix) * normal).y;
    vToEye = -mvPosition.xyz;
    vJellyUv = uv;
    vDepth = max(0., -(modelMatrix * vec4(position, 1.)).y);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const FRAGMENT_SHADER = `
  uniform float uBell;
  uniform sampler2D uTissue;
  uniform float uTissueReady;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vToEye;
  varying vec2 vJellyUv;
  varying float vDepth;
  varying float vUp;
  #include <fog_pars_fragment>
  void main() {
    vec3 normal = normalize(vNormal);
    float rim = pow(1. - abs(dot(normal, normalize(vToEye))), 1.65);
    float veins = pow(max(0., cos(vJellyUv.x * 75.3982237)), 28.)
      * smoothstep(.06, .55, vJellyUv.y) * uBell;
    float margin = exp(-pow((vJellyUv.y - .965) * 32., 2.)) * uBell;
    // Procedural marine tissue remains available while loading or on failure.
    float light = .50 + .30 * max(vUp, 0.) + .14 * rim;
    vec3 tint = vTint * light + vec3(.34, .49, .61) * (veins * .27 + margin * .18);
    float alpha = mix(.74, .19 + .39 * rim + .16 * veins + .12 * margin, uBell);
    if (uTissueReady > .5) {
      // One linear DATA atlas: R canals/fibres, G internal warm tissue,
      // B pleats/margin, A thickness. Alpha is not compositing opacity.
      float tissueV = clamp(vJellyUv.y, 0., 1.);
      float bellV = (4.5 + 375.0 * tissueV) / 512.0;
      float trailV = (388.5 + 119.0 * tissueV) / 512.0;
      vec4 tissue = texture2D(uTissue, vec2(fract(vJellyUv.x), mix(trailV, bellV, uBell)));
      tint = mix(vTint * light, vec3(.49, .32, .43) * light, .32 * tissue.g);
      tint += vec3(.70, .85, .91) * (.075 * tissue.r)
        + vec3(.10, .18, .23) * (.09 * tissue.b);
      tint *= .97 + .03 * tissue.a;
      float bellAlpha = clamp(.15 + .35 * rim + .12 * tissue.r + .13 * tissue.b
        + .10 * tissue.a + .05 * tissue.g, .12, .70);
      float trailAlpha = clamp(.30 + .24 * tissue.a + .11 * tissue.b + .06 * rim, .24, .73);
      alpha = mix(trailAlpha, bellAlpha, uBell);
    }
    tint *= exp(-vec3(.014, .004, .0015) * vDepth);
    gl_FragColor = vec4(tint, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function makeMaterial(name, bell, tissue, tissueReady) {
  const material = new THREE.ShaderMaterial({
    name, vertexColors: true, transparent: true, depthTest: true, depthWrite: false,
    side: THREE.DoubleSide, fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uBell: { value: bell ? 1 : 0 },
      uTissue: tissue, uTissueReady: tissueReady },
    vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER
  });
  // A double-sided transparent shell normally costs two draws in Three. Thin
  // tissue needs only one; no transmission pass, lights or render targets.
  material.forceSinglePass = true;
  return material;
}

function bellIndex(step) {
  const indices = [], stride = BELL_SIDES + 1;
  for (let j = 0; j < BELL_RINGS; j += step) {
    for (let i = 0; i < BELL_SIDES; i += step) {
      const a = j * stride + i, b = (j + step) * stride + i;
      // One triangle at the pole avoids a ring of zero-area faces.
      if (j === 0) indices.push(a, b + step, b);
      else indices.push(a, a + step, b, b, a + step, b + step);
    }
  }
  return new Uint16Array(indices);
}

function makeBell(highIndex, lowIndex, hue) {
  const count = (BELL_RINGS + 1) * (BELL_SIDES + 1);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2), colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let j = 0; j <= BELL_RINGS; j++) for (let i = 0; i <= BELL_SIDES; i++) {
    const index = j * (BELL_SIDES + 1) + i, v = j / BELL_RINGS;
    uv[index * 2] = i / BELL_SIDES; uv[index * 2 + 1] = v;
    color.setHSL(hue + .05 * v, .27 + .13 * v, .7 + .09 * v);
    color.toArray(colors, index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(highIndex), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, highIndex.length);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .45, 0), 1.8);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1.5, -.4, -1.5), new THREE.Vector3(1.5, 1.7, 1.5));
  return { geometry, positions, normals, highIndex, lowIndex };
}

// Write a point on a shell whose lower wall moves considerably more than its
// crown. The upturned, scalloped skirt curls inward during the squeeze.
function bellPoint(v, a, contraction, time, individuality, out, offset) {
  const theta = v * Math.PI * .515;
  const skirt = v * v * v;
  const asymmetry = .026 * Math.sin(a * 3 + individuality + time * .28) * v * v;
  const radius = Math.sin(theta) * (1 - contraction * (.075 + .265 * skirt))
    * (1 + .037 * Math.cos(a * 12) * skirt + asymmetry);
  out[offset] = Math.cos(a) * radius;
  out[offset + 1] = .16 + Math.cos(theta) * (.9 + .14 * contraction)
    + .13 * contraction * v ** 5 + .022 * Math.sin(a * 12) * skirt;
  out[offset + 2] = Math.sin(a) * radius;
}

function poseBell(entry, time) {
  const { bell, pulse } = entry;
  const p = bell.positions, n = bell.normals, stride = BELL_SIDES + 1;
  for (let j = 0; j <= BELL_RINGS; j++) for (let i = 0; i <= BELL_SIDES; i++) {
    bellPoint(j / BELL_RINGS, i / BELL_SIDES * TAU, pulse.contraction, time, entry.seed, p, (j * stride + i) * 3);
  }
  // Finite differences use existing positions, including asymmetric scallops.
  // No computeVertexNormals temporary vectors or per-frame buffer allocations.
  for (let j = 0; j <= BELL_RINGS; j++) for (let i = 0; i <= BELL_SIDES; i++) {
    const o = (j * stride + i) * 3;
    if (j === 0) { n[o] = 0; n[o + 1] = 1; n[o + 2] = 0; continue; }
    const before = (j * stride + (i + BELL_SIDES - 1) % BELL_SIDES) * 3;
    const after = (j * stride + (i + 1) % BELL_SIDES) * 3;
    const upper = ((j - 1) * stride + i) * 3;
    const lower = (Math.min(BELL_RINGS, j + 1) * stride + i) * 3;
    const ax = p[after] - p[before], ay = p[after + 1] - p[before + 1], az = p[after + 2] - p[before + 2];
    const bx = p[lower] - p[upper], by = p[lower + 1] - p[upper + 1], bz = p[lower + 2] - p[upper + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const inv = 1 / Math.max(.00001, Math.hypot(nx, ny, nz));
    n[o] = nx * inv; n[o + 1] = ny * inv; n[o + 2] = nz * inv;
  }
  bell.geometry.attributes.position.needsUpdate = true;
  bell.geometry.attributes.normal.needsUpdate = true;
}

function makeTrails(hue) {
  const chains = [], indices = [], color = new THREE.Color();
  let vertexCount = 0;
  // Oral arms are wide, thin ruffled lobes; the fine marginal tentacles follow.
  // Index ordering means tiers can trim only the optional peripheral filaments.
  for (let index = 0; index < 16; index++) {
    const oral = index < 4, number = oral ? index : index - 4;
    const angle = number / (oral ? 4 : 12) * TAU + (oral ? .32 : 0);
    const sides = oral ? 6 : 4, length = oral ? 1.82 + number * .11 : 2.6 + (number % 5) * .16;
    const chain = { oral, angle, sides, length, vertexStart: vertexCount,
      points: new Float32Array((CHAIN_SEGMENTS + 1) * 3) };
    for (let j = 0; j < CHAIN_SEGMENTS; j++) for (let k = 0; k < sides; k++) {
      const a = vertexCount + j * sides + k, b = vertexCount + j * sides + (k + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
    chains.push(chain); vertexCount += (CHAIN_SEGMENTS + 1) * sides;
  }
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3), uv = new Float32Array(vertexCount * 2);
  for (const chain of chains) for (let j = 0; j <= CHAIN_SEGMENTS; j++) for (let k = 0; k < chain.sides; k++) {
    const index = chain.vertexStart + j * chain.sides + k, u = j / CHAIN_SEGMENTS;
    uv[index * 2] = k / chain.sides; uv[index * 2 + 1] = u;
    color.setHSL(hue + (chain.oral ? .035 : -.025) + .075 * u, .27, chain.oral ? .72 : .78);
    color.toArray(colors, index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1.4, 0), 3.7);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-3, -3.5, -3), new THREE.Vector3(3, .9, 3));
  return { chains, geometry, positions, normals };
}

function poseTrails(entry, time, filaments) {
  const { trails, pulse } = entry, p = trails.positions, n = trails.normals;
  const cycle = time * entry.rate + entry.phaseOffset;
  // Transform drift into the slowly yawing creature's local space. Trails lean
  // opposite its translation, with delayed pulse bending down each chain.
  const yaw = entry.root.rotation.y, cs = Math.cos(yaw), sn = Math.sin(yaw);
  // Cascaded velocity memories make distal tissue retain the old wake/turn
  // direction briefly. This is bounded kinematic lag, not simulated fluid.
  const nearX=entry.trailVelocity[0],nearZ=entry.trailVelocity[1];
  const midX=entry.trailVelocity[2],midZ=entry.trailVelocity[3];
  const tipX=entry.trailVelocity[4],tipZ=entry.trailVelocity[5];
  for (let index = 0; index < 4 + filaments; index++) {
    const chain = trails.chains[index], points = chain.points, a = chain.angle;
    const ca = Math.cos(a), sa = Math.sin(a), step = chain.length / CHAIN_SEGMENTS;
    if (chain.oral) {
      points[0] = ca * .27; points[1] = .45 + .06 * pulse.contraction; points[2] = sa * .27;
    } else bellPoint(1, a, pulse.contraction, time, entry.seed, points, 0);
    for (let j = 1; j <= CHAIN_SEGMENTS; j++) {
      const u = j / CHAIN_SEGMENTS;
      const lag = u * (chain.oral ? .9 : 1.55) + index * .018;
      const delayed = contractionAt(cycle - lag * entry.rate);
      const wave = (time - lag) * (chain.oral ? 1.62 : 1.23) + a * 1.7 + entry.seed;
      const flex = (chain.oral ? .27 : .34) * u;
      const blend=u<.5?u*2:(u-.5)*2;
      const lagX=u<.5?nearX+(midX-nearX)*blend:midX+(tipX-midX)*blend;
      const lagZ=u<.5?nearZ+(midZ-nearZ)*blend:midZ+(tipZ-midZ)*blend;
      const dragX=-(lagX*cs-lagZ*sn)*1.65,dragZ=-(lagX*sn+lagZ*cs)*1.65;
      const tissueCurl=.10+(chain.oral?1.35:.8)*delayed*Math.pow(u,1.55);
      const radial=Math.sin(tissueCurl);
      // Distinct bending planes and unequal phases avoid identical sinusoidal
      // ribbons. Each normalized link retains its own rest length.
      const dx = dragX * (.25 + .75 * u) + ca * radial
        + Math.sin(wave - u * 4.8) * flex;
      const dz = dragZ * (.25 + .75 * u) + sa * radial
        + Math.cos(wave * .81 - u * 5.6 + a) * flex;
      const dy = -Math.cos(tissueCurl) + .06 * Math.sin(wave * .67 + u * 3) * u;
      const scale = step / Math.hypot(dx, dy, dz), at = j * 3, prior = at - 3;
      points[at] = points[prior] + dx * scale;
      points[at + 1] = points[prior + 1] + dy * scale;
      points[at + 2] = points[prior + 2] + dz * scale;
    }
    for (let j = 0; j <= CHAIN_SEGMENTS; j++) {
      const u = j / CHAIN_SEGMENTS, at = j * 3;
      const previous = Math.max(0, j - 1) * 3, next = Math.min(CHAIN_SEGMENTS, j + 1) * 3;
      let tx = points[next] - points[previous], ty = points[next + 1] - points[previous + 1], tz = points[next + 2] - points[previous + 2];
      const inv = 1 / Math.hypot(tx, ty, tz); tx *= inv; ty *= inv; tz *= inv;
      const planar = 1 / Math.hypot(tx, ty), ux = -ty * planar, uy = tx * planar;
      const vx = -tz * uy, vy = tz * ux, vz = tx * uy - ty * ux;
      const twist = a + u * 1.55 + .2 * Math.sin(time * 1.1 - u * 3.5 + a);
      const c = Math.cos(twist), s = Math.sin(twist);
      const ex = ux * c + vx * s, ey = uy * c + vy * s, ez = vz * s;
      const fx = vx * c - ux * s, fy = vy * c - uy * s, fz = vz * c;
      const ruffle = 1 + .28 * Math.sin(u * 26 - time * 1.7 + a) * Math.sin(u * Math.PI);
      const width = chain.oral ? (.055 + .17 * Math.sin(Math.PI * u) ** .65) * (1 - .62 * u) * ruffle : .004 + .023 * (1 - u) ** .7;
      const thickness = chain.oral ? .026 * (1 - .65 * u) : width;
      for (let k = 0; k < chain.sides; k++) {
        const angle = k / chain.sides * TAU, cx = Math.cos(angle), sy = Math.sin(angle);
        const o = (chain.vertexStart + j * chain.sides + k) * 3;
        p[o] = points[at] + ex * cx * width + fx * sy * thickness;
        p[o + 1] = points[at + 1] + ey * cx * width + fy * sy * thickness;
        p[o + 2] = points[at + 2] + ez * cx * width + fz * sy * thickness;
        const nx = ex * cx / width + fx * sy / thickness, ny = ey * cx / width + fy * sy / thickness, nz = ez * cx / width + fz * sy / thickness;
        const ni = 1 / Math.hypot(nx, ny, nz);
        n[o] = nx * ni; n[o + 1] = ny * ni; n[o + 2] = nz * ni;
      }
    }
  }
  trails.geometry.attributes.position.needsUpdate = true;
  trails.geometry.attributes.normal.needsUpdate = true;
}

/**
 * Four independent jellyfish. Positive dt drives a fixed 60 Hz motion model;
 * time aligns its initial phase and permits a new-dive clock reset. dt === 0
 * freezes simulation, including visibility, quality, shape and buffer versions.
 * No per-frame geometry, material, vector or array allocation. snapshot() is a
 * diagnostic copy, deliberately outside the render/update path.
 * The one shared tissue atlas starts loading only on the first visible update.
 * textureLoader may supply loadAsync(url), returning a fresh, exclusively owned
 * Three texture. onAsset receives { id:'jelly-tissue', status:'ready'|'error',
 * message? }. Async asset arrival can finish while simulation is paused.
 * Read-only tissueStatus is idle/loading/ready/error/disposed; procedural
 * shading is used until ready. This status is separate from motion snapshot().
 */
export function createJellyfishColony(scene, { terrain = () => -32, textureLoader,
  tissueURL = './assets/abyss/jelly-tissue-atlas-512.png', onAsset } = {}) {
  const root = new THREE.Group(); root.name = 'Jellyfish colony / original articulated organisms'; scene.add(root);
  const highIndex = bellIndex(1), lowIndex = bellIndex(2);
  const tissue = { value: null }, tissueReady = { value: 0 };
  const bellMaterial = makeMaterial('Jellyfish / thin translucent bell', true, tissue, tissueReady);
  const trailMaterial = makeMaterial('Jellyfish / oral tissue and filaments', false, tissue, tissueReady);
  const entries = [];
  let tissueState = 'idle', tissueTexture = null;
  let disposed = false, elapsed = 0, accumulator = 0, initialized = false, lastExternalTime = 0;
  let quality = 'high', posedVertices = 0, visible = 0;
  for (let i = 0; i < HABITATS.length; i++) {
    const habitat = HABITATS[i], homeY = Math.min(-5, terrain(habitat.x, habitat.z) + habitat.lift);
    const group = new THREE.Group(); group.name = `Jellyfish ${i + 1} / ${i < 2 ? 'shelf' : 'deep'}`;
    group.position.set(habitat.x, homeY, habitat.z); group.scale.setScalar(habitat.size); group.visible = false; root.add(group);
    const bell = makeBell(highIndex, lowIndex, habitat.hue), trails = makeTrails(habitat.hue);
    const bellMesh = new THREE.Mesh(bell.geometry, bellMaterial), trailMesh = new THREE.Mesh(trails.geometry, trailMaterial);
    bellMesh.name = 'Deforming bell'; trailMesh.name = 'Articulated oral arms and marginal tentacles';
    group.add(bellMesh, trailMesh);
    const entry = { root: group, bell, trails, homeX: habitat.x, homeY, homeZ: habitat.z,
      size: habitat.size, rate: habitat.rate, phaseOffset: habitat.phase, seed: i * 1.731 + .37,
      vx: 0, vy: 0, vz: 0, trailVelocity: new Float64Array(6), avoidance: 0, ax: 0, az: 0, pulse: sampleJellyPulse(habitat.phase),
      lastPoseTime: -1, detail: 12, lastTier: 'high', state: 'drift' };
    poseBell(entry, 0); poseTrails(entry, 0, 12); entries.push(entry);
  }

  function reportAsset(status, message) {
    try { onAsset?.({ id: 'jelly-tissue', status, ...(message ? { message } : {}) }); }
    catch { /* Reporting must not change fallback behavior or resource ownership. */ }
  }

  function releaseTissue() {
    const texture = tissueTexture;
    tissueTexture = null; tissue.value = null; tissueReady.value = 0;
    texture?.dispose();
  }

  async function loadTissue() {
    if (disposed || tissueState !== 'idle') return;
    tissueState = 'loading';
    try {
      const texture = await (textureLoader || new THREE.TextureLoader()).loadAsync(tissueURL);
      if (!texture?.isTexture) throw new TypeError('Jelly tissue loader must return a Three texture');
      tissueTexture = texture;
      if (disposed) { releaseTissue(); return; }
      texture.name = 'Jellyfish / original shared tissue DATA atlas';
      texture.colorSpace = THREE.NoColorSpace; texture.flipY = true; texture.premultiplyAlpha = false;
      texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true; texture.anisotropy = 2; texture.needsUpdate = true;
      tissue.value = texture; tissueReady.value = 1; tissueState = 'ready';
      reportAsset('ready');
    } catch (error) {
      releaseTissue();
      if (disposed) return;
      tissueState = 'error'; reportAsset('error', error?.message || String(error));
    }
  }

  function reset(at) {
    elapsed = at; accumulator = 0;
    for (const entry of entries) {
      entry.root.position.set(entry.homeX, entry.homeY, entry.homeZ); entry.root.rotation.set(0, 0, 0);
      entry.vx = entry.vy = entry.vz = entry.avoidance = entry.ax = entry.az = 0; entry.trailVelocity.fill(0);
      entry.lastPoseTime = -1; entry.state = 'drift';
    }
  }

  function advance(entry, player) {
    const p = entry.root.position;
    sampleJellyPulse(elapsed * entry.rate + entry.phaseOffset, entry.pulse);
    const dx = p.x - player.x, dz = p.z - player.z, dy = p.y - player.y;
    const distance = Math.hypot(dx, dy, dz), horizontal = Math.hypot(dx, dz);
    const response = 1 - smooth((distance - 1.5) / 6.5), relax = 1 - Math.exp(-STEP * 1.8);
    entry.avoidance += (response - entry.avoidance) * relax;
    const fallback = entry.seed + elapsed * .04;
    const awayX = horizontal > .05 ? dx / horizontal : Math.cos(fallback);
    const awayZ = horizontal > .05 ? dz / horizontal : Math.sin(fallback);
    entry.ax += (awayX * response * .27 - entry.ax) * relax;
    entry.az += (awayZ * response * .27 - entry.az) * relax;
    const currentX = Math.sin(elapsed * .113 + entry.seed) * .13;
    const currentZ = Math.cos(elapsed * .083 + entry.seed * .7) * .11;
    const pullX = (entry.homeX - p.x) * .035, pullZ = (entry.homeZ - p.z) * .035;
    const thrust = entry.pulse.thrust * (1.65 + entry.size * .12);
    const aimX = currentX + pullX + entry.ax, aimZ = currentZ + pullZ + entry.az;
    const turn = 1 - Math.exp(-STEP * 1.15);
    // Never continuously rotate about the bell: the animal slowly leans into
    // its swim axis, then the flexible trails catch up downstream.
    entry.root.rotation.x += (clamp(aimZ * .8, -.28, .28) - entry.root.rotation.x) * turn;
    entry.root.rotation.z += (clamp(-aimX * .8, -.28, .28) - entry.root.rotation.z) * turn;
    entry.root.rotation.y = Math.sin(elapsed * .047 + entry.seed) * .28;
    entry.vx += (aimX + thrust * -entry.root.rotation.z * .45 - entry.vx * .85) * STEP;
    entry.vz += (aimZ + thrust * entry.root.rotation.x * .45 - entry.vz * .85) * STEP;
    entry.vy += (thrust - .21 + (entry.homeY - p.y) * .12 - entry.vy * 1.5) * STEP;
    p.x += entry.vx * STEP; p.y += entry.vy * STEP; p.z += entry.vz * STEP;
    const memory=entry.trailVelocity;
    for(let k=0;k<3;k++){const response=1-Math.exp(-STEP*TRAIL_RATES[k]);
      const x=k===0?entry.vx:memory[(k-1)*2],z=k===0?entry.vz:memory[(k-1)*2+1];
      memory[k*2]+=(x-memory[k*2])*response;memory[k*2+1]+=(z-memory[k*2+1])*response;}
    // Finite habitats and full-tail floor clearance; these guards are normally
    // inactive because the gentle home force balances persistent current.
    const floor = terrain(p.x, p.z) + 3.9 * entry.size;
    const minY = Math.max(floor, entry.homeY - 3.6), maxY = Math.max(minY, Math.min(-2.2 - entry.size, entry.homeY + 3.6));
    if (p.y < minY) { p.y = minY; entry.vy = Math.max(0, entry.vy); }
    if (p.y > maxY) { p.y = maxY; entry.vy = Math.min(0, entry.vy); }
    if (Math.abs(p.x - entry.homeX) > 8) { p.x = entry.homeX + Math.sign(p.x - entry.homeX) * 8; entry.vx *= -.1; }
    if (Math.abs(p.z - entry.homeZ) > 8) { p.z = entry.homeZ + Math.sign(p.z - entry.homeZ) * 8; entry.vz *= -.1; }
    entry.state = entry.avoidance > .2 ? 'withdraw' : entry.pulse.thrust > .3 ? 'pulse' : entry.pulse.stage;
  }

  function update(dt, time, player, tier = 'medium') {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    // At most 15 cheap motion steps after a hitch. The game also caps frame dt.
    const delta = Math.min(dt, .25);
    if (!initialized || Number.isFinite(time) && time < lastExternalTime - 1e-6) {
      reset(Number.isFinite(time) ? Math.max(0, time - delta) : 0); initialized = true;
    }
    if (Number.isFinite(time)) lastExternalTime = time;
    accumulator += delta;
    while (accumulator + 1e-10 >= STEP) {
      elapsed += STEP; accumulator = Math.max(0, accumulator - STEP);
      for (const entry of entries) advance(entry, player);
    }
    quality = Object.hasOwn(TIERS, tier) ? tier : 'medium';
    const detail = TIERS[quality]; visible = 0; posedVertices = 0;
    for (const entry of entries) {
      const p = entry.root.position, distance = Math.hypot(player.x - p.x, player.y - p.y, player.z - p.z);
      const wasVisible = entry.root.visible;
      entry.root.visible = distance < detail.range;
      if (!entry.root.visible) continue;
      visible++;
      if (!wasVisible || entry.lastTier !== quality || elapsed - entry.lastPoseTime + 1e-9 >= detail.poseInterval) {
        entry.detail = detail.filaments;
        if (entry.lastTier !== quality) {
          const index = detail.bellStep === 2 ? lowIndex : highIndex;
          entry.bell.geometry.index.array.set(index);
          entry.bell.geometry.index.needsUpdate = true;
          entry.bell.geometry.setDrawRange(0, index.length);
        }
        entry.trails.geometry.setDrawRange(0, (4 * 6 + detail.filaments * 4) * CHAIN_SEGMENTS * 6);
        poseBell(entry, elapsed); poseTrails(entry, elapsed, detail.filaments);
        entry.lastPoseTime = elapsed; entry.lastTier = quality;
        posedVertices += entry.bell.geometry.attributes.position.count + (4 * 6 + detail.filaments * 4) * (CHAIN_SEGMENTS + 1);
      }
    }
    if (visible && tissueState === 'idle') void loadTissue();
  }

  function snapshot(includeChains = false) {
    return { disposed, time: elapsed, accumulator, quality, visible, posedVertices,
      creatures: entries.map(entry => ({
        name: entry.root.name, visible: entry.root.visible, state: entry.state,
        position: entry.root.position.toArray(), rotation: entry.root.rotation.toArray().slice(0, 3),
        velocity: [entry.vx, entry.vy, entry.vz], trailingVelocity: Array.from(entry.trailVelocity), avoidance: entry.avoidance,
        home: [entry.homeX, entry.homeY, entry.homeZ], size: entry.size, rate: entry.rate,
        phase: entry.pulse.phase, contraction: entry.pulse.contraction, thrust: entry.pulse.thrust, stage: entry.pulse.stage,
        filaments: entry.detail, bellVertices: entry.bell.geometry.attributes.position.count,
        bellTriangles: entry.bell.geometry.drawRange.count / 3, trailTriangles: Math.min(entry.trails.geometry.drawRange.count, entry.trails.geometry.index.count) / 3,
        ...(includeChains ? { chains: entry.trails.chains.map(chain => ({
          oral: chain.oral, length: chain.length, points: Array.from(chain.points)
        })) } : {})
      })) };
  }

  function dispose() {
    if (disposed) return; disposed = true; visible = posedVertices = 0;
    scene.remove(root);
    for (const entry of entries) { entry.root.visible = false; entry.bell.geometry.dispose(); entry.trails.geometry.dispose(); }
    releaseTissue();
    bellMaterial.dispose(); trailMaterial.dispose(); root.clear();
  }

  const stats = Object.freeze({
    maxJellyfish: 4, meshes: 8, geometries: 8, materials: 2, maxDrawCalls: 8,
    vertices: entries.reduce((sum, entry) => sum + entry.bell.geometry.attributes.position.count + entry.trails.geometry.attributes.position.count, 0),
    maxTriangles: entries.reduce((sum, entry) => sum + highIndex.length / 3 + entry.trails.geometry.index.count / 3, 0),
    maxSegments: 4 * 16 * CHAIN_SEGMENTS, motionStep: STEP, maxMotionSteps: 15,
    lodPolicy: 'High: 12 marginal tentacles, 86m. Medium: 8, 66m. Low: 4, coarse bell, 30Hz pose, 43m. Four oral arms remain at every tier.',
    motionModel: 'Pulsed bell deformation, fixed-step thrust/drag, delayed length-preserving chain bends; no fluid simulation.'
  });
  return { root, update, dispose, stats, snapshot,
    get tissueStatus() { return disposed ? 'disposed' : tissueState; } };
}
