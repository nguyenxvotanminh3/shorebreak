import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = value => clamp(finite(value), 0, 1);
const wrapped = phase => ((finite(phase) % TAU) + TAU) % TAU;
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

// A localized unrolling front travels base→tip, followed by slower recurling.
// Qualitative octopod-inspired power/recovery/glide timing, not fitted animal data.
export function sampleKrakenStroke(phase, segment=0, individuality=0, out={}) {
  const p=wrapped(phase+individuality*.13)/TAU, t=unit(segment);
  const forward=-.2+p/.31*1.4, recovery=-.2+(p-.38)/.50*1.4;
  out.extension=smooth(-.13,.13,forward-t)*(1-smooth(-.16,.16,recovery-t));
  out.bend=Math.exp(-Math.pow((forward-t-.08)/.19,2))*(1-smooth(.32,.40,p));
  out.recurl=Math.exp(-Math.pow((recovery-t)/.23,2))*smooth(.34,.40,p);
  out.stage=p<.31?'power / extend':p<.38?'extended glide':p<.88?'recover / curl':'curled glide';
  return out;
}
// Shared locomotion contract: positive sin(phase) contracts, peak at π/2.
// The negative half coasts/refills; the fourth power keeps seam derivatives smooth.
const jetPulse = phase => Math.pow(Math.max(0, Math.sin(phase)), 4);
const canonical = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Articulated overlay for the shipped 59-bone octopod-like Kraken.
 * Its real rig has a head, a single weighted mantle and eight seven-joint arms.
 * It has no independently weighted fin joints, so none are invented here.
 *
 * The caller owns behavior smoothing, phase, heading and displacement, and samples
 * its AnimationMixer at motion.clipTime before this call. We re-sample only touched
 * channels of the one authored clip: Three's mixer deliberately skips unchanged
 * values, so reading the last bone pose would accumulate overlays when paused or
 * when an animation channel is constant. No model geometry/material is allocated,
 * replaced or owned by this driver; no whole-model scale is animated.
 */
