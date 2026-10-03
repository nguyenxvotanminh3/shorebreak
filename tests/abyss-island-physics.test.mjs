// First-person shore contact against the same analytic surface as island meshes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDive,startDive,recoverDiver,stepDive,FIXED_STEP,LIMITS,INTERIOR_MOTION} from '../dist/abyss-sim.js';
import {terrainHeight as base} from '../dist/abyss-world.js';
import {sampleIslandTerrain,sampleIslandEnvironment,sampleIslandNormal,ISLAND_SAFE_PATH,ISLET_SAFE_PATH,ISLAND_SEA_ENTRIES,ISLAND_BOUNDS} from '../dist/abyss-island-terrain.js';

const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b} within ${e}`);
const position=s=>[s.x,s.y,s.z];
const velocity=s=>[s.vx,s.vy,s.vz];
const makeDiver=overrides=>Object.assign(createDive(),{status:'playing',x:0,y:.65,z:0,pitch:0},overrides);
function advance(s,world,seconds,input={}){for(let n=0;n<Math.round(seconds/FIXED_STEP);n++)stepDive(s,input,FIXED_STEP,world);}
function outdoor(terrain=()=>0,extra={}){
 return {terrain,locations:[],colliders:[],threats:[],bounds:ISLAND_BOUNDS,
  sampleEnvironment:s=>({outdoors:true,ground:true,floorY:terrain(s.x,s.z),ceilingY:Infinity,waterLevel:0,maxSlope:.55}),...extra};
}
const islands=()=>outdoor((x,z)=>sampleIslandTerrain(x,z,base),{sampleEnvironment:s=>sampleIslandEnvironment(s,base)});
function standing(world=outdoor(),overrides={}){
 const s=makeDiver(overrides);s.y=world.terrain(s.x,s.z)+LIMITS.radius;advance(s,world,1);return s;
}
function exactRest(s,world){
 advance(s,world,1);const before={position:position(s),velocity:velocity(s),travel:s.distanceSwum,eye:s.eyeHeight};
 advance(s,world,4,{turn:.2,tilt:.7});
 assert.deepEqual(position(s),before.position);assert.deepEqual(velocity(s),[0,0,0]);assert.equal(s.distanceSwum,before.travel);assert.equal(s.eyeHeight,before.eye);
}
function travel(s,world,route,report={swim:false,walk:false,wade:false,maxDelta:0,ticks:0}){
 for(const destination of route){
  let ticks=0;
  while(Math.hypot(s.x-destination.x,s.z-destination.z)>.2){
   s.yaw=Math.atan2(-(destination.x-s.x),-(destination.z-s.z));
   const y=s.y;stepDive(s,{forward:1},FIXED_STEP,world);
   report.maxDelta=Math.max(report.maxDelta,Math.abs(s.y-y));report.ticks++;
   report.swim ||=s.movementMode==='swim';report.walk ||=s.movementMode==='walk'&&s.grounded;report.wade ||=s.wading;
   assert.ok(s.y>=world.terrain(s.x,s.z)+s.eyeHeight-1e-8,'body remains above real terrain');
   assert.ok(++ticks<3000,`route blocked before ${JSON.stringify(destination)} at ${JSON.stringify(position(s))}`);
  }
 }
 return report;
}

test('all eight real shore approaches swim, wade, stand and return to swimming without a head jump',()=>{
 const world=islands();
 for(const entry of ISLAND_SEA_ENTRIES){
  const s=makeDiver({...entry.water,y:.2});
  const report=travel(s,world,[entry.beach]);
  assert.equal(s.movementMode,'walk');assert.equal(s.grounded,true);assert.equal(s.wading,false);assert.equal(s.inAir,true);
  assert.ok(s.y>3.8);near(s.eyeHeight,INTERIOR_MOTION.eyeHeight);assert.ok(report.swim&&report.walk&&report.wade);
  exactRest(s,world);s.pitch=0;
  travel(s,world,[entry.water],report);assert.equal(s.movementMode,'swim');assert.equal(s.grounded,false);assert.equal(s.wading,false);
  advance(s,world,1);near(s.eyeHeight,LIMITS.radius);assert.ok(report.maxDelta<.09,`bearing ${entry.bearing} jumped ${report.maxDelta}`);
  exactRest(s,world);
 }
});

test('the complete curved mountain trail climbs to 54m and returns to open water under ordinary walking controls',()=>{
 const world=islands(),s=makeDiver({...ISLAND_SAFE_PATH[0],y:.2});
 const report=travel(s,world,ISLAND_SAFE_PATH.slice(1));
 assert.equal(s.movementMode,'walk');assert.equal(s.grounded,true);assert.equal(s.inAir,true);assert.ok(s.y>55.5);
 near(s.eyeHeight,INTERIOR_MOTION.eyeHeight);assert.ok(report.swim&&report.wade&&report.walk);exactRest(s,world);
 s.pitch=0;travel(s,world,[...ISLAND_SAFE_PATH].reverse(),report);assert.equal(s.movementMode,'swim');assert.equal(s.grounded,false);
 assert.ok(report.maxDelta<.09,`head step ${report.maxDelta}`);exactRest(s,world);
});

test('the separate islet also supports a complete water-to-summit-to-water route',()=>{
 const world=islands(),s=makeDiver({...ISLET_SAFE_PATH[0],y:.2});
 const report=travel(s,world,ISLET_SAFE_PATH.slice(1));assert.ok(s.y>16.5);assert.equal(s.grounded,true);
 travel(s,world,[...ISLET_SAFE_PATH].reverse(),report);assert.equal(s.movementMode,'swim');assert.ok(report.wade&&report.walk&&report.swim);assert.ok(report.maxDelta<.09);
});

test('outdoor walking uses yaw only, has exact idle rest, and ignores Space or dive keys on land',()=>{
 const world=outdoor((x,z)=>8+x*.2),states=[-1.4,0,1.4].map(pitch=>standing(world,{pitch}));
 for(const s of states){advance(s,world,3,{forward:1,right:1,up:1,down:1,sprint:1});assert.equal(s.movementMode,'walk');assert.equal(s.grounded,true);near(s.y,world.terrain(s.x,s.z)+1.65);exactRest(s,world);const y=s.y;advance(s,world,2,{up:1,down:1});assert.equal(s.y,y);}
 assert.deepEqual(position(states[0]),position(states[1]));assert.deepEqual(position(states[1]),position(states[2]));
});

test('surfacing over deep outdoor water never creates support and up cannot fly beyond the water surface',()=>{
 const world=outdoor(()=>-30),s=makeDiver({y:.2});advance(s,world,3,{up:1,sprint:1});
 assert.equal(s.movementMode,'swim');assert.equal(s.grounded,false);assert.equal(s.wading,false);near(s.y,.5);near(s.eyeHeight,LIMITS.radius);exactRest(s,world);
 const y=s.y;advance(s,world,.3,{down:1});assert.ok(s.y<y-.5);
});

test('a dry outdoor ledge falls continuously under gravity and resumes swimming at water entry',()=>{
 const terrain=x=>x<=1?6:-20,world=outdoor(terrain),s=standing(world);let fell=false,swam=false,last=s.y;
 for(let n=0;n<450;n++){
  stepDive(s,{right:1,up:1},FIXED_STEP,world);
  if(s.x>1&&s.y>.6){fell=true;assert.equal(s.grounded,false);assert.ok(s.vy<0,'Space cannot cancel falling');assert.ok(s.y<last);}
  if(fell&&s.movementMode==='swim')swam=true;
  assert.ok(Math.abs(s.y-last)<.21,'ledge never snaps to the distant floor');last=s.y;
 }
 assert.ok(fell&&swam);assert.equal(s.grounded,false);near(s.y,.5);exactRest(s,world);
});

test('an above-water lower ledge lands at standing height without horizontal creep',()=>{
 const world=outdoor(x=>x<=1?8:2),s=standing(world);let fell=false;
 for(let n=0;n<250;n++){stepDive(s,{right:1,up:1},FIXED_STEP,world);if(s.x>1&&!s.grounded){fell=true;assert.ok(s.vy<0);}}
 assert.ok(fell);assert.equal(s.grounded,true);near(s.y,3.65);exactRest(s,world);
});

test('leaving the island sampler while airborne retains gravity instead of snapping to the ocean ceiling',()=>{
 const terrain=x=>x<=1?6:-20,world=outdoor(terrain),sample=world.sampleEnvironment;
 world.sampleEnvironment=s=>s.x<=1?sample(s):null;
 const s=standing(world);let fell=false,last=s.y;
 for(let n=0;n<450;n++){
  stepDive(s,{right:1,up:1},FIXED_STEP,world);
  assert.ok(Math.abs(s.y-last)<.21,'optional sample boundary must not teleport the head');
  if(s.x>1&&s.y>.6){fell=true;assert.ok(s.vy<0);assert.equal(s.grounded,false);}
  last=s.y;
 }
 assert.ok(fell);assert.equal(s.movementMode,'swim');near(s.y,.5);exactRest(s,world);
});

test('steep continuous slopes cannot be climbed through tiny per-frame steps or sustained Space',()=>{
 for(const dt of [1/30,1/60,1/120]){
  const world=outdoor(x=>3+Math.max(0,x-1)*2),s=standing(world);
  for(let i=0;i<8/dt;i++)stepDive(s,{right:1,up:1,sprint:1},dt,world);
  assert.ok(s.x<=1+1e-7,`dt=${dt} climbed to ${s.x}`);near(s.y,4.65,1e-7);near(s.vx,0);exactRest(s,world);
 }
});

test('cliffs preserve tangential sliding, reject high-speed tunneling, and stay centered at a head-on contact',()=>{
 const world=outdoor(x=>x<=1?3:12),s=standing(world);
 advance(s,world,2,{right:1});assert.ok(s.x<=1);near(s.z,0);near(s.vx,0);near(s.vz,0);
 const z=s.z;advance(s,world,2,{right:1,forward:1});assert.ok(s.x<=1);assert.ok(s.z<z-3);near(s.vx,0);exactRest(s,world);
 const fast=standing(world);fast.vx=600;stepDive(fast,{right:1},.05,world);assert.ok(fast.x<=1);near(fast.y,4.65);near(fast.vx,0);exactRest(fast,world);
 const diagonal=standing(world);diagonal.vx=diagonal.vz=300;stepDive(diagonal,{right:1,back:1},.05,world);
 assert.ok(diagonal.x<=1);assert.ok(diagonal.z>8);near(diagonal.vx,0);assert.ok(diagonal.vz>200);near(diagonal.y,4.65);
});

test('a nearby tree or rock cannot push a grounded player up an otherwise unclimbable cliff',()=>{
 const world=outdoor(x=>x<=1?3:12,{colliders:[{x:0,z:0,y:5,height:8,radius:.6}]}),s=standing(world,{x:.95,z:2});
 let maxRise=0;
 for(let n=0;n<300;n++){const y=s.y;stepDive(s,{forward:1,up:1},FIXED_STEP,world);maxRise=Math.max(maxRise,s.y-y);}
 assert.ok(s.x<=1);near(s.y,4.65);assert.ok(maxRise<.001);exactRest(s,world);
});

test('standing body contact blocks low shrubs and rocks even when their tops sit below the camera',()=>{
 for(const height of [.4,.8]){
  const collider={x:0,z:-3,y:3+height/2,height,radius:.45},world=outdoor(()=>3,{colliders:[collider]}),s=standing(world);
  advance(s,world,2,{forward:1,up:1});
  near(s.x,0);near(s.z,collider.z+collider.radius+LIMITS.radius);near(s.y,4.65);assert.equal(s.grounded,true);assert.deepEqual(velocity(s),[0,0,0]);
  exactRest(s,world);s.yaw=0;s.pitch=0;
  advance(s,world,1,{forward:1,right:1});assert.ok(s.x>.8,'low contact preserves a path around the obstacle');
  assert.ok(Math.hypot(s.x-collider.x,s.z-collider.z)>=collider.radius+LIMITS.radius-1e-9);exactRest(s,world);
 }
});

test('outdoor cylinders wholly below the feet or above the head do not create phantom blocking',()=>{
 for(const collider of [{x:0,z:-3,y:2.4,height:.4,radius:.45},{x:0,z:-3,y:5.4,height:.4,radius:.45}]){
  const world=outdoor(()=>3,{colliders:[collider]}),s=standing(world);advance(s,world,2,{forward:1});
  assert.ok(s.z<-5);near(s.x,0);near(s.y,4.65);assert.equal(s.grounded,true);
 }
});

test('real off-trail mountain faces block uphill walking despite small fixed-step floor changes',()=>{
 const world=islands();let point;
 for(let x=70;x<=160&&!point;x+=4)for(let z=110;z<=195&&!point;z+=4){
  const normal=sampleIslandNormal(x,z,base),height=world.terrain(x,z);
  if(height>10&&normal.slope>1.2)point={x,z,normal};
 }
 assert.ok(point);const s=standing(world,point),origin=position(s),slope=Math.hypot(point.normal.x,point.normal.z);
 s.yaw=Math.atan2(point.normal.x/slope,point.normal.z/slope);advance(s,world,2,{forward:1,up:1});
 assert.ok(s.y<=origin[1]+.001);assert.ok(Math.hypot(s.x-origin[0],s.z-origin[2])<.01);exactRest(s,world);
});

test('island travel and release agree exactly at 30, 60 and 120Hz rendered fixed steps',()=>{
 const run=hz=>{
  const world=islands(),entry=ISLAND_SEA_ENTRIES[2],s=makeDiver({...entry.water,y:.2}),route=[entry.beach,entry.water];
  let accumulator=0,tick=0,waypoint=0;
  for(let frame=0;frame<hz*18;frame++){
   accumulator+=1/hz;
   while(accumulator+1e-12>=FIXED_STEP){
    if(waypoint<route.length&&Math.hypot(s.x-route[waypoint].x,s.z-route[waypoint].z)<.2)waypoint++;
    if(waypoint<route.length)s.yaw=Math.atan2(-(route[waypoint].x-s.x),-(route[waypoint].z-s.z));
    stepDive(s,waypoint<route.length?{forward:1}:{},FIXED_STEP,world);accumulator-=FIXED_STEP;tick++;
   }
  }
  assert.equal(tick,1620);assert.equal(waypoint,2);return s;
 };
 assert.deepEqual(run(30),run(60));assert.deepEqual(run(60),run(120));
});

test('wading state resets after rescue and restart while pause preserves the full shore state',()=>{
 const world=outdoor(()=>-.8),s=standing(world);assert.equal(s.wading,true);
 s.status='paused';const snapshot=structuredClone(s);advance(s,world,1,{up:1});assert.deepEqual(s,snapshot);
 recoverDiver(s);assert.equal(s.wading,false);assert.equal(s.grounded,false);s.wading=true;startDive(s);assert.equal(s.wading,false);assert.equal(s.movementMode,'swim');
});
