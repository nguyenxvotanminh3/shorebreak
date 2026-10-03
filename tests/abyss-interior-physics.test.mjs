// Deterministic head-position physics tests. No renderer or pixel-quality claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDive, startDive, clearMotion, recoverDiver, restoreProgress, serializableProgress, stepDive, FIXED_STEP, LIMITS, INTERIOR_MOTION } from '../dist/abyss-sim.js';
import { createDive as createBaselineDive, stepDive as stepBaselineDive, FIXED_STEP as BASELINE_STEP, LIMITS as BASELINE_LIMITS } from './fixtures/abyss-sim-283be2a.mjs';

const FLOOR=-40, CEILING=-35;
const ocean=()=>({ terrain:()=>-100, locations:[], colliders:[], threats:[] });
function room(overrides={}) {
 const environment={indoors:true,floorY:FLOOR,ceilingY:CEILING,waterLevel:FLOOR-1,...overrides};
 return {...ocean(),environment,sampleEnvironment:()=>environment};
}
const diver=overrides=>Object.assign(createDive(),{status:'playing',x:0,y:FLOOR+LIMITS.radius,z:0,pitch:0},overrides);
const xyz=s=>[s.x,s.y,s.z];
const velocity=s=>[s.vx,s.vy,s.vz];
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b} (within ${e})`);
function advance(s,world,seconds,input={}) { for(let n=0;n<Math.round(seconds/FIXED_STEP);n++)stepDive(s,input,FIXED_STEP,world); }
function standing(world=room(),overrides={}) { const s=diver(overrides);advance(s,world,1);return s; }
const wall={minX:2,maxX:2.03,minY:FLOOR,maxY:CEILING,minZ:-20,maxZ:20};
function assertRest(s,world,seconds=10) {
 const position=xyz(s),travel=s.distanceSwum,eye=s.eyeHeight;
 advance(s,world,seconds);
 assert.deepEqual(xyz(s),position);assert.deepEqual(velocity(s),[0,0,0]);assert.equal(s.distanceSwum,travel);assert.equal(s.eyeHeight,eye);
}

test('fixed-heading ocean movement and released free look retain exact historical trajectories',()=>{
 // Evaluate the frozen pre-interior generator in this engine. Cross-machine
 // Float64 goldens differed by one ULP; no tolerance is used here, at any tick.
 // Active turning now intentionally steers input-owned momentum; its new
 // contract lives in abyss-heading.test.mjs. Fixed-heading movement/reversals
 // and free look after release retain the historical acceleration/braking.
 assert.equal(FIXED_STEP,BASELINE_STEP);assert.deepEqual(LIMITS,BASELINE_LIMITS);
 for(const world of [ocean(),{...ocean(),sampleEnvironment:()=>null},{...ocean(),sampleEnvironment:()=>({indoors:false}),boxColliders:[]},{...ocean(),bounds:{minX:-320,maxX:320,minZ:-420,maxZ:95}},{...ocean(),boxColliders:[{...wall,minX:150,maxX:151}]}]){
  const s=diver({y:-40,z:18,pitch:.17,yaw:.33});
  const expected=Object.assign(createBaselineDive(),{status:'playing',x:0,y:-40,z:18,pitch:.17,yaw:.33});
  for(let tick=0;tick<900;tick++){
   const input=tick<300?{forward:1,right:.4,up:.2,sprint:1}:tick<600?{back:.5,left:.8}:{turn:.1,tilt:-.1};
   stepBaselineDive(expected,input,BASELINE_STEP,world);stepDive(s,input,FIXED_STEP,world);
   assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key=>[key,s[key]])),expected,`ocean replay tick ${tick}`);
  }
  assert.deepEqual(velocity(s),[0,0,0]);
  assert.equal(s.movementMode,'swim');assert.equal(s.eyeHeight,LIMITS.radius);
 }
});

test('frozen ocean baseline rejects a changed movement trajectory without a tolerance',()=>{
 const s=diver({y:-40,z:18,pitch:.17,yaw:.33});
 const expected=Object.assign(createBaselineDive(),{status:'playing',x:0,y:-40,z:18,pitch:.17,yaw:.33});
 stepBaselineDive(expected,{forward:1,right:.4,up:.2,sprint:1},BASELINE_STEP,ocean());
 stepDive(s,{forward:1,right:.41,up:.2,sprint:1},FIXED_STEP,ocean());
 assert.throws(()=>assert.deepEqual(xyz(s),xyz(expected)),{code:'ERR_ASSERTION'});
 // A one-ULP change also fails: portability comes from sharing the engine,
 // not weakening the comparison to accommodate nearly equal trajectories.
 const changed=new Float64Array([expected.z]);new BigUint64Array(changed.buffer)[0]^=1n;
 assert.notEqual(changed[0],expected.z);
 assert.throws(()=>assert.deepEqual([expected.x,expected.y,changed[0]],xyz(expected)),{code:'ERR_ASSERTION'});
});

test('dry walking follows yaw independent of free-look pitch and ignores swim rise keys',()=>{
 const world=room();
 const states=[-1.4,0,1.4].map(pitch=>standing(world,{pitch}));
 for(const s of states){advance(s,world,3,{forward:1,up:1});assert.equal(s.movementMode,'walk');assert.equal(s.grounded,true);near(s.y,FLOOR+INTERIOR_MOTION.eyeHeight);near(Math.hypot(s.vx,s.vz),INTERIOR_MOTION.walk,3e-6);}
 assert.deepEqual(xyz(states[0]),xyz(states[1]));assert.deepEqual(xyz(states[2]),xyz(states[1]));
 const s=standing(world);advance(s,world,3,{forward:1,right:1,sprint:1,down:1});near(Math.hypot(s.vx,s.vz),INTERIOR_MOTION.sprint,3e-6);
 advance(s,world,1);const position=xyz(s);advance(s,world,5,{turn:1,tilt:1,up:1,down:1});assert.deepEqual(xyz(s),position);assert.equal(s.pitch,1.48);assert.equal(s.sprinting,false);
});

test('standing grows continuously from swim clearance and settles at exact rest',()=>{
 const world=room(),s=diver();let previousY=s.y;
 for(let n=0;n<90;n++){stepDive(s,{},FIXED_STEP,world);assert.ok(s.y>=previousY);assert.ok(s.y-previousY<=INTERIOR_MOTION.stanceRate*FIXED_STEP+1e-9);previousY=s.y;}
 near(s.eyeHeight,1.65);near(s.y,FLOOR+1.65);assert.equal(s.grounded,true);assertRest(s,world);
});

test('waterline uses head-height hysteresis rather than feet or room-wide state',()=>{
 const world=room(),s=standing(world);
 world.environment.waterLevel=s.y+.04;stepDive(s,{},FIXED_STEP,world);assert.equal(s.movementMode,'walk');assert.equal(s.inAir,false);
 world.environment.waterLevel=s.y+.09;const y=s.y;stepDive(s,{},FIXED_STEP,world);assert.equal(s.movementMode,'swim');assert.equal(s.y,y);
 world.environment.waterLevel=s.y-.04;stepDive(s,{},FIXED_STEP,world);assert.equal(s.movementMode,'swim');assert.equal(s.inAir,true);
 world.environment.waterLevel=s.y-.09;stepDive(s,{},FIXED_STEP,world);assert.equal(s.movementMode,'walk');
});

test('complete drain and fill cycles never snap the head or lose first-person swimming',()=>{
 const world=room({waterLevel:CEILING-.2}),s=diver({y:FLOOR+3.4});let maxDelta=0,seenWalk=false,seenSwim=false;
 for(let n=0;n<1800;n++){
  world.environment.waterLevel=n<900?CEILING-.2-4.75*n/899:FLOOR+.05+4.75*(n-900)/899;
  const y=s.y;stepDive(s,{},FIXED_STEP,world);maxDelta=Math.max(maxDelta,Math.abs(s.y-y));
  if(s.movementMode==='walk')seenWalk=true;else if(seenWalk)seenSwim=true;
 }
 assert.ok(seenWalk&&seenSwim);assert.ok(maxDelta<.12,`largest head displacement ${maxDelta}`);assert.equal(s.movementMode,'swim');near(s.eyeHeight,LIMITS.radius);
 const y=s.y;advance(s,world,.25,{up:1,forward:1});assert.ok(s.y>y+.2);assert.ok(s.z<-.2);
});

test('oxygen and healing depend on actual dry head position, independent from mode hysteresis',()=>{
 const world=room(),s=standing(world);s.oxygen=40;s.health=60;
 world.environment.waterLevel=s.y-.02;stepDive(s,{},FIXED_STEP,world);assert.equal(s.inAir,true);assert.ok(s.oxygen>40&&s.health>60);
 const oxygen=s.oxygen;world.environment.waterLevel=s.y+.02;stepDive(s,{},FIXED_STEP,world);assert.equal(s.movementMode,'walk');assert.equal(s.inAir,false);assert.ok(s.oxygen<oxygen);
 // Indoors never borrows the ocean's global surface test while its head is wet.
 const raised=room({floorY:18,ceilingY:23,waterLevel:22.8}),high=diver({y:20,oxygen:40});stepDive(high,{},FIXED_STEP,raised);assert.equal(high.inAir,false);assert.ok(high.oxygen<40);
 const submerged=diver({y:-38,oxygen:40});advance(submerged,{...ocean(),sampleEnvironment:()=>null},.2);assert.equal(submerged.inAir,false);assert.ok(submerged.oxygen<40);
});

test('solid walls block dry and flooded rooms while preserving tangential sliding and idle rest',()=>{
 for(const flooded of [false,true]){
  const world=room({waterLevel:flooded?CEILING-.2:FLOOR-1});world.boxColliders=[wall];
  const s=standing(world);advance(s,world,2,{right:1});near(s.x,wall.minX-LIMITS.radius);assert.equal(s.vx,0);
  const z=s.z;advance(s,world,1,{right:1,forward:1});near(s.x,wall.minX-LIMITS.radius);assert.ok(s.z<z-1);assert.equal(s.vx,0);assert.ok(s.vz<0);
  advance(s,world,1);assertRest(s,world);
 }
});

test('thin enabled doors are swept even at high incoming speed and open leaves allow passage',()=>{
 const world=room();world.boxColliders=[{...wall}];const s=standing(world);
 s.vx=600;stepDive(s,{right:1},.05,world);near(s.x,wall.minX-LIMITS.radius);assert.equal(s.vx,0);
 world.boxColliders[0].enabled=false;advance(s,world,2,{right:1});assert.ok(s.x>wall.maxX+1);
 // Negative direction and perpendicular doors have the same swept contract.
 const other=standing(world,{x:6});world.boxColliders[0].enabled=true;other.vx=-600;stepDive(other,{left:1},.05,world);near(other.x,wall.maxX+LIMITS.radius);
 const zWorld=room();zWorld.boxColliders=[{minX:-10,maxX:10,minY:FLOOR,maxY:CEILING,minZ:-2.03,maxZ:-2}];const z=standing(zWorld);z.vz=-600;stepDive(z,{forward:1},.05,zWorld);near(z.z,-2+LIMITS.radius);
});

test('vertical sweeps block both faces of horizontal slabs and room ceilings',()=>{
 const world=room({floorY:-60,waterLevel:-1}),slab={minX:-8,maxX:8,minY:-42.1,maxY:-42,minZ:-8,maxZ:8};world.boxColliders=[slab];
 const below=diver({y:-45,vy:600});stepDive(below,{up:1},.05,world);near(below.y,slab.minY-LIMITS.radius);assert.equal(below.vy,0);assertRest(below,world);
 const above=diver({y:-39,vy:-600});stepDive(above,{down:1},.05,world);near(above.y,slab.maxY+LIMITS.radius);assert.equal(above.vy,0);assertRest(above,world);
 const ceiling=diver({y:-39});advance(ceiling,world,3,{up:1,sprint:1});near(ceiling.y,CEILING-LIMITS.radius);assert.equal(ceiling.vy,0);assertRest(ceiling,world);
});

test('a dry head striking a ceiling never becomes grounded or sticks in midair',()=>{
 const world=room(),s=diver({y:CEILING-1,vy:8});world.boxColliders=[{minX:-8,maxX:8,minY:CEILING-.1,maxY:CEILING,minZ:-8,maxZ:8}];
 let hit=false;
 for(let n=0;n<90;n++){stepDive(s,{},FIXED_STEP,world);if(s.vy===0&&s.y>FLOOR+2){hit=true;assert.equal(s.grounded,false);break;}}
 assert.ok(hit);const y=s.y;stepDive(s,{},FIXED_STEP,world);assert.ok(s.vy<0&&s.y<y);advance(s,world,2);assert.equal(s.grounded,true);assertRest(s,world);
});

test('standing clearance respects a low ceiling and expands after entering a taller room',()=>{
 const world=room({ceilingY:FLOOR+1.45}),s=standing(world);
 assert.ok(s.eyeHeight<1);near(s.y+LIMITS.radius-.4*(s.eyeHeight-LIMITS.radius),world.environment.ceilingY);assertRest(s,world);
 world.environment.ceilingY=CEILING;const y=s.y;stepDive(s,{},FIXED_STEP,world);assert.ok(s.y-y<=INTERIOR_MOTION.stanceRate*FIXED_STEP+1e-9);advance(s,world,1);near(s.eyeHeight,1.65);assertRest(s,world);
});

test('ascending and descending ramps remain grounded without pitch coupling or idle drift',()=>{
 const world=room();world.sampleEnvironment=s=>({...world.environment,floorY:FLOOR+s.x*.2,ceilingY:CEILING+s.x*.2});
 const s=standing(world,{pitch:1.2});let last=s.y;
 for(let n=0;n<180;n++){stepDive(s,{right:1},FIXED_STEP,world);assert.equal(s.grounded,true);near(s.y,FLOOR+s.x*.2+s.eyeHeight);assert.ok(Math.abs(s.y-last)<.02);last=s.y;}
 advance(s,world,1);assertRest(s,world);advance(s,world,2,{left:1});near(s.y,FLOOR+s.x*.2+s.eyeHeight);advance(s,world,1);assertRest(s,world);
});

test('a dry ledge falls under gravity and an unwalkable floor rise blocks entry',()=>{
 const world=room({waterLevel:FLOOR-10});world.sampleEnvironment=s=>({...world.environment,floorY:s.x>1?FLOOR-4:FLOOR});
 const s=standing(world);let airborne=false;for(let n=0;n<180;n++){stepDive(s,{right:1,up:1},FIXED_STEP,world);if(s.x>1&&!s.grounded){airborne=true;assert.ok(s.vy<0);}}
 assert.ok(airborne);near(s.y,FLOOR-4+s.eyeHeight);assert.equal(s.grounded,true);advance(s,world,1);assertRest(s,world);
 const wallWorld=room();wallWorld.sampleEnvironment=s=>({...wallWorld.environment,floorY:s.x>1?FLOOR+2:FLOOR});const blocked=standing(wallWorld);advance(blocked,wallWorld,2,{right:1});assert.ok(blocked.x<=1);near(blocked.y,FLOOR+1.65);
});

test('leaving the enclosure immediately restores ocean air and swim state without a camera jump',()=>{
 const world=room();world.sampleEnvironment=s=>s.x<1?world.environment:null;
 const s=standing(world);s.oxygen=50;let crossed=false;
 for(let n=0;n<90;n++){const y=s.y;stepDive(s,{right:1},FIXED_STEP,world);if(s.x>=1){assert.equal(s.movementMode,'swim');assert.equal(s.inAir,false);assert.ok(Math.abs(s.y-y)<.05);crossed=true;}}
 assert.ok(crossed);near(s.eyeHeight,LIMITS.radius);const y=s.y;advance(s,world,.5,{up:1});assert.ok(s.y>y+1);
});

test('gravity is finite, settles on box platforms, and dry up/down keys cannot hover',()=>{
 const world=room({floorY:-50,ceilingY:-30});world.boxColliders=[{minX:-3,maxX:3,minY:-43,maxY:-42,minZ:-3,maxZ:3}];
 const s=diver({y:-34});stepDive(s,{up:1},FIXED_STEP,world);assert.ok(s.vy<0);advance(s,world,3,{up:1});near(s.y,-42+s.eyeHeight);assert.equal(s.grounded,true);assertRest(s,world);
});

test('new overlapping barrier recovers once to a clear contact and does not creep',()=>{
 const world=room(),s=standing(world);world.boxColliders=[{minX:.3,maxX:.4,minY:FLOOR,maxY:CEILING,minZ:-3,maxZ:3}];
 stepDive(s,{},FIXED_STEP,world);near(s.x,.3-LIMITS.radius);assertRest(s,world);
});

test('optional larger bounds extend the route and all boundaries stop outward velocity',()=>{
 const world={...ocean(),bounds:{minX:-320,maxX:320,minZ:-420,maxZ:95}},s=diver({x:319.9,z:-419.9,y:-40});
 advance(s,world,2,{right:1,forward:1});assert.equal(s.x,320);assert.equal(s.z,-420);assertRest(s,world);
 Object.assign(s,{x:-319.9,z:94.9});advance(s,world,2,{left:1,back:1});assert.equal(s.x,-320);assert.equal(s.z,95);assertRest(s,world);
 const saved=diver();restoreProgress(saved,{version:1,banked:['glass'],deepest:180});assert.equal(saved.deepest,180);assert.equal(serializableProgress(saved).deepest,180);restoreProgress(saved,{version:1,banked:[],deepest:900});assert.equal(saved.deepest,250);
});

test('pause freezes all new fields; clear, rescue and restart retain established objective semantics',()=>{
 const world=room(),s=standing(world);advance(s,world,.2,{forward:1});s.status='paused';const snapshot=structuredClone(s);advance(s,world,2,{right:1});assert.deepEqual(s,snapshot);
 s.status='playing';clearMotion(s);assert.deepEqual(velocity(s),[0,0,0]);assert.equal(s.sprinting,false);assert.equal(s.movementMode,'walk');
 s.scans=['glass','bell'];s.banked=['glass'];recoverDiver(s);assert.equal(s.movementMode,'swim');assert.equal(s.grounded,false);assert.equal(s.eyeHeight,LIMITS.radius);assert.equal(s.inAir,true);assert.deepEqual(s.scans,['glass']);assert.deepEqual(s.banked,['glass']);assert.deepEqual(velocity(s),[0,0,0]);
 Object.assign(s,{movementMode:'walk',eyeHeight:1.65,grounded:true});startDive(s);assert.equal(s.movementMode,'swim');assert.equal(s.eyeHeight,LIMITS.radius);assert.equal(s.grounded,false);assert.deepEqual(s.banked,[]);
});

test('interior movement, flooding and collision agree at 30/60/120Hz fixed-step rendering',()=>{
 const run=hz=>{
  const world=room();world.boxColliders=[wall];const s=diver();let accumulator=0,tick=0;
  for(let frame=0;frame<hz*12;frame++){
   accumulator+=1/hz;
   while(accumulator+1e-12>=FIXED_STEP){
    world.environment.waterLevel=tick<360?FLOOR-1:tick<720?CEILING-.2:FLOOR-1;
    const input=tick<240?{right:1,forward:.2,sprint:1}:tick<600?{up:1,left:.4}:tick<810?{forward:1}:{};
    stepDive(s,input,FIXED_STEP,world);accumulator-=FIXED_STEP;tick++;
   }
  }
  assert.equal(tick,1080);return s;
 };
 assert.deepEqual(run(30),run(60));assert.deepEqual(run(60),run(120));
});

test('optional bounds and distant rig boxes preserve the exact ocean surface head ceiling',()=>{
 for(const extras of [{bounds:{minX:-320,maxX:320}},{boxColliders:[{...wall,minX:150,maxX:151}]},{bounds:{minX:-320,maxX:320},sampleEnvironment:()=>null}]){
  const world={...ocean(),...extras},s=diver({y:-2});advance(s,world,3,{up:1,sprint:1});assert.equal(s.y,.5);assert.equal(s.vy,0);assertRest(s,world);
 }
});

test('zero/negative steps freeze and long frames retain the .05-second cap indoors',()=>{
 const world=room(),s=diver(),snapshot=structuredClone(s);stepDive(s,{right:1},0,world);stepDive(s,{right:1},-1,world);assert.deepEqual(s,snapshot);
 const a=diver(),b=diver();stepDive(a,{right:1},5,world);stepDive(b,{right:1},.05,world);assert.deepEqual(a,b);
});
