// Bounded gameplay sonar. Positions/ranges are real world metres; the DISPLAY
// is time-expanded so a player can read returns. It is not a slow sound wave.
// Active sonar measures the outgoing + returning path (range = c * time / 2):
// https://oceanexplorer.noaa.gov/technology/sonar/
// Nominal seawater sound speed is ~1500 m/s, varying with water conditions:
// https://oceanservice.noaa.gov/facts/sound.html
// This simplified sensor omits acoustic shadows, refraction and Doppler. It
// snapshots each supplied target at emission, never predicts or tracks it.
export const SONAR = Object.freeze({
  range: 140,
  cooldown: 9,
  echoLifetime: 5,
  displaySpeed: 100,
  soundSpeed: 1500,
  maxContacts: 16,
  maxCandidates: 256,
});

const RAD_TO_DEG = 180 / Math.PI;
const DURATION = 2 * SONAR.range / SONAR.displaySpeed;
const KINDS = new Set(['landmark', 'objective', 'home', 'air', 'rig', 'creature']);
const finite = Number.isFinite;
const validTime = value => finite(value) && value >= 0 && value <= 1e12;
const point = value => value && finite(value.x) && finite(value.y) && finite(value.z);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = value => ((value % 360) + 360) % 360;
const bearing = (dx, dz) => dx === 0 && dz === 0 ? null : wrap(Math.atan2(dx, -dz) * RAD_TO_DEG);
const active = value => !value?.status || value.status === 'playing';

function dry(value) {
  return value?.inAir === true || value?.underwater === false || value?.movementMode === 'walk'
    || value?.y >= 0 || (value?.indoors === true && typeof value.waterLevel === 'number'
      && !Number.isNaN(value.waterLevel) && value.y >= value.waterLevel);
}

function emptyEcho() {
  return { id: '', kind: 'landmark', name: '', x: 0, y: 0, z: 0,
    known: false, mobile: false, source: 'sonar', range: 0, depth: 0, bearing: null,
    currentRange: 0, currentBearing: null, relativeBearing: null,
    emittedAt: 0, arrivalAt: 0, physicalArrivalAt: 0, expiresAt: 0,
    age: 0, strength: 0, received: false };
}

/**
 * Pure, allocation-free update path; does not mutate targets or collect samples.
 *
 * emit(origin, simulationTime, contacts) -> accepted boolean. Origin has x/y/z;
 * optional status/inAir/underwater/movementMode/indoors/waterLevel guard dry use.
 * Contacts are plain {id,kind,name,x,y,z,known?,mobile?}, read ONLY at emission.
 * The nearest 16 valid, unique contacts among the first 256 inputs are retained.
 * Deterministic ordering is range, then ID. All graphical quality levels share
 * these mechanics; known:true describes an existing navigational marker and
 * never overrides sonar range, timing or expiry. A creature echo is a last-seen
 * position, NOT a live tracker. Only fresh emission can update its coordinates.
 *
 * update(simulationTime, observer?) -> stable echoes array. Use paused GAME time,
 * not performance.now(); observer.status==='paused' also freezes the controller.
 * A backward clock clears the previous expedition and cooldown. Dry receivers
 * cancel the current reception/echoes while retaining the consumed cooldown.
 *
 * echoes/newEchoes/pulse are stable read-only views, owned by this controller.
 * newEchoes contains arrivals from the latest successful update only; a second
 * update at the same time clears it so audio cannot replay. Do not retain echo
 * objects across emissions; preallocated slots are reused. snapshot() copies
 * data for inspection. getEcho(id) returns an arrived, unexpired echo or null.
 *
 * Echo range/depth/bearing are measured from the EMISSION origin. Observer
 * currentRange/currentBearing/relativeBearing navigate to that saved position.
 * Bearings are degrees clockwise from north (-Z); game yaw is radians counter-
 * clockwise. Relative bearing is [-180,180), positive to the observer's right.
 * A directly vertical/coincident contact has null bearing, not invented north.
 * pulse.returnRadius is the range whose ROUND-TRIP return has arrived. Its
 * outgoingRadius is the time-expanded outward travel, never a reveal radius.
 */
