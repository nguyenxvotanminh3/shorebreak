// Bounded kinematic steering + propulsion/drag cues for game animals.
// This is not a computational-fluid simulation or a biological simulator.
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const CREATURE_STEP = 1 / 90;

export function createCreatureLocomotion(def, center, terrain, colliders = []) {
  const seed = def.id === 'shark' ? .37 : def.id === 'kraken' ? 2.17 : 4.31;
  const s = { x: 0, y: 0, z: 0, heading: -Math.PI / 2, pitch: 0, speed: 0, verticalSpeed: 0,
    turnRate: 0, acceleration: 0, phase: seed, time: 0, alert: 0, cruiseWeight: 1,
    accelerateWeight: 0, turnWeight: 0, reactWeight: 0, mode: 'cruise', clipTime: 0, headTurn: 0 };
  const isShark = def.id === 'shark', stationary = def.id === 'warden';
  const cruise = stationary ? 0 : isShark ? 2.1 : .72;
  const maxTurn = isShark ? .48 : .24;
  let inkMoving=false, inkVx=0, inkVz=0;
  const floorClearance = isShark ? 5 : 10;
  function reset() {
    inkMoving=false;inkVx=inkVz=0;
    Object.assign(s, { x: center.x, z: center.z + (stationary ? 0 : def.orbit[2]),
      y: stationary ? terrain(center.x, center.z) - .2 : Math.max(center.y, terrain(center.x, center.z + def.orbit[2]) + floorClearance),
      heading: -Math.PI / 2, pitch: 0, speed: cruise, verticalSpeed: 0, turnRate: 0,
      acceleration: 0, phase: seed, time: 0, alert: 0, cruiseWeight: 1,
      accelerateWeight: 0, turnWeight: 0, reactWeight: 0, mode: stationary ? 'sentinel' : 'cruise', clipTime: 0, headTurn: 0 });
  }
  reset();
  function step(dt, time, player) {
    if (!(dt > 0)) return;
    s.time = time;
    const py = s.y + (stationary ? 12 : 0), px = s.x - player.x, pz = s.z - player.z;
    const distance = Math.hypot(px, py - player.y, pz);
    const notice = stationary ? 38 : isShark ? 19 : 24;
    const alertTarget = clamp(1 - (distance - def.radius - 2) / notice, 0, 1);
    s.alert = damp(s.alert, alertTarget, 2.8, dt);
    if (stationary) {
      // The exported Warden has no knees/ankles. Keep its feet planted rather
      // than skating a standing/threat rig along a circle and calling it a gait.
      const aim = Math.atan2(-player.x + s.x, -player.z + s.z);
      const target = -Math.PI / 2 + clamp(wrap(aim + Math.PI / 2), -.28, .28) * s.alert;
      const before = s.heading;
      s.heading += clamp(wrap(target - s.heading), -.035 * dt, .035 * dt);
      s.turnRate = (s.heading - before) / dt;
      s.headTurn = clamp(wrap(aim - s.heading), -.5, .5) * s.alert;
      s.phase += dt * (.66 + s.alert * .2);
      s.speed = s.acceleration = s.verticalSpeed = 0;
      s.cruiseWeight = 1 - s.alert; s.reactWeight = s.alert; s.turnWeight = s.accelerateWeight = 0;
      s.mode = s.alert > .35 ? 'watch / threat' : 'sentinel';
      return;
    }
    const ink=!isShark?s.inkDefense:null,escape=clamp(ink?.escapeStrength||0,0,1),prepare=clamp(ink?.anticipation||0,0,1);
    const defensive=escape>0||prepare>0;
    const angle = Math.atan2((s.x - center.x) / def.orbit[0], (s.z - center.z) / def.orbit[2]);
    let targetX = center.x + Math.sin(angle + .62) * def.orbit[0];
    let targetZ = center.z + Math.cos(angle + .62) * def.orbit[2];
    if (distance < notice + def.radius + 2 && Math.hypot(px, pz) > .001) {
      const planar = Math.hypot(px, pz), awayX = px / planar, awayZ = pz / planar;
      const response = isShark ? 7 : 14;
      targetX += awayX * response * s.alert - awayZ * (isShark ? 5 : 2) * s.alert;
      targetZ += awayZ * response * s.alert + awayX * (isShark ? 5 : 2) * s.alert;
    }
    if(defensive&&ink.escapeDirection){
      targetX=s.x+ink.escapeDirection.x*35;targetZ=s.z+ink.escapeDirection.z*35;
    }
    // Broad forward body clearance. Limb contacts remain approximate; no
    // expensive mesh rays or hidden geometry allocations are used here.
    const forwardX = -Math.sin(s.heading), forwardZ = -Math.cos(s.heading);
    for (const solid of colliders) {
      if (py < solid.y - solid.height / 2 - def.radius || py > solid.y + solid.height / 2 + def.radius) continue;
      const dx = s.x + forwardX * (2 + s.speed) - solid.x, dz = s.z + forwardZ * (2 + s.speed) - solid.z;
      const length = Math.hypot(dx, dz), safe = solid.radius + def.radius + 1.5;
      if (length >= safe || length < .001) continue;
      const push = (safe - length) * 3.8;
      targetX += dx / length * push; targetZ += dz / length * push;
    }
    const desired = Math.atan2(-(targetX - s.x), -(targetZ - s.z));
    const turnLimit=defensive?.95:maxTurn;
    const turnTarget = clamp(wrap(desired - s.heading) * 1.8, -turnLimit, turnLimit);
    s.turnRate = damp(s.turnRate, turnTarget, 4.5, dt);
    s.heading += s.turnRate * dt;
    const patrolBurst = Math.pow(Math.max(0, Math.sin(time * .21 + seed * 3.1)), 6);
    const jet = Math.pow(Math.max(0, Math.sin(s.phase)), 4);
    let speedTarget = isShark ? cruise * (1 + patrolBurst * .42 + s.alert * .34) : cruise * (.56 + jet * 1.05 + patrolBurst * .25 + s.alert * .48);
    if(defensive)speedTarget=speedTarget*(1-.6*prepare)*(1-escape)+3.2*escape;
    const previousSpeed = s.speed;
    const requestedSpeed = damp(s.speed, speedTarget, isShark ? 1.6 : 3.2, dt);
    s.speed += clamp(requestedSpeed - s.speed, -(isShark ? 1.4 : .9) * dt, (isShark ? 1.1 : defensive?3.2:1.3) * dt);
    s.acceleration = (s.speed - previousSpeed) / dt;
    if(defensive){
      // A flexible-siphon jet can retreat without instant whole-body yaw. Ease
      // world-space travel into the obstacle-steered escape bearing, retaining
      // the ordinary body turn limit and a smooth return to patrol.
      if(!inkMoving){inkVx=-Math.sin(s.heading)*previousSpeed;inkVz=-Math.cos(s.heading)*previousSpeed;inkMoving=true;}
      const travelHeading=s.heading+wrap(desired-s.heading)*escape;
      inkVx=damp(inkVx,-Math.sin(travelHeading)*s.speed,4,dt);inkVz=damp(inkVz,-Math.cos(travelHeading)*s.speed,4,dt);
      s.x=clamp(s.x+inkVx*dt,-204,204);s.z=clamp(s.z+inkVz*dt,-217,70);
    }else{
      inkMoving=false;
      s.x = clamp(s.x - Math.sin(s.heading) * s.speed * dt, -204, 204);
      s.z = clamp(s.z - Math.cos(s.heading) * s.speed * dt, -217, 70);
    }
    const desiredY = Math.min(-7, Math.max(terrain(s.x, s.z) + floorClearance, center.y + Math.sin(time * .16 + seed) * (isShark ? 1.6 : 1.1)));
    s.verticalSpeed = damp(s.verticalSpeed, clamp((desiredY - s.y) * .7, -.7, .7), 2.5, dt);
    s.y += s.verticalSpeed * dt;
    s.y = Math.max(s.y, terrain(s.x, s.z) + floorClearance);
    s.pitch = damp(s.pitch, -Math.atan2(s.verticalSpeed, Math.max(.2, s.speed)), 3, dt);
    s.phase += TAU * dt * (isShark ? .36 + s.speed * .22 : .27 + s.speed * .15);
    const react = s.alert * .85, turning = clamp(Math.abs(s.turnRate) / maxTurn, 0, 1) * (1 - react);
    const accelerating = clamp(Math.max(0, s.acceleration) / (isShark ? .9 : .6), 0, 1) * (1 - react) * (1 - turning * .65);
    const remainder = Math.max(0, 1 - react - turning * .65 - accelerating);
    s.reactWeight = damp(s.reactWeight, react, 4, dt);
    s.turnWeight = damp(s.turnWeight, turning * .65, 4, dt);
    s.accelerateWeight = damp(s.accelerateWeight, accelerating, 4, dt);
    s.cruiseWeight = damp(s.cruiseWeight, remainder, 4, dt);
    const total = s.reactWeight + s.turnWeight + s.accelerateWeight + s.cruiseWeight;
    s.reactWeight /= total; s.turnWeight /= total; s.accelerateWeight /= total; s.cruiseWeight /= total;
    s.mode = defensive?'ink / '+ink.stage:s.reactWeight > .35 ? (isShark ? 'investigate / veer' : 'jet / evade') : s.accelerateWeight > .3 ? 'accelerate' : s.turnWeight > .35 ? 'turn' : 'cruise';
  }
  return { state: s, reset, step };
}
