// Fictional pressure-protected-suit gameplay, not a real diving procedure.
// Pure controller: it never reads or moves a player, mesh, audio node or clock.
export const WET_LOCK = Object.freeze({
  chamber: Object.freeze({ minX: -3, maxX: 3, minY: 18, maxY: 23, minZ: 35, maxZ: 42 }),
  outer: Object.freeze({ z: 42, width: 3.2, height: 3.5, floor: 18 }),
  inner: Object.freeze({ z: 35, width: 3.2, height: 3.5, floor: 18 }),
  drained: 18.05,
  flooded: 22.8,
  maxDelta: .25,
});

const EPS = 1e-10;
const PHASES = new Set(['sea-open', 'habitat-open', 'closing', 'filling', 'draining', 'equalizing', 'opening']);
const isSide = value => value === 'sea' || value === 'habitat';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = (value, fallback, min, max) => finite(value) && value >= min && value <= max ? value : fallback;
const endpoint = side => side === 'sea' ? WET_LOCK.flooded : WET_LOCK.drained;
const doorFor = side => side === 'sea' ? 'outerOpen' : 'innerOpen';
const oppositeDoor = side => side === 'sea' ? 'innerOpen' : 'outerOpen';

// Missing sensors mean clear. A supplied malformed sensor is conservatively
// blocked; an unreadable occupancy object blocks both thresholds. inChamber is
// intentionally not a prerequisite: an empty lock must answer either call panel.
function sensors(occupancy) {
  try {
    const input = occupancy && typeof occupancy === 'object' ? occupancy : {};
    const blocked = value => value !== undefined && value !== false;
    return { outer: blocked(input.outerBlocked), inner: blocked(input.innerBlocked) };
  } catch {
    return { outer: true, inner: true };
  }
}

/**
 * createWetLock({ initialSide = 'sea', doorSeconds = 1.2,
 *                 waterSeconds = 5, equalizeSeconds = .4 })
 *
 * state/snapshot(): immutable copies; door fractions are 0 (sealed) to 1 (open).
 * request(side, occupancy): true for an accepted/idempotent request, false for
 *   an invalid side or a conflicting busy request. Never queues button spam.
 * step(dt, occupancy): seconds; invalid/nonpositive dt freezes every field.
 *   A frame is capped at .25s, deliberately dropping suspension catch-up time.
 *   Within that bound, exact event-time integration is frame-rate independent.
 * recover()/cancel(): return toward the last fully open side, preserving actual
 *   door positions and water level; a partial transfer reverses only while sealed.
 * reset(): new-session operation only; restores the configured initial side.
 * serialize()/restore(data): JSON-safe object / atomic validated restoration;
 *   invalid saves leave the current controller untouched. Restore before spawning
 *   the player; then supply fresh threshold sensors on every simulation step.
 *
 * Block sensors must include the player's collision radius and door sweep. A
 * closing door reopens while blocked; a sealed transfer holds while either
 * threshold is occupied. Keep calling step after a clear sensor to resume.
 */
