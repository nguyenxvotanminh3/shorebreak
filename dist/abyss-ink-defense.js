// Deterministic, bounded game behavior, not a biological or fluid simulation.
// Positions and directions are world-space metres. The caller owns locomotion,
// rig deformation, the ventral siphon transform, particles and terrain clearance.
const EMPTY = Object.freeze({});
const EPSILON = 1e-10;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export const INK_DEFENSE_DEFAULTS = Object.freeze({
  enterRange: 18, rearmRange: 28, dwellDuration: .25,
  anticipationDuration: .45, emissionDuration: .5,
  escapeDuration: 3, recoveryDuration: 2, cooldownDuration: 18,
});

/** One state machine per animal, shared by both visual LODs.
 *
 * step(dt, creature, observer) accepts x/y/z on both positions, plus the
 * explicit booleans observer.playing and observer.submerged. Only Kraken
 * instances participate (factory id defaults to 'kraken'). A sustained close
 * approach OR already-close observer can commit a response after the dwell.
 * A committed sequence is not cancelled when the observer moves away.
 *
 * Directions freeze at commitment: escape points observer -> creature; ink
 * points back toward the threat. An independently aimed ventral siphon should
 * follow inkDirection rather than assuming ink leaves the rear of the model.
 * The exact-overlap fallback uses the creature's local -Z forward transformed
 * by its heading/pitch, matching the game's YXZ world-container convention.
 *
 * eventId increments ONCE on entry to emission; emitted is a positive-step
 * pulse. Consumers must inspect eventId inside EACH fixed simulation step,
 * since dt=0 deliberately preserves every field, including that pulse. There
 * is no callback, random source, wall clock, renderer or per-step allocation.
 *
 * Non-playing/invalid observations break the proximity dwell and
 * clear emitted, but freeze committed phases and cooldown. Surfacing blocks a
 * new dwell; committed escapes and cooldown continue while playing. Thus menus never
 * begin or advance emissions. dt<=0/nonfinite dt is an exact no-op. For
 * frame-rate invariance, use the existing 90 Hz creature step. Arbitrary
 * positive dt also consumes phase boundaries exactly for constant inputs;
 * movement sampled at different rates can naturally change proximity entry.
 */
