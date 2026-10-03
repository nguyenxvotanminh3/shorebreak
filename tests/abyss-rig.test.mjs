// Numerical integration and scene-resource tests, NOT GPU/rendered visual QA.
// Traversal uses the real manifest boxes and the real fixed 90 Hz player sim.
// Only initial spawns are positioned directly; movement and looking use inputs.
// GLB tests retain real geometry but omit bitmap decoding under Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createDeepRig } from '../dist/abyss-rig.js';
import { RIG_LAYOUT } from '../dist/abyss-rig-layout.js';
import { WET_LOCK } from '../dist/abyss-airlock.js';
import { RIG_SITE, DEEP_BOUNDS } from '../dist/abyss-deep-zone.js';
import { terrainHeight } from '../dist/abyss-world.js';
import { createDive, stepDive, startDive, recoverDiver, FIXED_STEP, LIMITS, INTERIOR_MOTION, LANDMARKS } from '../dist/abyss-sim.js';

const EPS=1e-7, terrain=terrainHeight;
const near=(a,b,epsilon=EPS)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
const headTop=eye=>LIMITS.radius-.4*(eye-LIMITS.radius);
function overlap(p,b){const e=1e-7;return p.x>b.minX-LIMITS.radius+e&&p.x<b.maxX+LIMITS.radius-e&&p.z>b.minZ-LIMITS.radius+e&&p.z<b.maxZ+LIMITS.radius-e&&p.y>b.minY-headTop(p.eyeHeight)+e&&p.y<b.maxY+p.eyeHeight-e;}
function syntheticModel(){
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();material.map=texture;
 for(const [name,d]of Object.entries(RIG_LAYOUT.doorNodes)){const node=new THREE.Group();node.name=name;node.position.set(...d.position);const mesh=new THREE.Mesh(geometry,material);mesh.name='DoorLeaf';node.add(mesh);root.add(node);}
 const shell=new THREE.Mesh(geometry,material);shell.name='InteriorShell';root.add(shell);
 const released={geometry:0,material:0,texture:0};for(const [key,res]of Object.entries({geometry,material,texture}))res.addEventListener('dispose',()=>released[key]++);
 return{root,released};
}
function harness({oxygen=LIMITS.oxygen,loader,site=RIG_SITE,onAsset}={}){
 const scene=new THREE.Scene(),models=[];
 const rig=createDeepRig(scene,{terrain,site,loader:loader||{loadAsync:async()=>{const m=syntheticModel();models.push(m);return{scene:m.root};}},onAsset});
 const p=Object.assign(createDive(),{status:'playing',x:rig.entryPosition.x,y:rig.entryPosition.y,z:rig.entryPosition.z,yaw:0,pitch:0,oxygen});
 const world={terrain,boxColliders:rig.boxColliders,sampleEnvironment:rig.sampleEnvironment,bounds:DEEP_BOUNDS,colliders:[],threats:[],locations:[]};
 const history={ticks:0,maxDisplacement:0,maxHeadDelta:0,maxStanceDelta:0,rooms:new Set(),modes:new Set(),phases:new Set(),dryTicks:0,wetTicks:0,refills:0};
 function tick(input={},dt=FIXED_STEP){
  const before={x:p.x,y:p.y,z:p.z,eye:p.eyeHeight,oxygen:p.oxygen,rescues:p.rescues};
  rig.step(dt,p);stepDive(p,input,dt,world);rig.update(dt,p.time,p,'medium');
  const s=rig.lock.state;assert.ok(s.outerOpen===0||s.innerOpen===0,'airlock leaves never open simultaneously');
  if(s.outerOpen>0)near(s.waterLevel,WET_LOCK.flooded);if(s.innerOpen>0)near(s.waterLevel,WET_LOCK.drained);
  if(['draining','filling','equalizing'].includes(s.phase)){near(s.outerOpen,0);near(s.innerOpen,0);}
  assert.equal(p.rescues,before.rescues,'ordinary traversal must not secretly rescue/teleport');
  assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz,p.eyeHeight,p.oxygen].every(Number.isFinite));
  const penetrations=rig.boxColliders.filter(b=>b.enabled!==false&&overlap(p,b));assert.equal(penetrations.length,0,`body intersects ${penetrations.map(b=>b.name)} at ${JSON.stringify(local())}`);
  history.maxDisplacement=Math.max(history.maxDisplacement,Math.hypot(p.x-before.x,p.y-before.y,p.z-before.z));history.maxHeadDelta=Math.max(history.maxHeadDelta,Math.abs(p.y-before.y));history.maxStanceDelta=Math.max(history.maxStanceDelta,Math.abs(p.eyeHeight-before.eye));
  const env=rig.sampleEnvironment(p);if(env)history.rooms.add(env.room);history.modes.add(p.movementMode);history.phases.add(s.phase);history.ticks++;
  if(p.inAir){history.dryTicks++;if(p.oxygen>before.oxygen)history.refills++;assert.ok(p.y>(env?.waterLevel??-1.1),'refill requires a genuinely dry head');}
  else{history.wetTicks++;assert.ok(p.oxygen<=before.oxygen+EPS,'submerged heads cannot refill');}
  return s;
 }
 function local(){return{x:p.x-rig.root.position.x,y:p.y-rig.root.position.y,z:p.z-rig.root.position.z};}
 function run(seconds,input={}){for(let n=0;n<Math.ceil(seconds/FIXED_STEP);n++)tick(input);}
 function look(yaw,pitch=0){for(let n=0;n<900;n++){const dy=angle(yaw-p.yaw),dp=pitch-p.pitch;if(Math.abs(dy)<.001&&Math.abs(dp)<.001)return;tick({turn:clamp(dy/(FIXED_STEP*1.45),-1,1),tilt:clamp(dp/(FIXED_STEP*1.05),-1,1)});}assert.fail('look input did not converge');}
 function go(x,z,{seconds=30,tolerance=.025}={}){
  look(0,0);let best=Infinity,stalled=0;
  for(let n=0;n<seconds/FIXED_STEP;n++){
   const q=local(),dx=x-q.x,dz=z-q.z,d=Math.hypot(dx,dz);
   if(d<tolerance&&Math.hypot(p.vx,p.vz)<.05){run(.35);assert.ok(Math.hypot(local().x-x,local().z-z)<tolerance*2);return;}
   if(d<best-.002){best=d;stalled=0;}else stalled++;
   if(stalled>360)assert.fail(`ordinary movement blocked en route to (${x}, ${z}); reached ${JSON.stringify(q)}, room=${rig.sampleEnvironment(p)?.room}, phase=${rig.lock.state.phase}`);
   const strength=Math.min(1,d*1.7),right=d?dx/d*strength:0,forward=d?-dz/d*strength:0;tick({right,forward});
  }
  assert.fail(`route did not reach (${x}, ${z}) from ${JSON.stringify(local())}`);
 }
 function press(id){
  const target=RIG_LAYOUT.interactionAnchors[id];assert.ok(target,id);const q=local(),dx=target.position[0]-q.x,dy=target.position[1]-q.y,dz=target.position[2]-q.z;
  look(Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)));
  assert.equal(rig.getInteraction(p)?.id,id,'look/range selects the intended physical panel');const result=rig.interact(p);assert.ok(result);return result;
 }
 function finish(side){for(let n=0;n<1800&&rig.lock.state.phase!==`${side}-open`;n++)tick();assert.equal(rig.lock.state.phase,`${side}-open`);run(.5);}
 function enter(){go(0,39);assert.equal(rig.sampleEnvironment(p)?.room,'wet-lock');assert.equal(p.movementMode,'swim');assert.ok(press('rig_panel_lock_inner').accepted);finish('habitat');assert.equal(p.movementMode,'walk');near(p.eyeHeight,INTERIOR_MOTION.eyeHeight);}
 return{scene,rig,p,world,models,history,tick,run,go,look,press,finish,enter,local};
}

