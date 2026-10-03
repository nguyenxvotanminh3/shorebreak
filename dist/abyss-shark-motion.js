import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = value => clamp(finite(value), 0, 1);
const smooth = value => { const t = unit(value); return t * t * (3 - 2 * t); };
const key = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const JOINTS = ['root', 'body', 'spine', 'tailbase', 'tailtip', 'pectoralL', 'pectoralR'];
const wave = (angle, effort) => (Math.sin(angle) + (.055 + .04 * effort) * Math.sin(2 * angle)) / 1.055;

/** Additive, kinematic shark articulation for the actual corrected-v3 rigs.
 *
 * Call AFTER the parent's AnimationMixer.setTime(motion.clipTime). The parent
 * owns phase, clipTime, smoothed action weights, movement, heading and banking
 * of the world-space container. Nothing here advances a second clock: the same
 * motion is the same pose at either LOD, including dt=0 and late-loaded models.
 *
 * Three's mixer can skip unchanged property writes, even after setTime. We
 * therefore resample each controlled joint's authored quaternion with cached
 * track interpolants before adding an offset. Multiplying whatever quaternion
 * happens to remain on the bone would accumulate a bank on the constant root
 * track. This also preserves the asset's non-identity bind orientations.
 *
 * Local Z is lateral flexion on this body/tail chain, not vertical fluking.
 * The two pectorals have rotated local axes: X changes lift, Y feathers the fin.
 * The dorsal surface is weighted to body/spine; there is no dorsal joint. It
 * stabilizes with that trunk instead of being flapped or assigned a fake bone.
 * The unweighted jaw is deliberately untouched. This is bounded animation,
 * not a fluid solver, a muscle simulation, or a change to mesh/skin resources.
 */
