// Real GLB skin/animation, pure fixed-step defense, world positions and pooled
// Three resources. Bitmap decoding omitted; these checks never draw pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import {GLTFLoader} from '../dist/vendor/GLTFLoader.js';
import {createAbyssLife} from '../dist/abyss-life.js';
import {CREATURE_STEP} from '../dist/abyss-locomotion.js';

globalThis.ProgressEvent||=class extends Event{constructor(type,init={}){super(type);Object.assign(this,init);}};
async function model(name){
 const raw=await readFile(new URL('../dist/assets/abyss/'+name,import.meta.url)),n=raw.readUInt32LE(12),j=JSON.parse(raw.subarray(20,20+n)),at=20+n;
 j.buffers[0].uri='data:application/octet-stream;base64,'+raw.subarray(at+8,at+8+raw.readUInt32LE(at)).toString('base64');
 j.materials=j.materials.map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor}}));delete j.images;delete j.textures;delete j.samplers;
 return new GLTFLoader().parseAsync(JSON.stringify(j),'');
}
async function fixture(t){
 const jobs=[];t.mock.method(GLTFLoader.prototype,'loadAsync',url=>{const job=model(url.split('/').at(-1));jobs.push(job);return job;});
 const scene=new THREE.Scene(),life=createAbyssLife(scene,{terrain:()=>-60}),kraken=life.creatures.find(c=>c.id==='kraken');
 t.after(()=>life.dispose());const observer={x:71,y:-47,z:-103,playing:false,submerged:true};life.update(0,0,observer,'high');await Promise.all(jobs);
 assert.equal(kraken.lowState,'ready');assert.equal(kraken.highState,'ready');observer.playing=true;life.reset();
 let time=0;return{scene,life,kraken,observer,get time(){return time;},step(n=1,tier='high'){for(let i=0;i<n;i++){time+=CREATURE_STEP;life.update(CREATURE_STEP,time,observer,tier);}},reset(){time=0;life.reset();}};
}

test('actual animated siphon emits one world plume and Kraken escapes, then cloud clears',async t=>{
 const f=await fixture(t),start=new THREE.Vector3(f.kraken.motion.x,f.kraken.motion.y,f.kraken.motion.z);
 f.step(60);assert.equal(f.kraken.inkDefense.state.stage,'anticipation');assert.equal(f.life.inkClouds.snapshot().activeClouds,0);
 while(f.kraken.inkDefense.state.eventId===0)f.step();
 const first=f.life.inkClouds.snapshot();assert.equal(first.activeClouds,1);assert.equal(first.clouds[0].id,'kraken:1');
 const nozzle=new THREE.Vector3();f.kraken.driverHigh.getSiphonWorldPosition(nozzle);
 const o=first.clouds[0].origin;assert.ok(nozzle.distanceTo(new THREE.Vector3(o.x,o.y,o.z))<1e-10,'emission at posed aperture, not model root');
 assert.ok(nozzle.distanceTo(f.kraken.root.position)>2);assert.equal(first.drawCalls,1);
 const original={...o};f.step(230);assert.ok(f.kraken.motion.speed>1);assert.ok(f.kraken.motion.x<start.x-1,'retreats away from player at +X');
 const later=f.life.inkClouds.snapshot();assert.deepEqual(later.clouds[0].origin,original,'cloud stays released in world, not parented to escape');
 assert.equal(f.kraken.inkDefense.state.eventId,1);assert.ok(f.kraken.inkDefense.state.escapeStrength>0);
 const center=later.clouds[0].center;assert.ok(f.life.inkDensity(center)>.8);assert.equal(f.life.inkDensity({x:center.x+30,y:center.y,z:center.z}),0);
 f.step(1000);assert.equal(f.life.inkClouds.snapshot().activeClouds,0);assert.equal(f.life.inkDensity(center),0);
});

test('ink stage/nozzle/pose is shared across LOD; paused frames cannot reemit or age',async t=>{
 const f=await fixture(t);f.step(85,'high');const before=f.life.snapshot(),origin=before.ink.clouds[0].origin,phase=f.kraken.motion.phase;
 const high=f.kraken.driverHigh.snapshot();f.life.update(0,f.time,f.observer,'medium');
 assert.equal(f.kraken.lastAsset,'low');assert.equal(f.kraken.motion.phase,phase);assert.deepEqual(f.kraken.driverLow.snapshot().mantleScale,high.mantleScale);
 const lowPoint=new THREE.Vector3(),highPoint=new THREE.Vector3();f.kraken.driverLow.getSiphonWorldPosition(lowPoint);f.kraken.driverHigh.getSiphonWorldPosition(highPoint);assert.ok(lowPoint.distanceTo(highPoint)<1e-10);
 const pause=JSON.stringify(f.life.snapshot());for(let i=0;i<40;i++)f.life.update(0,f.time,f.observer,'medium');assert.equal(JSON.stringify(f.life.snapshot()),pause);
 assert.equal(f.life.inkClouds.snapshot().activeClouds,1);assert.deepEqual(f.life.inkClouds.snapshot().clouds[0].origin,origin);
});

test('life resets ink and gates menu/surface/unloaded models without allocating another emitter',async t=>{
 const f=await fixture(t),root=f.life.inkClouds.root,mesh=root.children[0],geometry=mesh.geometry,material=mesh.material;
 f.observer.playing=false;f.step(180);assert.equal(f.kraken.inkDefense.state.eventId,0);
 f.observer.playing=true;f.observer.submerged=false;f.step(180);assert.equal(f.kraken.inkDefense.state.eventId,0);
 f.reset();f.observer.submerged=true;f.step(100);assert.equal(f.life.inkClouds.snapshot().activeClouds,1);
 f.reset();assert.equal(f.life.inkClouds.snapshot().activeClouds,0);assert.equal(f.kraken.inkDefense.state.eventId,0);
 assert.equal(f.life.inkClouds.root,root);assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);
 let gd=0,md=0;geometry.addEventListener('dispose',()=>gd++);material.addEventListener('dispose',()=>md++);f.life.dispose();f.life.dispose();assert.equal(gd,1);assert.equal(md,1);assert.equal(f.scene.children.length,0);
});

test('complete defensive trajectory and cloud agree across render schedules',async t=>{
 const f=await fixture(t),results=[];
 for(const hz of [30,60,120]){
  f.reset();for(let frame=1;frame<=hz*4;frame++)f.life.update(1/hz,frame/hz,f.observer,'medium');
  results.push({motion:{x:f.kraken.motion.x,y:f.kraken.motion.y,z:f.kraken.motion.z,speed:f.kraken.motion.speed,phase:f.kraken.motion.phase},defense:f.kraken.inkDefense.snapshot(),ink:f.life.inkClouds.snapshot()});
 }
 assert.deepEqual(results[1],results[0]);assert.deepEqual(results[2],results[0]);
});