test('manifest rooms, four door leaves and colliders use the shared terrain origin',()=>{
 const h=harness();try{
  assert.deepEqual(h.rig.root.position.toArray(),[RIG_SITE.x,terrain(RIG_SITE.x,RIG_SITE.z),RIG_SITE.z]);assert.equal(h.rig.boxColliders.length,RIG_LAYOUT.collisionBoxes.length+4);
  RIG_LAYOUT.collisionBoxes.forEach((b,i)=>{const actual=h.rig.boxColliders[i];for(const [axis,k]of [['X',0],['Y',1],['Z',2]]){near(actual['min'+axis],h.rig.root.position.getComponent(k)+b.center[k]-b.size[k]/2);near(actual['max'+axis],h.rig.root.position.getComponent(k)+b.center[k]+b.size[k]/2);}});
  assert.deepEqual(RIG_LAYOUT.rooms.map(r=>r.name),['wet-lock','vestibule','corridor','control','machinery']);assert.equal(h.rig.sampleEnvironment(h.p),null);assert.equal(h.rig.lock.state.phase,'sea-open');
  assert.equal(h.rig.getInteraction(h.p),null);assert.equal(h.rig.interact(h.p),null);
 }finally{h.rig.dispose();}
});

test('ordinary 90Hz input enters, drains, walks around the console into machinery and swims back out twice',t=>{
 const h=harness({oxygen:40});try{
  for(let trip=0;trip<2;trip++){
   const wetOxygen=h.p.oxygen;h.enter();assert.ok(h.history.wetTicks>0);assert.ok(h.history.refills>0);
   for(const waypoint of RIG_LAYOUT.safePath.slice(2))h.go(waypoint[0],waypoint[2]);
   assert.equal(h.rig.sampleEnvironment(h.p)?.room,'machinery');assert.equal(h.p.movementMode,'walk');assert.equal(h.p.grounded,true);
   const idle={x:h.p.x,y:h.p.y,z:h.p.z};h.run(2);assert.deepEqual({x:h.p.x,y:h.p.y,z:h.p.z},idle,'rest must be exactly stable');
   for(const waypoint of RIG_LAYOUT.safePath.slice(1,-1).reverse())h.go(waypoint[0],waypoint[2]);
   assert.equal(h.rig.sampleEnvironment(h.p)?.room,'wet-lock');assert.ok(h.press('rig_panel_lock_outer').accepted);h.finish('sea');
   assert.equal(h.p.movementMode,'swim');near(h.p.eyeHeight,LIMITS.radius);assert.equal(h.p.inAir,false);
   h.go(RIG_LAYOUT.safePath[0][0],RIG_LAYOUT.safePath[0][2]);assert.equal(h.rig.sampleEnvironment(h.p),null);
   assert.ok(h.p.oxygen>0);if(!trip)assert.ok(h.p.oxygen>wetOxygen,'the dry habitat restores low oxygen');
  }
  assert.deepEqual([...h.history.rooms].sort(),['control','corridor','machinery','vestibule','wet-lock']);assert.deepEqual([...h.history.modes].sort(),['swim','walk']);
  for(const phase of ['closing','draining','equalizing','opening','habitat-open','filling','sea-open'])assert.ok(h.history.phases.has(phase),phase);
  assert.ok(h.history.maxDisplacement<.13,`camera step displacement=${h.history.maxDisplacement}`);assert.ok(h.history.maxHeadDelta<.12,`head step displacement=${h.history.maxHeadDelta}`);assert.ok(h.history.maxStanceDelta<=INTERIOR_MOTION.stanceRate*FIXED_STEP+EPS);t.diagnostic(`Two ordinary-input trips: ${h.history.ticks} fixed steps; max camera step ${h.history.maxDisplacement.toFixed(6)}m, max vertical step ${h.history.maxHeadDelta.toFixed(6)}m; ${h.history.refills} genuine dry-head refill ticks`);
 }finally{h.rig.dispose();}
});