export function createKrakenMotion(model, clips = []) {
  const bones = new Map(), arms = [], entries = [];
  model.traverse(node => { if (node.isBone) bones.set(canonical(node.name), node); });
  const head = bones.get('head'), mantle = bones.get('mantle');
  const clip = clips[0], duration = finite(clip?.duration);
  const tracks = new Map();
  for (const track of clip?.tracks || []) {
    const dot = track.name.lastIndexOf('.');
    if (dot > 0) tracks.set(canonical(track.name.slice(0, dot)) + '.' + track.name.slice(dot + 1), track);
  }
  const scratchQ = new THREE.Quaternion(), scratchQ2 = new THREE.Quaternion();
  const headWorldQ = new THREE.Quaternion(), inverseQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');
  model.updateMatrixWorld(true);
  if (head) head.getWorldQuaternion(headWorldQ);

  // The authored funnel ends at Blender (0,-1.265,1.915). The exported vertex
  // buffers already include the rig's Z=π rotation and the Z-up→Y-up conversion:
  // its aperture center is (0,1.915,-1.265), NOT the oral/arm center. Both shipped
  // LODs preserve this head-weighted aperture. Use the real inverse bind rather
  // than the current (possibly animated) head matrix to cache its attachment.
  const siphonPosition = new THREE.Vector3(0, 1.915, -1.265);
  const siphonDirection = new THREE.Vector3(0, -Math.SQRT1_2, -Math.SQRT1_2);
  let siphonBound = false;
  if (head) model.traverse(node => {
    if (siphonBound || !node.isSkinnedMesh) return;
    const joint = node.skeleton.bones.indexOf(head);
    if (joint < 0) return;
    siphonPosition.applyMatrix4(node.bindMatrix).applyMatrix4(node.skeleton.boneInverses[joint]);
    siphonDirection.transformDirection(node.bindMatrix).transformDirection(node.skeleton.boneInverses[joint]);
    siphonBound = true;
  });

  function channel(node, property) {
    const track = tracks.get(canonical(node.name) + '.' + property);
    // Fixed-size interpolant results are reused at every frame.
    const sample = track?.createInterpolant();
    return { property, sample, rest: node[property].clone() };
  }
  function entry(node, properties) {
    if (!node) return null;
    const record = { node, channels: properties.map(property => channel(node, property)) };
    entries.push(record); return record;
  }
  const headEntry = entry(head, ['quaternion', 'position']);
  const mantleEntry = entry(mantle, ['quaternion', 'scale']);
  for (let arm = 1; arm <= 8; arm++) {
    const prefix = 'arm' + String(arm).padStart(2, '0');
    const base = bones.get(prefix + '01');
    if (!base) continue;
    const azimuth = Math.atan2(base.position.z, base.position.x);
    const side = Math.cos(azimuth), front = Math.sin(azimuth);
    for (let segment = 1; segment <= 7; segment++) {
      const node = bones.get(prefix + String(segment).padStart(2, '0'));
      if (!node) continue;
      node.getWorldQuaternion(inverseQ).invert();
      // Bone-local anatomical bend axes, derived from the actual bind chain.
      // The GLTF exporter rotates every local frame differently, so a uniform
      // local Euler rotation would kink some arms sideways instead of curling.
      const bend = new THREE.Vector3(-front, 0, side).applyQuaternion(headWorldQ).applyQuaternion(inverseQ).normalize();
      const sway = new THREE.Vector3(side, 0, front).applyQuaternion(headWorldQ).applyQuaternion(inverseQ).normalize();
      arms.push({ ...entry(node, ['quaternion']), arm, segment, t: (segment - 1) / 6,
        side, front, bend, sway, offset: (arm - 1) * .43 + .12 * Math.sin(arm * 1.7) });
    }
  }
  const state = { phase: 0, clipTime: 0, jet: 0, alert: 0, turn: 0, drive: 0, stroke: 'curled glide' };
  const stroke = {};
  let disposed = false;

  function restore(time) {
    for (const record of entries) for (const c of record.channels) {
      if (c.sample) record.node[c.property].fromArray(c.sample.evaluate(time));
      else record.node[c.property].copy(c.rest);
    }
  }
  function update(_dt, motion = {}) {
    if (disposed) return;
    // In particular dt=0 is not an early return: the parent may just have
    // re-sampled the mixer. Reapplying the exact pose keeps pause and LOD stable.
    const phase = wrapped(motion.phase);
    const clipTime = finite(motion.clipTime, duration > 0 ? phase / TAU * duration : 0);
    const sampleTime = duration > 0 ? ((clipTime % duration) + duration) % duration : 0;
    restore(sampleTime);
    const cruise = unit(motion.cruiseWeight ?? 1);
    const accelerating = unit(motion.accelerateWeight);
    const alert = Math.max(unit(motion.alert) * .8, unit(motion.reactWeight));
    const speed = clamp(finite(motion.speed) / 1.6, 0, 1);
    const acceleration = clamp(finite(motion.acceleration) / 1.2, -1, 1);
    const turn = clamp(finite(motion.turnRate) * 3, -1, 1) * (.35 + .65 * unit(motion.turnWeight));
    const drive = clamp(.35 + .22 * cruise + .34 * speed + .45 * accelerating + .13 * Math.max(0, acceleration), .25, 1.2);
    const jet = jetPulse(phase), refill = Math.sin(phase - .42);
    // Behavior owns the smoothed envelopes and their timing. There is no hidden
    // pose clock, stage switch or integration here, so pause/LOD/replay are exact.
    const defense = motion.inkDefense;
    const anticipation = unit(defense?.anticipation), contraction = unit(defense?.contraction);
    const armGather = unit(defense?.armGather), extension = unit(defense?.extension);
    const escape = unit(defense?.escapeStrength);
    const defenseWeight = Math.max(anticipation, contraction, armGather, extension, escape);
    // Local mantle narrowing and axial recovery deform weighted skin. The head
    // and arm bones do not inherit the mantle bone's local scale.
    if (mantleEntry) {
      const squeeze = (.058 + .048 * drive) * jet;
      mantle.scale.x *= 1 + .018 * refill - squeeze;
      mantle.scale.z *= 1 + .014 * refill - squeeze * .84;
      mantle.scale.y *= 1 - .012 * refill + squeeze * .32;
      euler.set(.022 * Math.sin(phase - .3) - .045 * accelerating * jet,
        turn * .035, -turn * .065 + alert * .013 * Math.sin(phase));
      mantle.quaternion.multiply(scratchQ.setFromEuler(euler)).normalize();
      if (defenseWeight > 0) {
        // Inflate before discharge, then compress the actual weighted mantle.
        // Its axial stretch is local; neither root nor whole-model scale changes.
        mantle.scale.x *= 1 + .075 * anticipation - .18 * contraction;
        mantle.scale.z *= 1 + .060 * anticipation - .16 * contraction;
        mantle.scale.y *= 1 - .035 * anticipation + .065 * contraction;
        euler.set(-.035 * contraction + .014 * anticipation, 0, 0);
        mantle.quaternion.multiply(scratchQ.setFromEuler(euler)).normalize();
      }
    }
    if (headEntry) {
      head.position.y += .038 * drive * jet - .013 * Math.sin(phase - .5);
      euler.set(.018 * Math.sin(phase - .35) + .032 * accelerating * jet - .018 * alert,
        .075 * turn, -.06 * turn + .009 * Math.sin(phase + .3));
      head.quaternion.multiply(scratchQ.setFromEuler(euler)).normalize();
      if (defenseWeight > 0) {
        head.position.y += .065 * contraction - .025 * anticipation;
        head.position.z -= .115 * contraction + .045 * escape;
        euler.set(-.09 * contraction + .025 * anticipation - .025 * escape, 0, 0);
        head.quaternion.multiply(scratchQ.setFromEuler(euler)).normalize();
      }
    }
    for (const arm of arms) {
      const t = arm.t, lag = .18 + 2.65 * t;
      const wavePhase = phase - lag - arm.offset;
      // The impulse reaches successive segments later; the tips keep moving
      // after the mantle relaxes instead of hinging the whole arm in unison.
      const wave = Math.sin(wavePhase) + .24 * Math.sin(2 * wavePhase + arm.arm * .61);
      const delayedJet = jetPulse(phase - lag);
      const amplitude = (.03 + .078 * t) * (.65 + .35 * cruise + .3 * speed) * (1 - .43 * alert);
      const reaction = (.038 - .017 * t) * drive * (delayedJet - .35);
      const streamline = -accelerating * (.058 * (1 - t) + .025 * t) * (.35 + .65 * delayedJet);
      const drag = .046 * acceleration * t * Math.sin(phase - lag - .4) + .018 * speed * t;
      // Cautious arms gather proximally and curl at the ends; opposing arms
      // differ slightly, rather than the whole animal adopting one sine pose.
      const gather = alert * (-.047 * (1 - t) + .118 * t * t) * (1 + .2 * arm.front);
      const steering = turn * arm.side * (.082 - .027 * t);
      sampleKrakenStroke(phase,t,Math.sin(arm.arm*1.79),stroke);
      // The authored rest arms are already strongly curled. Small wiggles alone
      // cannot read as extension: unwind their actual local anatomical bend,
      // progressively along the chain, without changing bone lengths or roots.
      const reach=clamp(stroke.extension*(.84+.12*drive)+alert*.14,0,1);
      const regional=arm.segment===1?.12:1;
      const unroll=regional*(-(.58+.055*t)*reach+.20*stroke.bend+.14*stroke.recurl);
      let curl = clamp(unroll + amplitude * wave*.6 + reaction + streamline + drag + gather + steering, -.79, .36);
      let lateral = clamp(.023 * (1 + t) * Math.sin(wavePhase + 1.15) * (1 - .5 * alert)
        + turn * (.045 + .024 * arm.front) * (1 - .4 * t)
        + alert * arm.side * .022 * t, -.12, .12);
      if (defenseWeight > 0) {
        // Jet extension travels base→tip. As contraction yields to escape, the
        // returning front curls the base first and leaves the tips trailing.
        // Both fronts use continuous envelopes even if the behavior stage changes.
        const outward = smooth(.04 + .50 * t, .38 + .58 * t, extension);
        const returning = smooth(.04 + .40 * (1 - t), .54 + .38 * (1 - t), extension);
        const recovery = escape * (1 - contraction);
        const reach = outward + (returning - outward) * recovery;
        const defenseCurl = armGather * (-.085 * (1 - t) + .22 * t * t) * (1 + .12 * arm.front)
          - (arm.segment === 1 ? .20 : 1) * (.58 + .055 * t) * reach
          - .035 * escape * (1 - t) + .025 * anticipation * t
          + amplitude * wave * .16 * (1 - .7 * contraction);
        curl = clamp(curl + (defenseCurl - curl) * defenseWeight, -.79, .36);
        lateral *= 1 - .65 * defenseWeight;
      }
      arm.node.quaternion.multiply(scratchQ.setFromAxisAngle(arm.bend, curl))
        .multiply(scratchQ2.setFromAxisAngle(arm.sway, lateral)).normalize();
    }
    sampleKrakenStroke(phase,0,0,stroke);
    Object.assign(state, { phase, clipTime, jet, alert, turn, drive, stroke: stroke.stage });
  }
  function snapshot() {
    return { ...state, disposed, bones: bones.size, arms: new Set(arms.map(a => a.arm)).size,
      joints: arms.length + (headEntry ? 1 : 0) + (mantleEntry ? 1 : 0),
      independentFins: 0, authoredDuration: duration,
      mantleScale: mantle ? mantle.scale.toArray() : null };
  }
  // Allocation-free queries after mixer + update. Updating ancestors here also
  // handles callers that have just changed the creature's world heading/scale.
  function getSiphonWorldPosition(out) {
    if (disposed || !siphonBound) return null;
    head.updateWorldMatrix(true, false);
    return out.copy(siphonPosition).applyMatrix4(head.matrixWorld);
  }
  function getSiphonWorldDirection(out) {
    if (disposed || !siphonBound) return null;
    head.updateWorldMatrix(true, false);
    return out.copy(siphonDirection).transformDirection(head.matrixWorld);
  }
  function dispose() {
    if (disposed) return;
    restore(duration > 0 ? ((state.clipTime % duration) + duration) % duration : 0);
    disposed = true;
    // Model ownership (textures, geometry, skeletons and mixer) stays with life.
    entries.length = 0; arms.length = 0; bones.clear(); tracks.clear();
  }
  return { update, dispose, snapshot, getSiphonWorldPosition, getSiphonWorldDirection };
}
