// Frozen same-runtime regression oracle, NOT production code.
// Source: dist/abyss-sim.js at 283be2aa4079dd7f1b91f184a1fb3dddab9e3abf
// Source Git blob: b34e6f16d5fb7a648a35c8873c3b83d1cc4aace9
// The complete old stepDive and its dependencies are retained unchanged;
// unrelated location, reset, sonar and persistence exports are omitted.
// No import of the current simulation is allowed. See README.md.
// Deterministic expedition simulation, independent of browser/renderer.
export const FIXED_STEP = 1 / 90;
export const LIMITS = Object.freeze({ oxygen: 150, swim: 5.8, sprint: 9.2, radius: .65, world: 215, minZ: -222, maxZ: 75 });
// Keep the swim-up easing, but settle a released stick/key quickly and exactly.
// At sprint speed this leaves a short ~0.41m glide and stops within 0.32s.
const ACCELERATION = 4.8, RELEASE_BRAKE = 20, REST_SPEED = .02;
const CONTACT_EPSILON = 1e-9;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function createDive() {
 return { status:'menu', x:0,y:-3.2,z:18, vx:0,vy:0,vz:0, yaw:0,pitch:-.22, oxygen:LIMITS.oxygen, health:100, time:0, deepest:0,
   scans:[],banked:[],scanProgress:0,scanTarget:null,nearTarget:null, rescues:0, flashlight:true, sonar:0, sonarCooldown:0, threat:0, injuryCooldown:0, message:null, completed:false, sprinting:false, inAir:false, distanceSwum:0 };
}
export function clearMotion(s) { s.vx=s.vy=s.vz=0; s.sprinting=false; s.scanProgress=0; s.scanTarget=null; }
export function recoverDiver(s) { s.x=0;s.y=-1;s.z=18;s.yaw=0;s.pitch=-.22;s.oxygen=LIMITS.oxygen;s.health=100;s.scans=[...s.banked];s.rescues++;s.injuryCooldown=5;clearMotion(s);s.message={kind:'rescue',text:'DÂY CỨU HỘ ĐÃ KÉO BẠN LÊN',detail:'Dữ liệu chưa gửi đã mất. Những mẫu đã gửi vẫn còn.'}; }
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
export function stepDive(s,input,dt,world) {
 if(s.status!=='playing'||dt<=0)return;
 dt=Math.min(dt,.05);s.time+=dt;s.injuryCooldown=Math.max(0,s.injuryCooldown-dt);s.sonar=Math.max(0,s.sonar-dt);s.sonarCooldown=Math.max(0,s.sonarCooldown-dt);
 s.yaw+=(input.turn||0)*dt*1.45;s.pitch=clamp(s.pitch+(input.tilt||0)*dt*1.05,-1.48,1.48);
 const forward=(input.forward||0)-(input.back||0), strafe=(input.right||0)-(input.left||0), rise=(input.up||0)-(input.down||0);
 let mx=-Math.sin(s.yaw)*Math.cos(s.pitch)*forward+Math.cos(s.yaw)*strafe;
 let my=Math.sin(s.pitch)*forward+rise,mz=-Math.cos(s.yaw)*Math.cos(s.pitch)*forward-Math.sin(s.yaw)*strafe;
 const length=Math.hypot(mx,my,mz),moving=length>1e-8;if(length>1){mx/=length;my/=length;mz/=length;}
 if(!moving)mx=my=mz=0;
 s.sprinting=!!input.sprint&&length>.1&&s.oxygen>8;const speed=s.sprinting?LIMITS.sprint:LIMITS.swim, blend=1-Math.exp(-dt*(moving?ACCELERATION:RELEASE_BRAKE));
 s.vx+=(mx*speed-s.vx)*blend;s.vy+=(my*speed-s.vy)*blend;s.vz+=(mz*speed-s.vz)*blend;
 if(!moving&&Math.hypot(s.vx,s.vy,s.vz)<REST_SPEED)s.vx=s.vy=s.vz=0;
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
 s.distanceSwum+=Math.hypot(s.x-ox,s.y-oy,s.z-oz);s.deepest=Math.max(s.deepest,-s.y);
 const air=world.airBell;s.inAir=s.y>=-1.1||!!(air&&distance(s,air)<air.radius);
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
