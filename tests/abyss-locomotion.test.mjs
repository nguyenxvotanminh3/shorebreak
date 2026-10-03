import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { createCreatureLocomotion, CREATURE_STEP } from '../dist/abyss-locomotion.js';
import { createWardenMotion } from '../dist/abyss-warden-motion.js';
import { createAbyssLife } from '../dist/abyss-life.js';
const terrain=(x,z)=>-35+Math.sin(x*.02)*2+Math.cos(z*.03);
const player={x:100,y:-15,z:100};
const configs=[{id:'shark',radius:2.2,orbit:[28,7,22]},{id:'kraken',radius:5.3,orbit:[12,3,11]},{id:'warden',radius:8,orbit:[15,4,8]}];
const close=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('animal steering has bounded propulsion, joint phase, smooth state weights and a planted sentinel',()=>{
  for(const def of configs){
    const actor=createCreatureLocomotion(def,{x:0,y:-20,z:-50},terrain,[]),initial={...actor.state};
    const modes=new Set();let acceleration=0,maxTurn=0;
    for(let i=0;i<90*50;i++){
      const observer=i<90*18?player:{x:actor.state.x+7,y:actor.state.y,z:actor.state.z+7};
      actor.step(CREATURE_STEP,i/90,observer);const s=actor.state;
      for(const [key,value]of Object.entries(s))if(typeof value==='number')assert.ok(Number.isFinite(value),def.id+' '+key);
      close(s.cruiseWeight+s.accelerateWeight+s.turnWeight+s.reactWeight,1);
      for(const weight of ['cruiseWeight','accelerateWeight','turnWeight','reactWeight'])assert.ok(s[weight]>=0&&s[weight]<=1);
      assert.ok(s.x>=-204&&s.x<=204&&s.z>=-217&&s.z<=70);assert.ok(s.phase>=initial.phase);
      acceleration=Math.max(acceleration,Math.abs(s.acceleration));maxTurn=Math.max(maxTurn,Math.abs(s.turnRate));modes.add(s.mode);
    }
    assert.ok(modes.size>=2,def.id+' must have distinct passive/response states');
    if(def.id==='warden'){close(actor.state.x,initial.x);close(actor.state.z,initial.z);close(actor.state.speed,0);assert.ok(actor.state.alert>.3);}
    else{assert.ok(acceleration>.05);assert.ok(maxTurn>.025);assert.ok(actor.state.speed>0&&actor.state.speed<4);}
    const frozen=JSON.stringify(actor.state);actor.step(0,900,player);assert.equal(JSON.stringify(actor.state),frozen);
    actor.reset();assert.deepEqual(actor.state,initial);
  }
});

test('creature fixed-step motion agrees under 30/60/120Hz rendering and pulse drives kraken acceleration',()=>{
  const results=[];
  for(const hz of [30,60,120]){
    const actor=createCreatureLocomotion(configs[1],{x:0,y:-20,z:-50},terrain,[]);let accumulator=0,time=0,jetAcceleration=0,recoveryAcceleration=0,jetCount=0,recoveryCount=0;
    for(let frame=1;frame<=hz*12;frame++){
      accumulator+=1/hz;
      while(accumulator+1e-10>=CREATURE_STEP){time+=CREATURE_STEP;actor.step(CREATURE_STEP,time,player);accumulator=Math.max(0,accumulator-CREATURE_STEP);const s=actor.state;if(Math.sin(s.phase)>.8){jetAcceleration+=s.acceleration;jetCount++;}if(Math.sin(s.phase)<-.4){recoveryAcceleration+=s.acceleration;recoveryCount++;}}
    }
    assert.ok(jetAcceleration/jetCount>recoveryAcceleration/recoveryCount,'jet phase must accelerate relative to refill');results.push({...actor.state});
  }
  for(const result of results.slice(1))for(const key of ['x','y','z','heading','speed','phase','alert'])close(result[key],results[0][key],1e-8);
});

async function loadModel(name){
  globalThis.ProgressEvent ||= class ProgressEvent extends Event{constructor(type,init={}){super(type);Object.assign(this,init);}};
  const raw=await readFile(new URL('../dist/assets/abyss/'+name,import.meta.url)),length=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+length)),at=20+length;
  doc.buffers[0].uri='data:application/octet-stream;base64,'+raw.subarray(at+8,at+8+raw.readUInt32LE(at)).toString('base64');
  doc.materials=doc.materials.map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor}}));delete doc.images;delete doc.textures;delete doc.samplers;
  return new GLTFLoader().parseAsync(JSON.stringify(doc),'');
}