export function createWetLock(config = {}) {
  let input;
  try { input = config && typeof config === 'object' ? config : {}; } catch { input = {}; }
  let options;
  try {
    options = {
      initialSide: isSide(input.initialSide) ? input.initialSide : 'sea',
      doorSeconds: positive(input.doorSeconds, 1.2, .1, 30),
      waterSeconds: positive(input.waterSeconds, 5, .5, 120),
      equalizeSeconds: positive(input.equalizeSeconds, .4, 0, 30),
    };
  } catch { options = { initialSide: 'sea', doorSeconds: 1.2, waterSeconds: 5, equalizeSeconds: .4 }; }
  const timing = Object.freeze(options);
  const waterRate = (WET_LOCK.flooded - WET_LOCK.drained) / timing.waterSeconds;
  let current;

  function reset() {
    const side = timing.initialSide;
    current = { phase: `${side}-open`, target: side, lastSafeSide: side,
      outerOpen: side === 'sea' ? 1 : 0, innerOpen: side === 'habitat' ? 1 : 0,
      waterLevel: endpoint(side), equalizeRemaining: 0, blocked: null };
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({ ...current,
      water01: (current.waterLevel - WET_LOCK.drained) / (WET_LOCK.flooded - WET_LOCK.drained),
      busy: current.phase !== 'sea-open' && current.phase !== 'habitat-open',
      activeSide: current.outerOpen > 0 ? 'sea' : current.innerOpen > 0 ? 'habitat' : null,
    });
  }

  // Called only after both doors are fully sealed.
  function transferPhase() {
    if (current.waterLevel !== endpoint(current.target)) {
      current.phase = current.target === 'sea' ? 'filling' : 'draining';
      current.equalizeRemaining = 0;
    } else {
      current.phase = 'equalizing';
      current.equalizeRemaining = timing.equalizeSeconds;
    }
  }

  function request(side, occupancy) {
    if (!isSide(side)) return false;
    if (current.target === side) return true;
    if (current.phase !== 'sea-open' && current.phase !== 'habitat-open') return false;
    current.target = side;
    current.phase = 'closing';
    current.equalizeRemaining = 0;
    const occupied = sensors(occupancy);
    current.blocked = occupied.outer ? 'outer' : occupied.inner ? 'inner' : null;
    return true;
  }

  function recover(occupancy) {
    // Idempotent recovery preserves transfer/equalization progress on key repeat.
    if (current.target === current.lastSafeSide) return true;
    current.target = current.lastSafeSide;
    current.equalizeRemaining = 0;
    const occupied = sensors(occupancy);
    current.blocked = occupied.outer ? 'outer' : occupied.inner ? 'inner' : null;
    if (current[doorFor(current.target)] > 0) current.phase = 'opening';
    else if (current.outerOpen > 0 || current.innerOpen > 0) current.phase = 'closing';
    else transferPhase();
    return true;
  }

  function step(dt, occupancy) {
    if (!finite(dt) || dt <= 0) return snapshot();
    let remaining = Math.min(dt, WET_LOCK.maxDelta);
    const occupied = sensors(occupancy);
    current.blocked = null;
    // A request can traverse at most five phases in one step. This limit also
    // guards against accidental zero-duration transition loops after maintenance.
    for (let transitions = 0; transitions < 8 && remaining > EPS; transitions++) {
      if (current.phase === 'sea-open' || current.phase === 'habitat-open') break;

      if (current.phase === 'closing') {
        const openDoor = current.outerOpen > 0 ? 'outer' : current.innerOpen > 0 ? 'inner' : null;
        // Reopen the moving leaf instead of ever decreasing it into an occupant.
        if (openDoor && occupied[openDoor]) {
          current.blocked = openDoor;
          const key = `${openDoor}Open`;
          current[key] = Math.min(1, current[key] + remaining / timing.doorSeconds);
          break;
        }
        if (occupied.outer || occupied.inner) {
          current.blocked = occupied.outer ? 'outer' : 'inner';
          break;
        }
        if (openDoor) {
          const key = `${openDoor}Open`, needed = current[key] * timing.doorSeconds;
          if (remaining + EPS < needed) {
            current[key] = Math.max(0, current[key] - remaining / timing.doorSeconds);
            break;
          }
          current[key] = 0;
          remaining = Math.max(0, remaining - needed);
        }
        transferPhase();
        continue;
      }

      if (current.phase === 'filling' || current.phase === 'draining' || current.phase === 'equalizing') {
        // A threshold becoming occupied while nominally sealed is contradictory
        // geometry/sensor input: freeze safely instead of opening into wrong water.
        if (occupied.outer || occupied.inner) {
          current.blocked = occupied.outer ? 'outer' : 'inner';
          break;
        }
        if (current.phase === 'equalizing') {
          if (remaining + EPS < current.equalizeRemaining) {
            current.equalizeRemaining -= remaining;
            break;
          }
          remaining = Math.max(0, remaining - current.equalizeRemaining);
          current.equalizeRemaining = 0;
          current.phase = 'opening';
          continue;
        }
        const destination = endpoint(current.target);
        const needed = Math.abs(destination - current.waterLevel) / waterRate;
        if (remaining + EPS < needed) {
          const direction = current.target === 'sea' ? 1 : -1;
          current.waterLevel = Math.max(WET_LOCK.drained, Math.min(WET_LOCK.flooded, current.waterLevel + direction * remaining * waterRate));
          break;
        }
        current.waterLevel = destination;
        remaining = Math.max(0, remaining - needed);
        current.phase = 'equalizing';
        current.equalizeRemaining = timing.equalizeSeconds;
        continue;
      }

      if (current.phase === 'opening') {
        const key = doorFor(current.target), needed = (1 - current[key]) * timing.doorSeconds;
        if (remaining + EPS < needed) {
          current[key] = Math.min(1, current[key] + remaining / timing.doorSeconds);
          break;
        }
        current[key] = 1;
        current.lastSafeSide = current.target;
        current.phase = `${current.target}-open`;
        break;
      }
    }
    return snapshot();
  }

  function serialize() {
    const { blocked, ...data } = current;
    return { version: 1, ...data };
  }

  function restore(data) {
    try {
      if (typeof data === 'string') {
        if (data.length > 8192) return false;
        data = JSON.parse(data);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) return false;
      const next = {
        phase: data.phase, target: data.target, lastSafeSide: data.lastSafeSide,
        outerOpen: data.outerOpen, innerOpen: data.innerOpen,
        waterLevel: data.waterLevel, equalizeRemaining: data.equalizeRemaining,
        blocked: null,
      };
      if (!PHASES.has(next.phase) || !isSide(next.target) || !isSide(next.lastSafeSide)) return false;
      if (![next.outerOpen, next.innerOpen, next.waterLevel, next.equalizeRemaining].every(finite)) return false;
      if (next.outerOpen < 0 || next.outerOpen > 1 || next.innerOpen < 0 || next.innerOpen > 1) return false;
      if (next.waterLevel < WET_LOCK.drained || next.waterLevel > WET_LOCK.flooded) return false;
      if (next.equalizeRemaining < 0 || next.equalizeRemaining > timing.equalizeSeconds) return false;
      if (next.outerOpen > 0 && (next.innerOpen > 0 || next.waterLevel !== WET_LOCK.flooded)) return false;
      if (next.innerOpen > 0 && next.waterLevel !== WET_LOCK.drained) return false;
      if (next.phase !== 'equalizing' && next.equalizeRemaining !== 0) return false;
      if (next.phase === 'filling' || next.phase === 'draining' || next.phase === 'equalizing') {
        if (next.outerOpen !== 0 || next.innerOpen !== 0) return false;
        if (next.phase === 'filling' && next.target !== 'sea') return false;
        if (next.phase === 'draining' && next.target !== 'habitat') return false;
      }
      if (next.phase === 'opening' || next.phase === 'equalizing' || next.phase.endsWith('-open')) {
        if (next.waterLevel !== endpoint(next.target) || next[oppositeDoor(next.target)] !== 0) return false;
      }
      if (next.phase.endsWith('-open')) {
        if (next.phase !== `${next.target}-open` || next[doorFor(next.target)] !== 1 || next.lastSafeSide !== next.target) return false;
      }
      current = next;
      return true;
    } catch { return false; }
  }

  reset();
  return Object.freeze({ get state() { return snapshot(); }, config: timing,
    request, step, reset, snapshot, serialize, restore, recover, cancel: recover });
}