test('real chamber thresholds reverse a closing outer leaf, block transfer, then resume after retreat',()=>{
 const h=harness();try{
  h.go(0,39.7);assert.ok(h.press('rig_panel_lock_inner').accepted);let sawClosing=false,sawReopen=false,last=h.rig.lock.state.outerOpen;
  for(let i=0;i<100;i++){
   const s=h.tick({forward:-Math.cos(h.p.yaw),right:-Math.sin(h.p.yaw)});if(s.outerOpen<last-EPS)sawClosing=true;if(s.blocked==='outer'&&s.outerOpen>last+EPS)sawReopen=true;last=s.outerOpen;if(h.local().z>41.25)break;
  }
  h.run(1);assert.ok(sawClosing,'door actually began closing');assert.ok(sawReopen,'physical sensor reversed closing');assert.equal(h.rig.lock.state.blocked,'outer');near(h.rig.lock.state.outerOpen,1);near(h.rig.lock.state.waterLevel,WET_LOCK.flooded);
  h.go(0,39);h.finish('habitat');assert.equal(h.p.movementMode,'walk');
 }finally{h.rig.dispose();}
});

test('real dry inner threshold reopens when obstructed and filling resumes only after retreat',()=>{
 const h=harness();try{
  h.enter();h.go(.6,36.7);assert.ok(h.press('rig_panel_lock_outer').accepted);let sawClosing=false,sawReopen=false,last=h.rig.lock.state.innerOpen;
  for(let i=0;i<160;i++){
   const s=h.tick({forward:Math.cos(h.p.yaw),right:Math.sin(h.p.yaw)});if(s.innerOpen<last-EPS)sawClosing=true;if(s.blocked==='inner'&&s.innerOpen>last+EPS)sawReopen=true;last=s.innerOpen;if(h.local().z<35.7)break;
  }
  h.run(1);assert.ok(sawClosing);assert.ok(sawReopen);assert.equal(h.rig.lock.state.blocked,'inner');near(h.rig.lock.state.innerOpen,1);near(h.rig.lock.state.waterLevel,WET_LOCK.drained);
  h.go(0,39);h.finish('sea');assert.equal(h.p.movementMode,'swim');
 }finally{h.rig.dispose();}
});

