import {sampleWater} from './water.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
const smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a),0,1);return u*u*(3-2*u);};
const surface={},nose={},tail={},railL={},railR={};
export const FIXED_DT=1/120;
export function resetPhysics(s){Object.assign(s,{x:0,y:0,z:0,offset:0,speed:8.6,latVel:0,steer:0,lean:0,charge:0,air:false,airY:0,vy:0,airTime:0,airProgress:0,airVX:0,airVZ:0,launchVy:0,launchHeight:0,launchWasLip:false,spinDirection:0,spinAngle:0,landingTime:0,landingImpact:0,peakAir:0,maxAir:0,wasJump:false,wipe:0,invulnerable:0,edgeTime:0,carve:0,carveDirection:0,lastCarve:0,nx:0,ny:1,nz:0,obstaclesDodged:0,collisions:0,crashes:0,auraDwell:0,auraActive:false,auraClears:0,airCount:0,auraStyle:0});s.x=(s.oceanTime*.72+.4)/.23;sampleWater(s.x,s.z,s.oceanTime,surface);s.y=surface.h+.14;s.airY=s.y;}
export function beginWipeout(s,duration=2.4){s.wipe=duration;s.invulnerable=duration+2.4;s.air=false;s.speed=Math.max(4.4,s.speed*.5);s.latVel*=.25;s.charge=0;s.wasJump=false;s.combo=1;s.comboTime=0;s.edgeTime=0;s.carve=0;s.carveDirection=0;s.lastCarve=0;s.landingTime=.5;}
function groundNormal(s,dt){sampleWater(s.x,s.z-.7,s.oceanTime,nose);sampleWater(s.x,s.z+.7,s.oceanTime,tail);sampleWater(s.x-.24,s.z,s.oceanTime,railL);sampleWater(s.x+.24,s.z,s.oceanTime,railR);const dx=(railR.h-railL.h)/.48,dz=(tail.h-nose.h)/1.4,inv=1/Math.hypot(dx,1,dz);s.nx=damp(s.nx,-dx*inv,11,dt);s.ny=damp(s.ny,inv,11,dt);s.nz=damp(s.nz,-dz*inv,11,dt);}
export function advancePhysics(s,input,dt,emit=()=>{}){
 const steer=(input.right?1:0)-(input.left?1:0);

 s.steer=damp(s.steer,steer,9,dt);s.lean=damp(s.lean,s.steer,6.5,dt);
 s.invulnerable=Math.max(0,s.invulnerable-dt);s.landingTime=Math.max(0,s.landingTime-dt);
 sampleWater(s.x,s.z,s.oceanTime,surface);
 s.auraActive=!!(s.air&&input.aura&&s.airTime>.12&&s.airProgress<.86&&s.y-surface.h>.8);if(s.auraActive)s.auraDwell+=dt;
 if(s.wipe>0){s.wipe=Math.max(0,s.wipe-dt);s.offset=damp(s.offset,0,3.5,dt);s.z-=s.speed*dt;s.x=(s.oceanTime*.72-s.z*.035+.4)/.23+s.offset;s.spinAngle=damp(s.spinAngle,0,9,dt);s.lean=damp(s.lean,0,7,dt);if(s.wipe===0){s.speed=7.8;emit('recover');}}
 else if(s.air){
  // Preserve world-space takeoff momentum. Air steering only makes a small correction.
  s.airVX+=steer*.32*dt;s.x+=s.airVX*dt;s.z+=s.airVZ*dt;s.vy-=9.81*dt;s.y+=s.vy*dt;s.airY=s.y;s.airTime+=dt;
  s.offset=s.x-(s.oceanTime*.72-s.z*.035+.4)/.23;
  s.airProgress=clamp(s.airTime/(2*s.launchVy/9.81),0,1);
  s.spinAngle=s.spinDirection*Math.PI*2*smooth(.04,.94,s.airProgress);
  s.peakAir=Math.max(s.peakAir,s.y-s.launchHeight);s.maxAir=Math.max(s.maxAir,s.peakAir);
  sampleWater(s.x,s.z,s.oceanTime,surface);
  if(s.airTime>.1&&s.y<=surface.h+.14){
   const surfaceVy=surface.dt+surface.dx*s.airVX+surface.dz*s.airVZ;
   const impact=Math.max(0,(surfaceVy-s.vy)/Math.hypot(surface.dx,1,surface.dz));
   s.y=surface.h+.14;s.airY=s.y;s.air=false;s.landingTime=.65;s.landingImpact=clamp(impact/12,.25,1);s.latVel=s.airVX-(.72+.035*s.speed)/.23;
   const residual=Math.abs(Math.sin(s.spinAngle*.5));
   const clean=Math.abs(s.steer)<.66&&residual<.45;
   if(impact>16||Math.abs(s.steer)>.95&&residual>.55){beginWipeout(s);emit('wipeout');}
   else{s.speed*=clean?.99:.83;emit('landing',{clean,impact,height:s.peakAir,spin:s.spinDirection!==0,lip:s.launchWasLip});}
  }
 }else{
  const phase=.4+s.offset*.23,gradient=.23*(2.05*Math.cos(phase)+.88*Math.cos(2*phase));
  const targetLat=steer*s.speed*.51;s.latVel=damp(s.latVel,targetLat,input.brake?8:5.2,dt);
  const downhill=-gradient*s.latVel,pocket=Math.exp(-Math.pow((phase-.6)/1.65,2));
  let acceleration=2.2+pocket*1.65-s.speed*s.speed*.034+downhill*.48-Math.abs(s.latVel)*.06;
  if(input.pump&&downhill>.1)acceleration+=Math.min(3.4,downhill*.92);
  if(input.brake)acceleration-=4.5;
  s.speed=clamp(s.speed+acceleration*dt,4.4,18.2);s.offset+=s.latVel*dt;
  if(Math.abs(s.offset)>13)s.latVel-=Math.sign(s.offset)*(Math.abs(s.offset)-13)*2*dt;
  s.offset=clamp(s.offset,-19,19);s.z-=s.speed*dt;s.x=(s.oceanTime*.72-s.z*.035+.4)/.23+s.offset;
  if(Math.abs(s.offset)>15.5)s.edgeTime+=dt;else s.edgeTime=Math.max(0,s.edgeTime-2*dt);
  if(s.edgeTime>2.6){beginWipeout(s);emit('wipeout');}
  s.score+=(5+s.speed*.9)*pocket*s.combo*dt;
  if(Math.abs(s.steer)>.4&&pocket>.22){const sign=Math.sign(s.steer);if(sign!==s.carveDirection){s.carve=0;s.carveDirection=sign;}s.carve+=Math.abs(s.latVel)*dt;if(s.carve>4.4&&sign!==s.lastCarve){emit('carve',{cutback:s.lastCarve!==0});s.carve=0;s.lastCarve=sign;}}
  if(input.jump)s.charge=Math.min(1,s.charge+dt*1.45);
  sampleWater(s.x,s.z,s.oceanTime,surface);s.y=surface.h+.14;
  if(!input.jump&&s.wasJump&&s.charge>.1&&s.wipe<=0){
   const lipQuality=smooth(.05,.82,Math.sin(.4+s.offset*.23));
   const lip=lipQuality>.36&&s.speed>7;s.launchWasLip=lip;s.air=true;s.auraStyle=s.airCount++%3;s.auraDwell=0;s.airTime=0;s.airProgress=0;s.peakAir=0;s.launchHeight=s.y;
   s.launchVy=lip?7.1+s.charge*2.25+clamp(s.speed-8,0,6)*.12:4.25+s.charge*1.1;
   s.vy=s.launchVy;s.airVX=(.72+.035*s.speed)/.23+s.latVel;s.airVZ=-s.speed;s.airY=s.y;
   s.spinDirection=lip&&Math.abs(s.steer)>.38?Math.sign(s.steer):0;s.spinAngle=0;s.charge=0;
   emit('launch',{lip,spin:s.spinDirection!==0});
  }
 }
 s.wasJump=input.jump;
 if(!s.air){sampleWater(s.x,s.z,s.oceanTime,surface);s.y=surface.h+.14;s.airY=s.y;if(s.landingTime<=0)s.spinAngle=0;else s.spinAngle=damp(s.spinAngle,Math.round(s.spinAngle/(Math.PI*2))*Math.PI*2,12,dt);}
 if(!s.air||s.wipe>0)s.auraActive=false;
 groundNormal(s,dt);s.maxSpeed=Math.max(s.maxSpeed,s.speed);
}