export function createInkDefense(options = EMPTY) {
  const defaults = INK_DEFENSE_DEFAULTS;
  const config = {
    enterRange: clamp(finite(options.enterRange, defaults.enterRange), 1, 50),
    rearmRange: 0,
    dwellDuration: clamp(finite(options.dwellDuration, defaults.dwellDuration), .05, 3),
    anticipationDuration: clamp(finite(options.anticipationDuration, defaults.anticipationDuration), .1, 3),
    emissionDuration: clamp(finite(options.emissionDuration, defaults.emissionDuration), .05, 2),
    escapeDuration: clamp(finite(options.escapeDuration, defaults.escapeDuration), .2, 10),
    recoveryDuration: clamp(finite(options.recoveryDuration, defaults.recoveryDuration), .1, 8),
    cooldownDuration: clamp(finite(options.cooldownDuration, defaults.cooldownDuration), 1, 120),
  };
  config.rearmRange = clamp(finite(options.rearmRange, defaults.rearmRange), config.enterRange + 1, 100);
  config.cooldownDuration = Math.max(config.cooldownDuration,
    config.emissionDuration + config.escapeDuration + config.recoveryDuration);
  Object.freeze(config);
  const isKraken = (options.id ?? 'kraken') === 'kraken';
  const escapeDirection = { x: 0, y: 0, z: -1 };
  const inkDirection = { x: 0, y: 0, z: 1 };
  const state = {
    stage: 'idle', stageTime: 0, time: 0, dwell: 0, cooldown: 0,
    armed: isKraken, separated: false, distance: 0,
    eventId: 0, eventTime: 0, emitted: false, emitting: false,
    anticipation: 0, contraction: 0, armGather: 0, extension: 0,
    escapeStrength: 0, emissionStrength: 0,
    escapeDirection, inkDirection, disposed: false,
  };

  function zeroPose() {
    state.anticipation = state.contraction = state.armGather = state.extension = 0;
    state.escapeStrength = state.emissionStrength = 0;
    state.emitting = false;
  }

  function reset() {
    if (state.disposed) return state;
    state.stage = 'idle';
    state.stageTime = state.time = state.dwell = state.cooldown = state.distance = 0;
    state.eventId = state.eventTime = 0;
    state.armed = isKraken; state.separated = state.emitted = false;
    escapeDirection.x = escapeDirection.y = inkDirection.x = inkDirection.y = 0;
    escapeDirection.z = -1; inkDirection.z = 1;
    zeroPose();
    return state;
  }

  function freezeDirections(creature, dx, dy, dz, distance) {
    if (distance > 1e-6) {
      escapeDirection.x = dx / distance;
      escapeDirection.y = dy / distance;
      escapeDirection.z = dz / distance;
    } else {
      const heading = finite(creature.heading, 0), pitch = finite(creature.pitch, 0);
      const cp = Math.cos(pitch);
      escapeDirection.x = -Math.sin(heading) * cp;
      escapeDirection.y = Math.sin(pitch);
      escapeDirection.z = -Math.cos(heading) * cp;
    }
    inkDirection.x = -escapeDirection.x;
    inkDirection.y = -escapeDirection.y;
    inkDirection.z = -escapeDirection.z;
  }

  function advance(dt) {
    state.time += dt;
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.cooldown < EPSILON) state.cooldown = 0;
  }

  function samplePose() {
    zeroPose();
    if (state.stage === 'anticipation') {
      const p = smooth(state.stageTime / config.anticipationDuration);
      state.anticipation = p;
      state.contraction = .1 * p;
      state.armGather = .7 * p;
    } else if (state.stage === 'emission') {
      const p = clamp(state.stageTime / config.emissionDuration, 0, 1);
      state.emitting = true;
      state.anticipation = 1 - smooth(p);
      state.contraction = .1 + .9 * smooth(p / .22) * (1 - .2 * smooth((p - .4) / .6));
      state.armGather = .7 * (1 - smooth(p));
      state.extension = smooth(p / .35);
      state.escapeStrength = smooth(p / .18);
      state.emissionStrength = Math.pow(Math.max(0, Math.sin(Math.PI * p)), .7);
    } else if (state.stage === 'escape') {
      const p = smooth(state.stageTime / config.escapeDuration);
      state.contraction = .82 - .74 * p;
      state.extension = 1 - .85 * p;
      state.escapeStrength = 1 - .85 * p;
    } else if (state.stage === 'recovery') {
      const remaining = 1 - smooth(state.stageTime / config.recoveryDuration);
      state.contraction = .08 * remaining;
      state.extension = state.escapeStrength = .15 * remaining;
    }
  }

  function step(dt, creature = EMPTY, observer = EMPTY) {
    if (state.disposed || !Number.isFinite(dt) || !(dt > 0)) return state;
    state.emitted = false;
    if (!isKraken || (creature.id != null && creature.id !== 'kraken') ||
        observer.playing !== true ||
        !Number.isFinite(creature.x) || !Number.isFinite(creature.y) || !Number.isFinite(creature.z) ||
        !Number.isFinite(observer.x) || !Number.isFinite(observer.y) || !Number.isFinite(observer.z)) {
      state.dwell = 0;
      return state;
    }
    const dx = creature.x - observer.x, dy = creature.y - observer.y, dz = creature.z - observer.z;
    const distance = Math.hypot(dx, dy, dz);
    // Finite input coordinates can still overflow during subtraction.
    if (!Number.isFinite(distance)) { state.dwell = 0; return state; }
    state.distance = distance;
    if (!state.armed && distance >= config.rearmRange) state.separated = true;
    let remaining = dt;
    while (remaining > 0) {
      if (state.stage === 'idle') {
        if (!state.armed && state.separated && state.cooldown === 0) state.armed = true;
        if (!state.armed || distance > config.enterRange || observer.submerged !== true) {
          state.dwell = 0;
          // If this interval crosses cooldown expiry, consume that boundary
          // before collecting any new proximity dwell.
          const wait = !state.armed && state.separated && state.cooldown > 0
            ? Math.min(remaining, state.cooldown) : remaining;
          advance(wait); remaining = Math.max(0, remaining - wait);
          if (!state.armed && state.separated && state.cooldown === 0) state.armed = true;
          continue;
        }
        const used = Math.min(remaining, Math.max(0, config.dwellDuration - state.dwell));
        state.dwell += used; advance(used); remaining = Math.max(0, remaining - used);
        if (state.dwell + EPSILON >= config.dwellDuration) {
          freezeDirections(creature, dx, dy, dz, distance);
          state.stage = 'anticipation'; state.stageTime = 0;
          state.armed = state.separated = false; state.dwell = 0;
        }
        continue;
      }
      const duration = state.stage === 'anticipation' ? config.anticipationDuration
        : state.stage === 'emission' ? config.emissionDuration
        : state.stage === 'escape' ? config.escapeDuration : config.recoveryDuration;
      const used = Math.min(remaining, Math.max(0, duration - state.stageTime));
      state.stageTime += used; advance(used); remaining = Math.max(0, remaining - used);
      if (state.stageTime + EPSILON >= duration) {
        state.stageTime = 0;
        if (state.stage === 'anticipation') {
          state.stage = 'emission'; state.eventId++; state.eventTime = state.time;
          state.emitted = true; state.cooldown = config.cooldownDuration;
        } else if (state.stage === 'emission') state.stage = 'escape';
        else if (state.stage === 'escape') state.stage = 'recovery';
        else state.stage = 'idle';
      }
    }
    samplePose();
    return state;
  }

  function snapshot() {
    return { ...state, escapeDirection: { ...escapeDirection }, inkDirection: { ...inkDirection } };
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true; state.stage = 'idle'; state.stageTime = state.dwell = state.cooldown = 0;
    state.armed = state.separated = state.emitted = false;
    zeroPose();
  }

  return { state, config, step, reset, dispose, snapshot };
}