test('actual Warden joints breathe, watch and warn without a fabricated leg gait or cumulative offsets',async()=>{
  const model=await loadModel('warden-lod.glb'),mixer=new THREE.AnimationMixer(model.scene),motion=createWardenMotion(model.scene,model.animations);mixer.clipAction(model.animations[0]).play();
  const bones=[];model.scene.traverse(o=>{if(o.isBone)bones.push(o);});
  const pose=state=>{mixer.setTime(state.clipTime);motion.update(1/60,state);model.scene.updateMatrixWorld(true);return bones.flatMap(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()]);};
  const idle={phase:.3,alert:0,headTurn:0,clipTime:.2},alert={phase:1.8,alert:.9,headTurn:.4,clipTime:1.2};
  const first=pose(idle),second=pose(alert);assert.ok(second.some((v,i)=>Math.abs(v-first[i])>.03));assert.ok(second.every(Number.isFinite));
  for(let i=0;i<90;i++){mixer.setTime(alert.clipTime);motion.update(0,alert);assert.deepEqual(bones.flatMap(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()]),second);}
  assert.equal(motion.snapshot().mappedBones,17);assert.match(motion.snapshot().stance,/no knee/);motion.dispose();mixer.stopAllAction();
});

test('integrated actual shark/kraken LOD arrivals preserve a live shared phase and articulated mapping',{timeout:10000},async t=>{
  // Await the actual reads/parses, not a 25/40 ms wall-clock guess under parallel load.
  const loads=[];
  t.mock.method(GLTFLoader.prototype,'loadAsync',url=>{const task=loadModel(url.split('/').at(-1));loads.push(task);return task;});
  const scene=new THREE.Scene(),life=createAbyssLife(scene,{terrain});t.after(()=>life.dispose());
  const observe={x:-9,y:-20,z:-24};life.update(0,0,observe,'medium');
  assert.ok(loads.length>0);await Promise.all(loads);
  for(let frame=1;frame<=180;frame++)life.update(1/60,frame/60,observe,'medium');
  const shark=life.creatures.find(c=>c.id==='shark');assert.equal(shark.lowState,'ready');assert.ok(shark.motion.phase>.37);const phase=shark.motion.phase;
  observe.x=shark.motion.x;observe.y=shark.motion.y;observe.z=shark.motion.z;life.update(0,3,observe,'high');
  await Promise.all(loads);
  life.update(0,3,observe,'high');assert.equal(shark.highState,'ready');close(shark.motion.phase,phase);
  assert.ok(shark.driverLow&&shark.driverHigh);assert.equal(shark.highObject.visible,true);
  const snapshot=JSON.stringify(life.snapshot().large);for(let i=0;i<30;i++)life.update(0,3,observe,'high');assert.equal(JSON.stringify(life.snapshot().large),snapshot);
  // Tiny schooling fish now deform their tail/body vertices in the same shared draw.
  const school=scene.children.find(o=>o.isInstancedMesh),shader={vertexShader:THREE.ShaderLib.standard.vertexShader,uniforms:{}};
  school.material.onBeforeCompile(shader);assert.match(shader.vertexShader,/transformed\.x\+=sin/);assert.ok(school.geometry.attributes.aFishPhase);assert.ok(life.stats.fishTriangles>100&&life.stats.fishTriangles<250);
});


test('schooling fish face their actual planar travel tangent throughout their circular paths',t=>{
 t.mock.method(GLTFLoader.prototype,'loadAsync',()=>Promise.reject(new Error('No assets needed for fish-heading test')));
 const scene=new THREE.Scene(),life=createAbyssLife(scene,{terrain});t.after(()=>life.dispose());
 const schools=scene.children.filter(o=>o.isInstancedMesh),matrix=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
 for(const time of [1,5,12,23,36]){
  const player={x:-45,y:20,z:-30};life.update(.01,time,player,'high');const positions=schools.map(s=>{s.getMatrixAt(0,matrix);return new THREE.Vector3().setFromMatrixPosition(matrix);});
  life.update(.01,time+.01,player,'high');schools.forEach((school,i)=>{if(!school.visible)return;school.getMatrixAt(0,matrix);matrix.decompose(p,q,scale);const velocity=p.clone().sub(positions[i]);velocity.y=0;velocity.normalize();const forward=new THREE.Vector3(0,0,-1).applyQuaternion(q);forward.y=0;forward.normalize();assert.ok(velocity.dot(forward)>.998,`school${i} faces away from travel at${time}`);});
 }
});