test('closed inner door and chart console are actual collision barriers, not camera-only scenery',()=>{
 const h=harness();try{
  h.go(0,39);h.look(0,0);h.run(2,{forward:1});h.run(.5);near(h.p.z,h.rig.boxColliders.find(b=>b.name==='rig_inner_door_L').maxZ+LIMITS.radius);assert.equal(h.rig.sampleEnvironment(h.p)?.room,'wet-lock');
  h.go(0,39);h.press('rig_panel_lock_inner');h.finish('habitat');h.go(0,8);h.look(0,0);h.run(2,{forward:1});h.run(.5);near(h.local().z,6.9);near(h.local().x,0);assert.equal(h.p.grounded,true);const contact=h.local();h.run(2);assert.deepEqual(h.local(),contact);
  h.go(0,8);h.go(3.2,8);h.go(6,4);assert.equal(h.rig.sampleEnvironment(h.p)?.room,'control');
 }finally{h.rig.dispose();}
});

test('repeated E on physical panels is idempotent and opposite requests cannot interrupt a busy cycle',()=>{
 const h=harness();try{
  h.go(0,39);assert.ok(h.press('rig_panel_lock_inner').accepted);const snapshot=h.rig.lock.snapshot();for(let i=0;i<80;i++)assert.equal(h.rig.interact(h.p).accepted,true);assert.deepEqual(h.rig.lock.snapshot(),snapshot);
  assert.equal(h.press('rig_panel_lock_outer').accepted,false);assert.equal(h.rig.lock.state.target,'habitat');h.finish('habitat');
  assert.ok(h.press('rig_panel_lock_outer').accepted);const outgoing=h.rig.lock.snapshot();for(let i=0;i<80;i++)assert.equal(h.rig.interact(h.p).accepted,true);assert.deepEqual(h.rig.lock.snapshot(),outgoing);assert.equal(h.press('rig_panel_lock_inner').accepted,false);h.finish('sea');
 }finally{h.rig.dispose();}
});

