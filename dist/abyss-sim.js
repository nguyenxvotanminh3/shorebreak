// Deterministic expedition simulation, independent of browser/renderer.
export const FIXED_STEP = 1 / 90;
export const LIMITS = Object.freeze({ oxygen: 150, swim: 5.8, sprint: 9.2, radius: .65, world: 215, minZ: -222, maxZ: 75 });
// Keep the swim-up easing, but settle a released stick/key quickly and exactly.
// At sprint speed this leaves a short ~0.41m glide and stops within 0.32s.
const ACCELERATION = 4.8, RELEASE_BRAKE = 20, REST_SPEED = .02;
// Input-owned momentum is separate from world-space contact/creature impulses.
// It is runtime-only: saves and copied expedition state never retain ownership.
const activeDrive = new WeakMap();
// Retain gravity while a jump/fall crosses the edge of an optional island query.
// It never enables outdoor physics for a state that only visited the old ocean.
const outdoorMotion = new WeakMap();
const CONTACT_EPSILON = 1e-9;
// Optional enclosed environments retain head-position camera coordinates. Stance
// changes the body's clearance, never teleports the camera to a standing height.
export const INTERIOR_MOTION = Object.freeze({ walk:3.4, sprint:5, eyeHeight:1.65, gravity:12, stanceRate:2, waterHysteresis:.08, stepHeight:.32 });
export const OUTDOOR_MOTION = Object.freeze({ maxSlope:.55, sweepStep:.12, shoreDepth:1.5, shoreHysteresis:.12, supportReach:.08, surfaceCeiling:.5 });
export const LANDMARKS = Object.freeze([
  { id: 'glass', name: 'BÃI KÍNH', x: -25, z: -38, lift: 3, note: 'Mẫu 01 · San hô đang phát lại một nhịp sóng không có nguồn.' },
  { id: 'bell', name: 'TRẠM CHUÔNG', x: 44, z: -102, lift: 4, note: 'Mẫu 02 · Nhật ký cuối cùng: đừng trả lời tiếng gõ từ bên ngoài.' },
  { id: 'rift', name: 'KHE THỞ', x: -18, z: -180, lift: 5, note: 'Mẫu 03 · Vực sâu không trống. Nó đang lắng nghe.' }
]);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function makeLocations(terrain) { return LANDMARKS.map(p=>({...p,y:terrain(p.x,p.z)+p.lift})); }
export function createDive() {
 return { status:'menu', x:0,y:-3.2,z:18, vx:0,vy:0,vz:0, yaw:0,pitch:-.22, oxygen:LIMITS.oxygen, health:100, time:0, deepest:0,
   scans:[],banked:[],scanProgress:0,scanTarget:null,nearTarget:null, rescues:0, flashlight:true, sonar:0, sonarCooldown:0, threat:0, injuryCooldown:0, message:null, completed:false, sprinting:false, inAir:false, distanceSwum:0, movementMode:'swim', grounded:false, eyeHeight:LIMITS.radius, wading:false };
}
export function startDive(s) { activeDrive.delete(s);outdoorMotion.delete(s);Object.assign(s,createDive(),{status:'playing'}); }
export function clearMotion(s) { activeDrive.delete(s);s.vx=s.vy=s.vz=0; s.sprinting=false; s.scanProgress=0; s.scanTarget=null; }
export function triggerSonar(s) { if(s.status!=='playing'||s.sonarCooldown>0)return false; s.sonar=6;s.sonarCooldown=9;return true; }
export function recoverDiver(s) { outdoorMotion.delete(s);s.x=0;s.y=-1;s.z=18;s.yaw=0;s.pitch=-.22;s.oxygen=LIMITS.oxygen;s.health=100;s.scans=[...s.banked];s.rescues++;s.injuryCooldown=5;s.movementMode='swim';s.grounded=false;s.eyeHeight=LIMITS.radius;s.wading=false;s.inAir=true;clearMotion(s);s.message={kind:'rescue',text:'DÂY CỨU HỘ ĐÃ KÉO BẠN LÊN',detail:'Dữ liệu chưa gửi đã mất. Những mẫu đã gửi vẫn còn.'}; }
export function restoreProgress(s,save) { if(!save||save.version!==1||!Array.isArray(save.banked))return; s.banked=[...new Set(save.banked.filter(id=>LANDMARKS.some(p=>p.id===id)))];s.scans=[...s.banked];s.completed=s.banked.length===LANDMARKS.length;s.deepest=clamp(Number(save.deepest)||0,0,250); }
export function serializableProgress(s) { return {version:1,banked:[...s.banked],deepest:Math.round(s.deepest)}; }
function constrainPosition(s,world) {
 const x=clamp(s.x,-LIMITS.world,LIMITS.world),z=clamp(s.z,LIMITS.minZ,LIMITS.maxZ);
 if((x===-LIMITS.world&&s.vx<0)||(x===LIMITS.world&&s.vx>0))s.vx=0;
 if((z===LIMITS.minZ&&s.vz<0)||(z===LIMITS.maxZ&&s.vz>0))s.vz=0;
 s.x=x;s.z=z;
 const floor=world.terrain(x,z)+LIMITS.radius;
 s.y=clamp(s.y,floor,.5);
 if((s.y<=floor&&s.vy<0)||(s.y>=.5&&s.vy>0))s.vy=0;
}
function penetratesSolid(x,y,z,world) {
 for(const c of world.colliders||[]){
  if(y<c.y-c.height/2-.5||y>c.y+c.height/2+.5)continue;
  if(Math.hypot(x-c.x,z-c.z)<c.radius+LIMITS.radius-CONTACT_EPSILON)return true;
 }
 return false;
}
// Explicit outdoor ground opts into shore physics. Old/null samples retain the
// original ocean. Floors, ceilings, water and boxes are all in world metres.
function sampleEnvironment(s,world) {
 const environment=world.sampleEnvironment?.(s);
 return (environment?.indoors===true||(environment?.outdoors===true&&environment.ground===true))&&typeof environment.waterLevel==='number'&&!Number.isNaN(environment.waterLevel)?environment:null;
}
const headClearance=eyeHeight=>LIMITS.radius-.4*(eyeHeight-LIMITS.radius);
function roomLimits(s,world,environment=sampleEnvironment(s,world)) {
 return {floor:environment&&Number.isFinite(environment.floorY)?environment.floorY:world.terrain(s.x,s.z),
  ceiling:environment?.outdoors===true?environment.ceilingY??Infinity:environment&&Number.isFinite(environment.ceilingY)?environment.ceilingY:.5+headClearance(s.eyeHeight??LIMITS.radius),
  headCeiling:environment?.outdoors===true?(environment.ceilingY??Infinity)-headClearance(s.eyeHeight??LIMITS.radius):environment&&Number.isFinite(environment.ceilingY)?environment.ceilingY-headClearance(s.eyeHeight??LIMITS.radius):.5};
}
function enabledBoxes(world) { return (world.boxColliders||[]).filter(box=>box.enabled!==false); }
function inside(value,min,max) { return value>min+CONTACT_EPSILON&&value<max-CONTACT_EPSILON; }
function overlapsBox(s,box,eye=s.eyeHeight,top=headClearance(eye)) {
 return inside(s.x,box.minX-LIMITS.radius,box.maxX+LIMITS.radius)&&inside(s.z,box.minZ-LIMITS.radius,box.maxZ+LIMITS.radius)&&inside(s.y,box.minY-top,box.maxY+eye);
}
function supportFloor(s,world,boxes,limits=roomLimits(s,world)) {
 let floor=limits.floor;
 for(const box of boxes){
  if(inside(s.x,box.minX-LIMITS.radius,box.maxX+LIMITS.radius)&&inside(s.z,box.minZ-LIMITS.radius,box.maxZ+LIMITS.radius)&&box.maxY<=s.y-s.eyeHeight+CONTACT_EPSILON)floor=Math.max(floor,box.maxY);
 }
 return floor;
}
// Sweeping each axis against expanded boxes catches thin walls even when a step
// crosses the whole wall. Only the contact-normal velocity is removed, so the
// remaining axes can slide; exact touching is not a penetration or a pushout.
function sweepAxis(s,axis,amount,boxes,eye=s.eyeHeight,top=headClearance(eye)) {
 if(!amount)return false;
 const start=s[axis];let end=start+amount;
 for(const box of boxes){
  const min={x:box.minX-LIMITS.radius,y:box.minY-top,z:box.minZ-LIMITS.radius};
  const max={x:box.maxX+LIMITS.radius,y:box.maxY+eye,z:box.maxZ+LIMITS.radius};
  if(['x','y','z'].some(other=>other!==axis&&!inside(s[other],min[other],max[other])))continue;
  if(amount>0&&start<=min[axis]+CONTACT_EPSILON&&end>min[axis])end=Math.min(end,min[axis]);
  if(amount<0&&start>=max[axis]-CONTACT_EPSILON&&end<max[axis])end=Math.max(end,max[axis]);
 }
 s[axis]=end;
 const blocked=end!==start+amount;
 if(blocked)s['v'+axis]=0;
 return blocked;
}
function constrainBounds(s,world) {
 const bounds=world.bounds||{}, minX=bounds.minX??-LIMITS.world,maxX=bounds.maxX??LIMITS.world,minZ=bounds.minZ??LIMITS.minZ,maxZ=bounds.maxZ??LIMITS.maxZ;
 s.x=clamp(s.x,minX,maxX);s.z=clamp(s.z,minZ,maxZ);
 if((s.x===minX&&s.vx<0)||(s.x===maxX&&s.vx>0))s.vx=0;
 if((s.z===minZ&&s.vz<0)||(s.z===maxZ&&s.vz>0))s.vz=0;
}
function recoverBoxOverlap(s,world,boxes) {
 // Door controllers should not close on occupants. A stale/new barrier that does
 // intersect the body still gets a deterministic minimum clear recovery, once.
 if(!boxes.some(box=>overlapsBox(s,box)))return;
 const origin={x:s.x,y:s.y,z:s.z}, candidates=[];
 for(const box of boxes){
  if(!overlapsBox(s,box))continue;
  for(const [axis,values] of [['x',[box.minX-LIMITS.radius,box.maxX+LIMITS.radius]],['z',[box.minZ-LIMITS.radius,box.maxZ+LIMITS.radius]],['y',[box.minY-headClearance(s.eyeHeight),box.maxY+s.eyeHeight]]]){
   for(const value of values)candidates.push({axis,value,distance:Math.abs(value-s[axis])});
  }
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 for(const candidate of candidates){
  Object.assign(s,origin);s[candidate.axis]=candidate.value;
  const limits=roomLimits(s,world);
  if(s.y-s.eyeHeight<limits.floor-CONTACT_EPSILON||s.y+headClearance(s.eyeHeight)>limits.ceiling+CONTACT_EPSILON)continue;
  if(boxes.some(box=>overlapsBox(s,box)))continue;
  s['v'+candidate.axis]=0;return;
 }
 Object.assign(s,origin);s.vx=s.vy=s.vz=0;
}
function updateStance(s,dt,world,boxes,walking,limitsOverride=null) {
 const oldEye=Number.isFinite(s.eyeHeight)?clamp(s.eyeHeight,LIMITS.radius,INTERIOR_MOTION.eyeHeight):LIMITS.radius;
 s.eyeHeight=oldEye;
 if(!walking){s.eyeHeight=Math.max(LIMITS.radius,oldEye-INTERIOR_MOTION.stanceRate*dt);return;}
 const limits=limitsOverride??roomLimits(s,world),floor=supportFloor(s,world,boxes,limits);
 const supported=s.y-oldEye<=floor+CONTACT_EPSILON&&s.vy<=0;
 let delta=Math.min(INTERIOR_MOTION.stanceRate*dt,INTERIOR_MOTION.eyeHeight-oldEye);
 if(supported){
  // Raising the head by delta lowers its upper clearance by .4*delta.
  let roof=limits.ceiling;
  for(const box of boxes)if(inside(s.x,box.minX-LIMITS.radius,box.maxX+LIMITS.radius)&&inside(s.z,box.minZ-LIMITS.radius,box.maxZ+LIMITS.radius)&&box.minY>=s.y+headClearance(oldEye)-CONTACT_EPSILON)roof=Math.min(roof,box.minY);
  delta=Math.min(delta,Math.max(0,(roof-s.y-headClearance(oldEye))/.6));
  s.eyeHeight=oldEye+delta;s.y+=delta;
 }else{
  // Uncurl in midair only into free space; the body must not grow through a floor.
  let lower=limits.floor;
  for(const box of boxes)if(inside(s.x,box.minX-LIMITS.radius,box.maxX+LIMITS.radius)&&inside(s.z,box.minZ-LIMITS.radius,box.maxZ+LIMITS.radius)&&box.maxY<=s.y-oldEye+CONTACT_EPSILON)lower=Math.max(lower,box.maxY);
  s.eyeHeight=oldEye+Math.min(delta,Math.max(0,s.y-oldEye-lower));
 }
}
function prepareActiveDrive(s,mx,my,mz,moving,walking,forward,strafe,rise) {
 if(!moving){activeDrive.delete(s);return null;}
 const length=Math.hypot(mx,my,mz),dx=mx/length,dy=my/length,dz=mz/length;
 let drive=activeDrive.get(s);
 if(!drive||drive.walking!==walking||drive.forward!==forward||drive.strafe!==strafe||drive.rise!==(walking?0:rise)){
  // A changed key/stick direction keeps its ordinary acceleration/reversal;
  // a simultaneous tiny mouse turn must not instantly redirect the old input.
  drive={vx:0,vy:0,vz:0};activeDrive.set(s,drive);
 }
 else if(s.yaw!==drive.yaw||(!walking&&s.pitch!==drive.pitch)){
  // Carry only the input-produced component along the last requested heading.
  // Residual momentum stays in world space, including the complete hit impulse.
  const carried=Math.max(0,drive.vx*drive.dx+drive.vy*drive.dy+drive.vz*drive.dz);
  const x=(dx-drive.dx)*carried,y=(dy-drive.dy)*carried,z=(dz-drive.dz)*carried;
  s.vx+=x;s.vy+=y;s.vz+=z;drive.vx+=x;drive.vy+=y;drive.vz+=z;
 }
 Object.assign(drive,{dx,dy,dz,yaw:s.yaw,pitch:s.pitch,walking,forward,strafe,rise:walking?0:rise});
 return drive;
}
function recordActiveDrive(s,drive,mx,my,mz,speed,blend) {
 if(!drive)return;
 drive.vx+=(mx*speed-drive.vx)*blend;drive.vy+=(my*speed-drive.vy)*blend;drive.vz+=(mz*speed-drive.vz)*blend;
 drive.expectedVx=s.vx;drive.expectedVy=s.vy;drive.expectedVz=s.vz;
}
function integrateInteriorVelocity(s,input,dt,walking) {
 const forward=(input.forward||0)-(input.back||0),strafe=(input.right||0)-(input.left||0),rise=(input.up||0)-(input.down||0);
 const cp=walking?1:Math.cos(s.pitch);
 let mx=-Math.sin(s.yaw)*cp*forward+Math.cos(s.yaw)*strafe;
 let my=walking?0:Math.sin(s.pitch)*forward+rise,mz=-Math.cos(s.yaw)*cp*forward-Math.sin(s.yaw)*strafe;
 const length=Math.hypot(mx,my,mz),moving=length>1e-8;if(length>1){mx/=length;my/=length;mz/=length;}
 if(!moving)mx=my=mz=0;
 const drive=prepareActiveDrive(s,mx,my,mz,moving,walking,forward,strafe,rise);
 s.sprinting=!!input.sprint&&length>.1&&s.oxygen>8;
 const speed=walking?(s.sprinting?INTERIOR_MOTION.sprint:INTERIOR_MOTION.walk):(s.sprinting?LIMITS.sprint:LIMITS.swim),blend=1-Math.exp(-dt*(moving?ACCELERATION:RELEASE_BRAKE));
 s.vx+=(mx*speed-s.vx)*blend;s.vz+=(mz*speed-s.vz)*blend;
 if(walking){
  // Preserve a continuous ballistic transition from swimming; no fly/jump input.
  if(!moving&&Math.hypot(s.vx,s.vz)<REST_SPEED)s.vx=s.vz=0;
 }else{
  s.vy+=(my*speed-s.vy)*blend;
  if(!moving&&Math.hypot(s.vx,s.vy,s.vz)<REST_SPEED)s.vx=s.vy=s.vz=0;
 }
 recordActiveDrive(s,drive,mx,my,mz,speed,blend);
}
function moveInterior(s,input,dt,world,environment) {
 s.wading=false;
 const previousMode=s.movementMode;
 if(!environment)s.movementMode='swim';
 else if(previousMode==='walk')s.movementMode=s.y<environment.waterLevel-INTERIOR_MOTION.waterHysteresis?'swim':'walk';
 else s.movementMode=s.y>environment.waterLevel+INTERIOR_MOTION.waterHysteresis?'walk':'swim';
 const walking=s.movementMode==='walk',boxes=enabledBoxes(world);
 s.eyeHeight=Number.isFinite(s.eyeHeight)?s.eyeHeight:LIMITS.radius;
 recoverBoxOverlap(s,world,boxes);
 updateStance(s,dt,world,boxes,walking);
 integrateInteriorVelocity(s,input,dt,walking);
 const ox=s.x,oy=s.y,oz=s.z,wasClear=!boxes.some(box=>overlapsBox(s,box));
 let limits=roomLimits(s,world),floor=supportFloor(s,world,boxes,limits);
 let supported=walking&&s.y-s.eyeHeight<=floor+CONTACT_EPSILON&&s.vy<=0;
 for(const axis of ['x','z']){
  const previous=s[axis],previousY=s.y,previousFloor=floor;
  sweepAxis(s,axis,s['v'+axis]*dt,boxes);constrainBounds(s,world);
  limits=roomLimits(s,world);floor=supportFloor(s,world,boxes,limits);
  if(walking){
   const rise=floor-previousFloor,headFloor=floor+s.eyeHeight;
   if((headFloor>s.y+CONTACT_EPSILON&&(!supported||rise>INTERIOR_MOTION.stepHeight))||headFloor+headClearance(s.eyeHeight)>limits.ceiling+CONTACT_EPSILON){
    s[axis]=previous;s['v'+axis]=0;s.y=previousY;floor=previousFloor;
   }else if(supported&&Math.abs(rise)<=INTERIOR_MOTION.stepHeight){
    sweepAxis(s,'y',headFloor-s.y,boxes);
    if(s.y<headFloor-CONTACT_EPSILON){s[axis]=previous;s['v'+axis]=0;s.y=previousY;floor=previousFloor;}
   }else supported=false;
  }
 }
 limits=roomLimits(s,world);floor=supportFloor(s,world,boxes,limits);
 supported=walking&&s.y-s.eyeHeight<=floor+CONTACT_EPSILON&&s.vy<=0;
 if(walking)s.vy=supported?0:Math.max(-18,s.vy-INTERIOR_MOTION.gravity*dt);
 sweepAxis(s,'y',s.vy*dt,boxes);
 const headFloor=floor+s.eyeHeight,headCeiling=limits.headCeiling;
 s.y=clamp(s.y,headFloor,Math.max(headFloor,headCeiling));
 if((s.y<=headFloor&&s.vy<0)||(s.y>=headCeiling&&s.vy>0))s.vy=0;
 for(const c of world.colliders||[]){
  if(s.y<c.y-c.height/2-.5||s.y>c.y+c.height/2+.5)continue;
  const dx=s.x-c.x,dz=s.z-c.z,d=Math.hypot(dx,dz),r=c.radius+LIMITS.radius;
  if(d<=r+CONTACT_EPSILON){const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;if(d<r-CONTACT_EPSILON){s.x=c.x+nx*r;s.z=c.z+nz*r;}const inward=s.vx*nx+s.vz*nz;if(inward<0){s.vx-=inward*nx;s.vz-=inward*nz;}}
 }
 constrainBounds(s,world);
 limits=roomLimits(s,world);floor=supportFloor(s,world,boxes,limits);
 s.y=clamp(s.y,floor+s.eyeHeight,Math.max(floor+s.eyeHeight,limits.headCeiling));
 if((s.y<=floor+s.eyeHeight&&s.vy<0)||(s.y>=limits.headCeiling&&s.vy>0))s.vy=0;
 if((wasClear&&boxes.some(box=>overlapsBox(s,box)))||(penetratesSolid(s.x,s.y,s.z,world)&&!penetratesSolid(ox,oy,oz,world))){s.x=ox;s.y=oy;s.z=oz;s.vx=s.vy=s.vz=0;}
 s.grounded=walking&&s.vy===0&&s.y-s.eyeHeight<=supportFloor(s,world,boxes)+CONTACT_EPSILON;
 if(!sampleEnvironment(s,world)){s.movementMode='swim';s.grounded=false;}
}

function outdoorSolidHeight(y,eyeHeight,collider) {
 return y-eyeHeight<collider.y+collider.height/2-CONTACT_EPSILON&&y+headClearance(eyeHeight)>collider.y-collider.height/2+CONTACT_EPSILON;
}
function penetratesOutdoorSolid(x,y,z,eyeHeight,world) {
 return (world.colliders||[]).some(c=>outdoorSolidHeight(y,eyeHeight,c)&&Math.hypot(x-c.x,z-c.z)<c.radius+LIMITS.radius-CONTACT_EPSILON);
}
function outdoorGround(s,world,boxes) {
 const environment=sampleEnvironment(s,world),limits=roomLimits(s,world,environment);
 if(!environment){limits.ceiling=Infinity;limits.headCeiling=Infinity;}
 return {environment,limits,floor:supportFloor(s,world,boxes,limits)};
}
function outdoorGradient(s,world,environment) {
 if(Number.isFinite(environment?.gradientX)&&Number.isFinite(environment?.gradientZ))return{x:environment.gradientX,z:environment.gradientZ};
 const e=.06;
 const floor=(x,z)=>{const point={...s,x,z},sample=sampleEnvironment(point,world);return Number.isFinite(sample?.floorY)?sample.floorY:world.terrain(x,z);};
 return{x:(floor(s.x+e,s.z)-floor(s.x-e,s.z))/(2*e),z:(floor(s.x,s.z+e)-floor(s.x,s.z-e))/(2*e)};
}
function outdoorWalking(s,environment,floor) {
 const water=environment?.waterLevel??0,depth=water-floor;
 const shoreLimit=OUTDOOR_MOTION.shoreDepth+(s.movementMode==='walk'?OUTDOOR_MOTION.shoreHysteresis:0);
 // Water depth and reachable ground determine standing. A surfaced swimmer over
 // deep water stays a swimmer; a falling body above it gets gravity until entry.
 const shallow=depth<=shoreLimit;
 const reachable=s.y<=floor+INTERIOR_MOTION.eyeHeight+OUTDOOR_MOTION.supportReach;
 return (shallow&&(reachable||depth<=0||s.movementMode==='walk'))||s.y>water+OUTDOOR_MOTION.surfaceCeiling+CONTACT_EPSILON;
}
function moveOutdoorHorizontal(s,dx,dz,world,boxes,walking) {
 let ground=outdoorGround(s,world,boxes),supported=walking&&s.y-s.eyeHeight<=ground.floor+CONTACT_EPSILON&&s.vy<=0;
 const origin={x:s.x,y:s.y,z:s.z};
 // First sweep solid boxes; terrain then validates the unobstructed displacement.
 sweepAxis(s,'x',dx,boxes);sweepAxis(s,'z',dz,boxes);constrainBounds(s,world);
 dx=s.x-origin.x;dz=s.z-origin.z;s.x=origin.x;s.z=origin.z;
 const segments=Math.max(1,Math.ceil(Math.hypot(dx,dz)/OUTDOOR_MOTION.sweepStep));
 const segmentX=dx/segments,segmentZ=dz/segments;
 function candidate(amountX,amountZ) {
  const previous={x:s.x,z:s.z},distance=Math.hypot(amountX,amountZ);
  s.x+=amountX;s.z+=amountZ;
  const next=outdoorGround(s,world,boxes),rise=next.floor-ground.floor;
  const maxSlope=next.environment?.maxSlope??OUTDOOR_MOTION.maxSlope;
  const gradient=outdoorGradient(s,world,next.environment),slope=Math.hypot(gradient.x,gradient.z);
  const lift=next.floor+s.eyeHeight-s.y;
  const obstructed=lift>CONTACT_EPSILON&&((walking&&!supported)||rise>Math.min(INTERIOR_MOTION.stepHeight,maxSlope*distance)+CONTACT_EPSILON||(rise>CONTACT_EPSILON&&slope>maxSlope+1e-4));
  const roof=next.floor+s.eyeHeight+headClearance(s.eyeHeight)>next.limits.ceiling+CONTACT_EPSILON;
  s.x=previous.x;s.z=previous.z;
  return {next,rise,distance,maxSlope,gradient,blocked:obstructed||roof};
 }
 function accept(amountX,amountZ,result) {
  s.x+=amountX;s.z+=amountZ;
  if(supported&&Math.abs(result.rise)<=Math.min(INTERIOR_MOTION.stepHeight,result.maxSlope*result.distance)+CONTACT_EPSILON){
   sweepAxis(s,'y',result.next.floor+s.eyeHeight-s.y,boxes);
  }else if(walking)supported=false;
  ground=result.next;
 }
 for(let segment=0;segment<segments;segment++){
  let amountX=segmentX,amountZ=segmentZ;
  if(Math.hypot(amountX,amountZ)<CONTACT_EPSILON)break;
  let result=candidate(amountX,amountZ);
  if(!result.blocked){accept(amountX,amountZ,result);continue;}
  // Find contact without advancing into the cliff, even for a fast impulse.
  let lo=0,hi=1;
  for(let n=0;n<18;n++){const mid=(lo+hi)/2;if(candidate(amountX*mid,amountZ*mid).blocked)hi=mid;else lo=mid;}
  const contact=candidate(amountX*hi,amountZ*hi);
  if(lo>0){const partial=candidate(amountX*lo,amountZ*lo);accept(amountX*lo,amountZ*lo,partial);}
  const length=Math.hypot(contact.gradient.x,contact.gradient.z);
  let nx=length>1e-8?contact.gradient.x/length:amountX/result.distance,nz=length>1e-8?contact.gradient.z/length:amountZ/result.distance;
  // No arbitrary axis fallback: a symmetric head-on collision stays centered.
  if(amountX*nx+amountZ*nz<0){nx=-nx;nz=-nz;}
  const inward=s.vx*nx+s.vz*nz;
  if(inward>0){s.vx-=inward*nx;s.vz-=inward*nz;}
  amountX*=1-lo;amountZ*=1-lo;
  const into=amountX*nx+amountZ*nz;amountX-=Math.max(0,into)*nx;amountZ-=Math.max(0,into)*nz;
  if(Math.hypot(amountX,amountZ)>CONTACT_EPSILON){result=candidate(amountX,amountZ);if(!result.blocked)accept(amountX,amountZ,result);}
  // Remaining segments use only the velocity that survived this terrain hit.
  if(segment+1<segments){
   const remaining=(segments-segment-1)/segments,normal=dx*nx+dz*nz;
   moveOutdoorHorizontal(s,(dx-Math.max(0,normal)*nx)*remaining,(dz-Math.max(0,normal)*nz)*remaining,world,boxes,walking);
  }
  break;
 }
}
function moveOutdoor(s,input,dt,world,environment) {
 const boxes=enabledBoxes(world);
 s.eyeHeight=Number.isFinite(s.eyeHeight)?s.eyeHeight:LIMITS.radius;
 recoverBoxOverlap(s,world,boxes);
 let ground=outdoorGround(s,world,boxes),walking=outdoorWalking(s,environment,ground.floor);
 s.movementMode=walking?'walk':'swim';
 updateStance(s,dt,world,boxes,walking,ground.limits);
 integrateInteriorVelocity(s,input,dt,walking);
 const ox=s.x,oy=s.y,oz=s.z,wasClear=!boxes.some(box=>overlapsBox(s,box));
 moveOutdoorHorizontal(s,s.vx*dt,s.vz*dt,world,boxes,walking);
 ground=outdoorGround(s,world,boxes);
 const supported=walking&&s.y-s.eyeHeight<=ground.floor+CONTACT_EPSILON&&s.vy<=0;
 if(walking)s.vy=supported?0:Math.max(-18,s.vy-INTERIOR_MOTION.gravity*dt);
 sweepAxis(s,'y',s.vy*dt,boxes);
 const water=ground.environment?.waterLevel??environment.waterLevel;
 let headFloor=ground.floor+s.eyeHeight,headCeiling=walking?ground.limits.headCeiling:Math.min(ground.limits.headCeiling,water+OUTDOOR_MOTION.surfaceCeiling);
 s.y=clamp(s.y,headFloor,Math.max(headFloor,headCeiling));
 if((s.y<=headFloor&&s.vy<0)||(s.y>=headCeiling&&s.vy>0))s.vy=0;
 for(const c of world.colliders||[]){
  if(!outdoorSolidHeight(s.y,s.eyeHeight,c))continue;
  const dx=s.x-c.x,dz=s.z-c.z,d=Math.hypot(dx,dz),r=c.radius+LIMITS.radius;
  if(d<=r+CONTACT_EPSILON){
   const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;
   // A tree/rock pushout cannot bypass the very cliff the input sweep rejected.
   if(d<r-CONTACT_EPSILON)moveOutdoorHorizontal(s,c.x+nx*r-s.x,c.z+nz*r-s.z,world,boxes,walking);
   const inward=s.vx*nx+s.vz*nz;if(inward<0){s.vx-=inward*nx;s.vz-=inward*nz;}
  }
 }
 constrainBounds(s,world);ground=outdoorGround(s,world,boxes);
 headFloor=ground.floor+s.eyeHeight;headCeiling=walking?ground.limits.headCeiling:Math.min(ground.limits.headCeiling,water+OUTDOOR_MOTION.surfaceCeiling);
 s.y=clamp(s.y,headFloor,Math.max(headFloor,headCeiling));
 if((s.y<=headFloor&&s.vy<0)||(s.y>=headCeiling&&s.vy>0))s.vy=0;
 if((wasClear&&boxes.some(box=>overlapsBox(s,box)))||(penetratesOutdoorSolid(s.x,s.y,s.z,s.eyeHeight,world)&&!penetratesOutdoorSolid(ox,oy,oz,s.eyeHeight,world))){s.x=ox;s.y=oy;s.z=oz;s.vx=s.vy=s.vz=0;ground=outdoorGround(s,world,boxes);}
 s.grounded=walking&&s.vy===0&&s.y-s.eyeHeight<=ground.floor+CONTACT_EPSILON;
 s.wading=s.grounded&&ground.floor<water&&s.y>water;
 // On entering deeper water, preserve head position and let the next step curl
 // the body into swim clearance. Never cap a standing camera to ocean height.
 if(!outdoorWalking(s,ground.environment??environment,ground.floor)){s.movementMode='swim';s.grounded=false;s.wading=false;}
}

function moveLegacy(s,input,dt,world) {
 const forward=(input.forward||0)-(input.back||0), strafe=(input.right||0)-(input.left||0), rise=(input.up||0)-(input.down||0);
 let mx=-Math.sin(s.yaw)*Math.cos(s.pitch)*forward+Math.cos(s.yaw)*strafe;
 let my=Math.sin(s.pitch)*forward+rise,mz=-Math.cos(s.yaw)*Math.cos(s.pitch)*forward-Math.sin(s.yaw)*strafe;
 const length=Math.hypot(mx,my,mz),moving=length>1e-8;if(length>1){mx/=length;my/=length;mz/=length;}
 if(!moving)mx=my=mz=0;
 const drive=prepareActiveDrive(s,mx,my,mz,moving,false,forward,strafe,rise);
 s.sprinting=!!input.sprint&&length>.1&&s.oxygen>8;const speed=s.sprinting?LIMITS.sprint:LIMITS.swim, blend=1-Math.exp(-dt*(moving?ACCELERATION:RELEASE_BRAKE));
 s.vx+=(mx*speed-s.vx)*blend;s.vy+=(my*speed-s.vy)*blend;s.vz+=(mz*speed-s.vz)*blend;
 if(!moving&&Math.hypot(s.vx,s.vy,s.vz)<REST_SPEED)s.vx=s.vy=s.vz=0;
 recordActiveDrive(s,drive,mx,my,mz,speed,blend);
 const ox=s.x,oy=s.y,oz=s.z;s.x+=s.vx*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;
 constrainPosition(s,world);
 for(const c of world.colliders||[]){
  if(s.y<c.y-c.height/2-.5||s.y>c.y+c.height/2+.5)continue;
  const dx=s.x-c.x,dz=s.z-c.z,d=Math.hypot(dx,dz),r=c.radius+LIMITS.radius;
  if(d<=r+CONTACT_EPSILON){
   const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;
   // Ignore sub-nanometre pushout roundoff so a resting contact stays exact.
   if(d<r-CONTACT_EPSILON){s.x=c.x+nx*r;s.z=c.z+nz*r;}
   const inward=s.vx*nx+s.vz*nz;
   if(inward<0){s.vx-=inward*nx;s.vz-=inward*nz;}
  }
 }
 // Pushout can change the terrain height or reach a world edge.
 constrainPosition(s,world);
 // Overlapping solids can push a diver into an earlier collider in the list.
 // Keep the last clear position instead of leaving an overlap that would keep
 // correcting (and visibly drifting) on later idle frames.
 if((s.x!==ox||s.y!==oy||s.z!==oz)&&penetratesSolid(s.x,s.y,s.z,world)&&!penetratesSolid(ox,oy,oz,world)){
  s.x=ox;s.y=oy;s.z=oz;s.vx=s.vy=s.vz=0;
 }
}

export function stepDive(s,input,dt,world) {
 if(s.status!=='playing'||dt<=0)return;
 dt=Math.min(dt,.05);s.time+=dt;s.injuryCooldown=Math.max(0,s.injuryCooldown-dt);s.sonar=Math.max(0,s.sonar-dt);s.sonarCooldown=Math.max(0,s.sonarCooldown-dt);
 s.yaw+=(input.turn||0)*dt*1.45;s.pitch=clamp(s.pitch+(input.tilt||0)*dt*1.05,-1.48,1.48);
 const ox=s.x,oy=s.y,oz=s.z;
 const environment=sampleEnvironment(s,world);
 const outdoorWater=outdoorMotion.get(s);
 if(environment?.outdoors===true&&environment.indoors!==true){outdoorMotion.set(s,environment.waterLevel);moveOutdoor(s,input,dt,world,environment);}
 else if(!environment&&outdoorWater!==undefined&&s.movementMode==='walk'&&s.y>outdoorWater+OUTDOOR_MOTION.surfaceCeiling){moveOutdoor(s,input,dt,world,{waterLevel:outdoorWater});}
 else{
  outdoorMotion.delete(s);
  if(environment||world.boxColliders?.length||world.bounds||s.movementMode==='walk'||s.eyeHeight!==LIMITS.radius)moveInterior(s,input,dt,world,environment);
  else moveLegacy(s,input,dt,world);
 }
 const drive=activeDrive.get(s);
 // Contact resolution owns its world-space deflection. Conservatively discard
 // steering ownership when a collision changes velocity; reacquire it only from
 // fresh input acceleration. Walking gravity never belongs to the drive.
 if(drive&&(s.vx!==drive.expectedVx||s.vz!==drive.expectedVz||(!drive.walking&&s.vy!==drive.expectedVy)))activeDrive.delete(s);
 s.distanceSwum+=Math.hypot(s.x-ox,s.y-oy,s.z-oz);s.deepest=Math.max(s.deepest,-s.y);
 const air=world.airBell, finalEnvironment=sampleEnvironment(s,world);
 s.inAir=finalEnvironment?s.y>finalEnvironment.waterLevel:s.y>=-1.1||!!(air&&distance(s,air)<air.radius);
 if(s.inAir){s.oxygen=Math.min(LIMITS.oxygen,s.oxygen+dt*22);s.health=Math.min(100,s.health+dt*8);}else{s.oxygen=Math.max(0,s.oxygen-dt*(1+Math.max(0,-s.y-35)*.004+(s.sprinting?.42:0)));}
 if(s.oxygen===0)s.health=Math.max(0,s.health-dt*16);
 s.threat=0;
 for(const c of world.threats||[]){const d=distance(s,c);s.threat=Math.max(s.threat,clamp(1-(d-c.radius)/28,0,1));if(d<c.radius+1.5&&s.injuryCooldown===0){s.health=Math.max(0,s.health-25);s.injuryCooldown=4;s.vx+=(s.x-c.x)*2;s.vy+=2;s.vz+=(s.z-c.z)*2;s.message={kind:'hit',text:'VA CHẠM SINH VẬT',detail:'Bơi lùi và giữ khoảng cách với sinh vật lớn.'};}}
 if(s.health<=0){recoverDiver(s);return;}
 const buoy={x:0,y:-.6,z:18};if(distance(s,buoy)<6&&s.y>-2){
  if(s.scans.length>s.banked.length){s.banked=[...s.scans];s.message={kind:'bank',text:'DỮ LIỆU ĐÃ GỬI',detail:`${s.banked.length} / 3 mẫu đã an toàn trên phao.`};}
  if(s.banked.length===3&&!s.completed){s.completed=true;s.message={kind:'complete',text:'BẠN ĐÃ MANG TIẾNG VỰC SÂU TRỞ VỀ',detail:'Chuyến khảo sát hoàn tất. Bạn có thể tiếp tục khám phá.'};}
 }
 let target=null,best=7;
 for(const p of world.locations){if(s.scans.includes(p.id))continue;const d=distance(s,p),dx=p.x-s.x,dy=p.y-s.y,dz=p.z-s.z;const dot=(-Math.sin(s.yaw)*Math.cos(s.pitch)*dx+Math.sin(s.pitch)*dy-Math.cos(s.yaw)*Math.cos(s.pitch)*dz)/Math.max(d,.001);if(d<best&&dot>.6){target=p;best=d;}}
 if(input.scan&&target){if(s.scanTarget!==target.id)s.scanProgress=0;s.scanTarget=target.id;s.scanProgress+=dt/2.5;if(s.scanProgress>=1){s.scans.push(target.id);s.scanProgress=0;s.scanTarget=null;s.message={kind:'scan',text:target.name+' · ĐÃ THU MẪU',detail:target.note};}}
 else{s.scanProgress=Math.max(0,s.scanProgress-dt*1.7);if(!s.scanProgress)s.scanTarget=null;}
 s.nearTarget=target?.id||null;
}