export function createSonarController() {
  const slots = Array.from({ length: SONAR.maxContacts }, emptyEcho);
  const echoes = [], newEchoes = [];
  const pulse = { active: false, phase: 'idle', origin: { x: 0, y: 0, z: 0 },
    emittedAt: null, age: 0, outgoingRadius: 0, returnRadius: 0, progress: 0,
    range: SONAR.range, duration: DURATION, timeExpanded: true };
  const observerPoint = { x: 0, y: 0, z: 0, yaw: 0 };
  let count = 0, lastTime = 0, emittedAt = null, disposed = false;
  let hasObserver = false, blockedReason = null, receivedCount = 0;

  function clearDetections() {
    count = 0;
    receivedCount = 0;
    echoes.length = 0;
    newEchoes.length = 0;
    pulse.active = false;
    pulse.phase = 'idle';
    pulse.emittedAt = null;
    pulse.age = 0;
    pulse.outgoingRadius = 0;
    pulse.returnRadius = 0;
    pulse.progress = 0;
  }

  function reset(time = 0) {
    clearDetections();
    lastTime = validTime(time) ? time : 0;
    emittedAt = null;
    hasObserver = false;
    blockedReason = disposed ? 'disposed' : null;
    pulse.origin.x = pulse.origin.y = pulse.origin.z = 0;
  }

  function update(time, observer) {
    if (disposed || !validTime(time) || !active(observer)) return echoes;
    if (time < lastTime) reset(time);
    lastTime = time;
    newEchoes.length = 0;
    if (point(observer)) {
      observerPoint.x = observer.x;
      observerPoint.y = observer.y;
      observerPoint.z = observer.z;
      observerPoint.yaw = finite(observer.yaw) ? observer.yaw : 0;
      hasObserver = true;
      if (dry(observer)) {
        clearDetections();
        blockedReason = 'dry';
        return echoes;
      }
    }
    blockedReason = null;
    if (pulse.emittedAt !== null) {
      pulse.age = Math.max(0, time - pulse.emittedAt);
      pulse.progress = clamp(pulse.age / DURATION, 0, 1);
      pulse.active = pulse.age < DURATION;
      pulse.phase = pulse.active ? (pulse.age < DURATION / 2 ? 'outbound' : 'returning') : 'complete';
      pulse.outgoingRadius = Math.min(SONAR.range, pulse.age * SONAR.displaySpeed);
      pulse.returnRadius = Math.min(SONAR.range, pulse.age * SONAR.displaySpeed / 2);
    }
    echoes.length = 0;
    for (let index = 0; index < count; index++) {
      const echo = slots[index];
      if (time < echo.arrivalAt) continue;
      if (!echo.received) {
        echo.received = true;
        receivedCount++;
        // A long suspension must not replay already-expired return sounds.
        if (time < echo.expiresAt) newEchoes.push(echo);
      }
      if (time >= echo.expiresAt) continue;
      echo.age = Math.max(0, time - echo.arrivalAt);
      echo.strength = clamp(1 - echo.age / SONAR.echoLifetime, 0, 1);
      if (hasObserver) {
        const dx = echo.x - observerPoint.x, dy = echo.y - observerPoint.y, dz = echo.z - observerPoint.z;
        echo.currentRange = Math.hypot(dx, dy, dz);
        echo.currentBearing = bearing(dx, dz);
        echo.relativeBearing = echo.currentBearing === null ? null
          : wrap(echo.currentBearing + observerPoint.yaw * RAD_TO_DEG + 180) - 180;
      }
      echoes.push(echo);
    }
    return echoes;
  }

  function emit(origin, time, contacts = []) {
    if (disposed) return false;
    if (!validTime(time) || !point(origin)) { blockedReason = 'invalid'; return false; }
    if (!active(origin)) { blockedReason = 'inactive'; return false; }
    update(time, origin);
    if (dry(origin)) { blockedReason = 'dry'; return false; }
    if (emittedAt !== null && time - emittedAt < SONAR.cooldown) { blockedReason = 'cooldown'; return false; }
    if (!Array.isArray(contacts)) { blockedReason = 'invalid'; return false; }

    // Allocations occur only on a requested ping, bounded even for bad inputs.
    const candidates = [], ids = new Set();
    for (let index = 0; index < Math.min(contacts.length, SONAR.maxCandidates); index++) {
      const contact = contacts[index];
      if (!point(contact) || typeof contact.id !== 'string') continue;
      const id = contact.id.trim();
      if (!id || id.length > 80 || ids.has(id)) continue;
      const dx = contact.x - origin.x, dy = contact.y - origin.y, dz = contact.z - origin.z;
      const range = Math.hypot(dx, dy, dz);
      if (!finite(range) || range > SONAR.range) continue;
      ids.add(id); // First valid in-range contact owns a duplicate ID.
      candidates.push({ id, kind: KINDS.has(contact.kind) ? contact.kind : 'landmark',
        name: typeof contact.name === 'string' ? contact.name.slice(0, 100) : id,
        x: contact.x, y: contact.y, z: contact.z,
        known: contact.known === true, mobile: contact.mobile === true || contact.kind === 'creature',
        range, depth: Math.max(0, -contact.y), bearing: bearing(dx, dz) });
    }
    candidates.sort((a, b) => a.range - b.range || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    clearDetections();
    count = Math.min(candidates.length, SONAR.maxContacts);
    emittedAt = time;
    pulse.emittedAt = time;
    pulse.origin.x = origin.x;
    pulse.origin.y = origin.y;
    pulse.origin.z = origin.z;
    for (let index = 0; index < count; index++) {
      const candidate = candidates[index], echo = slots[index];
      Object.assign(echo, candidate);
      echo.emittedAt = time;
      echo.arrivalAt = time + candidate.range * 2 / SONAR.displaySpeed;
      echo.physicalArrivalAt = time + candidate.range * 2 / SONAR.soundSpeed;
      echo.expiresAt = echo.arrivalAt + SONAR.echoLifetime;
      echo.currentRange = candidate.range;
      echo.currentBearing = candidate.bearing;
      echo.relativeBearing = null;
      echo.age = 0;
      echo.strength = 0;
      echo.received = false;
    }
    update(time, origin);
    return true;
  }

  function getEcho(id) {
    for (let index = 0; index < echoes.length; index++) if (echoes[index].id === id) return echoes[index];
    return null;
  }

  function snapshot() {
    return { time: lastTime, disposed, blockedReason, range: SONAR.range,
      cooldownRemaining: emittedAt === null ? 0 : Math.max(0, SONAR.cooldown - (lastTime - emittedAt)),
      candidateCount: count, receivedCount, pendingCount: count - receivedCount,
      pulse: { ...pulse, origin: { ...pulse.origin } },
      echoes: echoes.map(echo => ({ ...echo })), newEchoes: newEchoes.map(echo => ({ ...echo })) };
  }

  function dispose() { if (disposed) return; disposed = true; reset(lastTime); }

  return { emit, update, getEcho, reset, dispose, snapshot, echoes, newEchoes, pulse,
    get cooldownRemaining() { return emittedAt === null ? 0 : Math.max(0, SONAR.cooldown - (lastTime - emittedAt)); },
    get blockedReason() { return blockedReason; },
    get pendingCount() { return count - receivedCount; },
    get receivedCount() { return receivedCount; } };
}