test('zero-time rig updates and paused player simulation freeze the in-progress chamber and camera',()=>{
 const h=harness();try{
  h.go(0,39);h.press('rig_panel_lock_inner');h.run(2.5);assert.equal(h.rig.lock.state.phase,'draining');h.p.status='paused';const lock=h.rig.lock.snapshot(),p=structuredClone(h.p);
  // Runtime pause contract passes zero rig delta and does not advance its clock.
  for(let i=0;i<300;i++){h.rig.step(0,h.p);stepDive(h.p,{forward:1,up:1},FIXED_STEP,h.world);h.rig.update(0,h.p.time,h.p,'low');}
  assert.deepEqual(h.p,p);assert.deepEqual(h.rig.lock.snapshot(),lock);h.p.status='playing';h.finish('habitat');
 }finally{h.rig.dispose();}
});

test('rescue recovery returns a partial transfer safely and reset restores a fresh sea-side session',()=>{
 const h=harness();try{
  h.go(0,39);h.press('rig_panel_lock_inner');h.run(2.5);assert.equal(h.rig.lock.state.phase,'draining');const water=h.rig.lock.state.waterLevel;
  assert.equal(h.rig.recover(h.p),true);near(h.rig.lock.state.waterLevel,water);h.finish('sea');
  h.p.scans=['glass','bell'];h.p.banked=['glass'];recoverDiver(h.p);h.rig.recover(h.p);assert.deepEqual(h.p.scans,['glass']);assert.deepEqual(h.p.banked,['glass']);assert.equal(h.p.rescues,1);assert.equal(h.p.movementMode,'swim');
  h.rig.reset();startDive(h.p);assert.equal(h.rig.lock.state.phase,'sea-open');near(h.rig.lock.state.waterLevel,WET_LOCK.flooded);assert.deepEqual(h.p.banked,[]);assert.equal(h.p.rescues,0);assert.deepEqual(LANDMARKS.map(p=>p.id),['glass','bell','rift']);
 }finally{h.rig.dispose();}
});

test('fresh full/medium/far scenes load once, share door fractions and dispose every shared resource once',async()=>{
 const events=[],h=harness({onAsset:event=>events.push(event)});try{
  h.rig.update(FIXED_STEP,1,h.p,'high');await flush();h.rig.update(FIXED_STEP,2,h.p,'high');
  assert.equal(h.models.length,3);assert.equal(events.length,3);assert.deepEqual(h.rig.snapshot().assets,{full:'ready',medium:'ready',far:'ready'});assert.equal(h.rig.snapshot().selected,'full');
  h.go(0,39);h.press('rig_panel_lock_inner');
  for(let n=0;n<800;n++){
   h.tick();const state=h.rig.lock.state;
   for(const model of h.models)for(const [name,d]of Object.entries(RIG_LAYOUT.doorNodes)){const node=model.root.getObjectByName(name),fraction=name.includes('outer')?state.outerOpen:state.innerOpen;for(let i=0;i<3;i++)near(node.position.getComponent(i),d.position[i]+d.openVector[i]*fraction);}
  }
  assert.equal(h.models.length,3);const root=h.rig.root;h.rig.dispose();h.rig.dispose();assert.equal(h.scene.children.includes(root),false);assert.equal(root.children.length,0);assert.equal(h.rig.boxColliders.length,0);for(const m of h.models)assert.deepEqual(m.released,{geometry:1,material:1,texture:1});
 }finally{h.rig.dispose();}
});

test('Low and Medium retain their selected interior LOD without unexpectedly loading Full',async()=>{
 const h=harness();try{
  h.enter();await flush();for(const quality of ['low','medium']){h.rig.update(0,h.p.time,h.p,quality);assert.equal(h.rig.snapshot().selected,'medium');assert.equal(h.rig.snapshot().assets.full,'idle');assert.equal(h.models.length,2);}
  h.rig.update(FIXED_STEP,h.p.time,h.p,'high');await flush();h.rig.update(0,h.p.time,h.p,'high');assert.equal(h.rig.snapshot().selected,'full');assert.equal(h.models.length,3);
  h.rig.update(0,h.p.time,h.p,'low');assert.equal(h.rig.snapshot().selected,'medium');assert.equal(h.models.filter(m=>m.root.visible).length,1);
 }finally{h.rig.dispose();}
});