export function createSharkMotion(model, clips = []) {
  const bones = new Map();
  model.traverse(node => { if (node.isBone) bones.set(key(node.name), node); });
  const clip = clips.find(candidate => candidate.tracks.some(track => /(?:tail\.?base|tail\.?tip)\.quaternion$/i.test(track.name))) || clips[0];
  const records = JOINTS.map(name => {
    const bone = bones.get(key(name));
    const track = bone && clip?.tracks.find(candidate => candidate.name === `${bone.name}.quaternion`);
    return { name, bone, bind: bone?.quaternion.clone(), sampler: track?.createInterpolant(), x: 0, y: 0, z: 0 };
  });
  const mapped = Object.fromEntries(records.map(record => [record.name, record.bone?.name || null]));
  const weighted = Object.fromEntries([...bones.keys()].map(name => [name, 0]));
  const seenGeometry = new Set();
  model.traverse(node => {
    if (!node.isSkinnedMesh || seenGeometry.has(node.geometry)) return;
    seenGeometry.add(node.geometry);
    const indices = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight');
    if (!indices || !weights) return;
    for (let vertex = 0; vertex < weights.count; vertex++) {
      for (let lane = 0; lane < weights.itemSize; lane++) {
        const bone = node.skeleton.bones[indices.array[vertex * indices.itemSize + lane]];
        if (bone) weighted[key(bone.name)] = (weighted[key(bone.name)] || 0) + weights.array[vertex * weights.itemSize + lane];
      }
    }
  });
  const delta = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'XYZ');
  let disposed = false, sampled = false, phase = 0, clipTime = 0, effort = 0, steering = 0, reaction = 0;

  function apply(index, x, y, z) {
    const record = records[index];
    if (!record.bone) return;
    record.x = x; record.y = y; record.z = z;
    if (record.sampler) record.bone.quaternion.fromArray(record.sampler.evaluate(clipTime));
    else record.bone.quaternion.copy(record.bind);
    delta.setFromEuler(euler.set(x, y, z));
    record.bone.quaternion.multiply(delta).normalize();
  }

  function update(_dt, motion = {}) {
    if (disposed) return;
    phase = finite(motion.phase) % TAU;
    if (phase < 0) phase += TAU;
    const duration = finite(clip?.duration);
    const requestedTime = finite(motion.clipTime, phase / TAU * duration);
    clipTime = duration > 0 ? ((requestedTime % duration) + duration) % duration : 0;
    const speed = smooth((Math.max(0, finite(motion.speed, 1.7)) - .25) / 3.25);
    const accelerate = unit(motion.accelerateWeight);
    const turn = unit(motion.turnWeight);
    const alert = unit(motion.alert);
    reaction = unit(finite(motion.reactWeight, alert)) * (.45 + .55 * alert);
    const acceleration = Math.tanh(finite(motion.acceleration) / 1.8);
    effort = clamp(speed * .72 + accelerate * .25 + Math.max(0, acceleration) * .12 + reaction * .18, 0, 1);
    steering = Math.tanh(finite(motion.turnRate) / .38) * (.28 + .72 * turn);

    // A rearward-travelling curvature wave, with successively larger joint
    // excursions. Integer harmonics keep every phase wrap seamless; the small
    // second harmonic makes loading/recovery less metronomic without noise.
    const body = (.012 + .014 * effort) * wave(phase, effort);
    const spine = (.025 + .04 * effort) * wave(phase - .48, effort);
    const peduncle = (.045 + .08 * effort) * wave(phase - 1, effort);
    const caudal = (.065 + .11 * effort) * wave(phase - 1.65, effort);

    // Bank at the skeleton root about the forward axis, without translating
    // the scene root or replacing locomotion. The relatively stiff front body
    // stays quiet while caudal propulsion and a shallow steering C-curve build
    // toward the tail. Dorsal-weighted trunk stays restrained under this bank.
    apply(0, .018 * acceleration * (.2 + .8 * accelerate) + .009 * reaction, -.18 * steering, 0);
    apply(1, .004 * reaction * Math.sin(2 * phase + .6), .009 * steering, body + .019 * steering);
    apply(2, -.009 * steering, .012 * steering, spine + .043 * steering);
    apply(3, 0, 0, peduncle + .085 * steering);
    apply(4, 0, 0, caudal + .12 * steering + .024 * reaction * Math.sin(2 * phase - 2.2));

    // Pectorals are control surfaces, not birdlike paddles. Small shared lift
    // corrections ride the tail beat; signed differential lift/incidence makes
    // turning and braking visibly distinct from faster straight swimming.
    const lift = .016 * Math.cos(phase + .35) + .022 * accelerate - .027 * Math.min(0, acceleration) + .035 * reaction;
    const feather = .012 * Math.sin(phase - .2) + .038 * accelerate + .028 * reaction;
    const sweep = .018 * effort + .023 * reaction;
    apply(5, lift - .105 * steering, feather + .045 * steering, sweep);
    apply(6, lift + .105 * steering, -feather + .045 * steering, -sweep);
    sampled = true;
  }

  function dispose() {
    if (disposed) return;
    // Restore the last authored pose but do not dispose shared model resources:
    // geometry, textures, skeleton and mixers belong to the life controller.
    if (sampled) {
      for (const record of records) {
        if (!record.bone) continue;
        if (record.sampler) record.bone.quaternion.fromArray(record.sampler.evaluate(clipTime));
        else record.bone.quaternion.copy(record.bind);
      }
    }
    disposed = true;
  }

  function snapshot() {
    return {
      disposed, sampled, phase, clipTime, effort, steering, reaction,
      mapping: { ...mapped }, missing: records.filter(record => !record.bone).map(record => record.name),
      weighted: { ...weighted }, authoredClip: clip?.name || null,
      dorsal: 'body/spine skin weights; no independent dorsal joint',
      jaw: 'unweighted in the corrected-v3 shark; left untouched',
      offsets: Object.fromEntries(records.map(record => [record.name, { x: record.x, y: record.y, z: record.z }])),
    };
  }
  return { update, dispose, snapshot };
}