test('asset failures preserve the physical fallback and pending results after disposal are released',async()=>{
 const events=[],failed=harness({loader:{loadAsync:async()=>{throw new Error('fixture asset failure');}},onAsset:event=>events.push(event)});
 failed.rig.update(FIXED_STEP,1,failed.p,'high');await flush();failed.rig.update(0,1,failed.p,'high');assert.deepEqual(failed.rig.snapshot().assets,{full:'error',medium:'error',far:'error'});assert.equal(events.length,3);assert.ok(events.every(e=>e.status==='error'));assert.equal(failed.rig.snapshot().selected,'none');assert.equal(failed.rig.root.getObjectByName('Rig load fallback / real collision envelope').visible,true);failed.enter();failed.rig.dispose();
 const pending=[],late=harness({loader:{loadAsync:()=>new Promise(resolve=>pending.push(resolve))}});late.rig.update(FIXED_STEP,1,late.p,'high');assert.equal(pending.length,3);late.rig.dispose();const models=pending.map(resolve=>{const m=syntheticModel();resolve({scene:m.root});return m;});await flush();assert.equal(late.scene.children.length,0);for(const m of models)assert.deepEqual(m.released,{geometry:1,material:1,texture:1});
});

globalThis.ProgressEvent ||= class ProgressEvent extends Event{constructor(type,init={}){super(type);Object.assign(this,init);}};
async function realModel(tier){
 const raw=await readFile(new URL(`../dist/assets/abyss/rig/rig-${tier}.glb`,import.meta.url));assert.equal(raw.readUInt32LE(0),0x46546c67);assert.equal(raw.readUInt32LE(4),2);assert.equal(raw.readUInt32LE(8),raw.length);
 const length=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+length)),at=20+length,bin=raw.subarray(at+8,at+8+raw.readUInt32LE(at));for(const view of doc.bufferViews||[])assert.ok((view.byteOffset||0)+view.byteLength<=bin.length);
 for(const image of doc.images||[])assert.ok(Number.isInteger(image.bufferView)&&!image.uri,'textures are embedded');
 doc.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');doc.materials=(doc.materials||[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor,metallicFactor:m.pbrMetallicRoughness?.metallicFactor,roughnessFactor:m.pbrMetallicRoughness?.roughnessFactor}}));delete doc.images;delete doc.textures;delete doc.samplers;
 return(await new GLTFLoader().parseAsync(JSON.stringify(doc),'')).scene;
}
for(const tier of ['full','medium','far'])test(`actual ${tier} GLB door geometry matches its physical manifest before and after sliding`,async()=>{
 const model=await realModel(tier);try{
  model.updateMatrixWorld(true);assert.ok(!new THREE.Box3().setFromObject(model).isEmpty());
  for(const [name,d]of Object.entries(RIG_LAYOUT.doorNodes)){
   const node=model.getObjectByName(name);assert.ok(node,`${tier} missing ${name}`);for(let axis=0;axis<3;axis++)near(node.position.getComponent(axis),d.position[axis],.003);
   const closed=new THREE.Box3().setFromObject(node);
   for(let axis=0;axis<3;axis++){assert.ok(closed.min.getComponent(axis)>=d.closedBounds.min[axis]-.003,'visual leaf is contained by its conservative collision minimum');assert.ok(closed.max.getComponent(axis)<=d.closedBounds.max[axis]+.003,'visual leaf is contained by its conservative collision maximum');const padding=axis===2?.25:.025;near(closed.min.getComponent(axis),d.closedBounds.min[axis],padding);near(closed.max.getComponent(axis),d.closedBounds.max[axis],padding);}
   for(const fraction of [0,.5,1]){
    node.position.set(...d.position).addScaledVector(new THREE.Vector3(...d.openVector),fraction);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(node);assert.ok(!bounds.isEmpty(),name);
    for(let axis=0;axis<3;axis++){near(bounds.min.getComponent(axis),closed.min.getComponent(axis)+d.openVector[axis]*fraction,.003);near(bounds.max.getComponent(axis),closed.max.getComponent(axis)+d.openVector[axis]*fraction,.003);}
   }
  }
 }finally{const geometries=new Set(),materials=new Set();model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
});


test('actual GLB-loaded rig preserves the full physical traversal and world-space door envelopes',async()=>{
 const loads=[],h=harness({loader:{loadAsync:url=>{const tier=/rig-(full|medium|far)\.glb$/.exec(url)?.[1];assert.ok(tier,url);const promise=realModel(tier).then(scene=>({scene}));loads.push(promise);return promise;}}});
 try{
  h.rig.update(FIXED_STEP,0,h.p,'high');await Promise.all(loads);await flush();assert.equal(loads.length,3);
  h.enter();for(const waypoint of RIG_LAYOUT.safePath.slice(2))h.go(waypoint[0],waypoint[2]);assert.equal(h.rig.sampleEnvironment(h.p)?.room,'machinery');
  for(const waypoint of RIG_LAYOUT.safePath.slice(1,-1).reverse())h.go(waypoint[0],waypoint[2]);h.press('rig_panel_lock_outer');
  for(let tick=0;tick<850;tick++){
   h.tick();if(tick%30!==0)continue;h.rig.root.updateMatrixWorld(true);
   for(const tier of ['full','medium','far']){const model=h.rig.root.getObjectByName('Rig07 '+tier);assert.ok(model);for(const name of Object.keys(RIG_LAYOUT.doorNodes)){const node=model.getObjectByName(name),box=h.rig.boxColliders.find(b=>b.name===name),visual=new THREE.Box3().setFromObject(node);for(const [axis,index]of [['X',0],['Y',1],['Z',2]]){assert.ok(visual.min.getComponent(index)>=box['min'+axis]-.003);assert.ok(visual.max.getComponent(index)<=box['max'+axis]+.003);}}}
  }
  assert.equal(h.rig.lock.state.phase,'sea-open');h.go(0,48);assert.equal(h.rig.sampleEnvironment(h.p),null);assert.equal(loads.length,3);assert.ok(h.history.maxDisplacement<.13);
 }finally{h.rig.dispose();}
});

test('outside and vestibule call panels are reachable by movement and reject looking away',()=>{
 const h=harness();try{
  h.go(-1.2,44.2);h.look(Math.PI);assert.equal(h.rig.getInteraction(h.p),null);assert.equal(h.rig.interact(h.p),null);
  const outside=h.press('rig_panel_outside');assert.equal(outside.accepted,true);assert.equal(outside.changed,false);assert.equal(h.rig.lock.state.phase,'sea-open');
  h.enter();h.go(0,32);assert.equal(h.rig.sampleEnvironment(h.p)?.room,'vestibule');const vestibule=h.press('rig_panel_vestibule');assert.equal(vestibule.accepted,true);assert.equal(vestibule.changed,false);assert.equal(h.rig.lock.state.phase,'habitat-open');
 }finally{h.rig.dispose();}
});

test('coupled rig and player state agree exactly under 30/60/120Hz rendering of 90Hz physics',()=>{
 const simulate=hz=>{
  const h=harness();try{
   h.go(0,39);h.press('rig_panel_lock_inner');let accumulator=0,tick=0;
   for(let frame=0;frame<12*hz;frame++){
    accumulator+=1/hz;
    while(accumulator+1e-12>=FIXED_STEP){h.tick(tick<720?{}:tick<990?{forward:1}:{});accumulator-=FIXED_STEP;tick++;}
   }
   assert.equal(tick,1080);assert.equal(h.rig.lock.state.phase,'habitat-open');return{player:structuredClone(h.p),lock:h.rig.lock.snapshot()};
  }finally{h.rig.dispose();}
 };
 assert.deepEqual(simulate(30),simulate(60));assert.deepEqual(simulate(60),simulate(120));
});

test('generated runtime manifest keeps the authored rooms, collision, panels and safe route unchanged',async()=>{
 const authored=JSON.parse(await readFile(new URL('../dist/assets/abyss/rig/rig-manifest.json',import.meta.url),'utf8'));
 for(const key of ['doorNodes','interactionAnchors','anchors','water','collisionBoxes','floors','rooms','doorOpenings','safePath'])assert.deepEqual(RIG_LAYOUT[key],authored[key],`manifest drift in ${key}`);
});
