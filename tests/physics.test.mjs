// Dependency-free regression checks: node --test tests/physics.test.mjs
// Node 20/22 may need --experimental-default-type=module for the browser .js modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import {GLTFLoader} from '../dist/vendor/GLTFLoader.js';
import {FIXED_DT,resetPhysics,advancePhysics,beginWipeout} from '../dist/physics.js';
import {sampleWater} from '../dist/water.js';
import {createSurfer} from '../dist/surfer.js';
import {createAura} from '../dist/aura.js';

const input={left:false,right:false,pump:false,jump:false,brake:false,aura:false};
function fresh(){const s={oceanTime:0,score:0,combo:1,maxSpeed:0,status:'playing'};resetPhysics(s);return s;}
function step(s,keys={},count=1){for(let i=0;i<count;i++){s.oceanTime+=FIXED_DT;advancePhysics(s,{...input,...keys},FIXED_DT);}return s;}
function launch(s,keys={}){step(s,{...keys,jump:true},90);step(s,keys);assert.equal(s.air,true);return s;}
function near(a,b,tol=1e-9){assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b} by more than ${tol}`);}

test('holding E on water is acknowledged immediately without earning airborne credit',()=>{
 const s=fresh();step(s,{aura:true});assert.equal(s.auraHeld,true);assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
 step(s,{aura:true},240);assert.equal(s.air,false);assert.equal(s.auraDwell,0);
 step(s);assert.equal(s.auraHeld,false);assert.equal(s.auraActive,false);
});

test('pre-held E survives takeoff but bonus eligibility remains the safe airborne window',()=>{
 const s=launch(fresh(),{aura:true});assert.equal(s.auraHeld,true);assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
 let credited=0,sawActive=false,sawDescentCutoff=false;
 while(s.air){
  const oldDwell=s.auraDwell;step(s,{aura:true});
  const surface=sampleWater(s.x,s.z,s.oceanTime);
  const eligible=s.air&&s.wipe<=0&&s.airTime>.12&&s.airProgress<.86&&s.y-surface.h>.8;
  assert.equal(s.auraActive,eligible);
  if(eligible){credited+=FIXED_DT;sawActive=true;}else if(s.air&&s.airProgress>=.86){sawDescentCutoff=true;near(s.auraDwell,oldDwell);}
 }
 assert.ok(sawActive);assert.ok(sawDescentCutoff);near(s.auraDwell,credited);assert.equal(s.auraActive,false);assert.equal(s.auraHeld,true);
});

test('release removes active aura in the same physics step and wipeout clears all aura intent',()=>{
 const s=launch(fresh(),{aura:true});step(s,{aura:true},35);assert.equal(s.auraActive,true);
 const dwell=s.auraDwell;step(s);assert.equal(s.auraHeld,false);assert.equal(s.auraActive,false);near(s.auraDwell,dwell);
 step(s,{aura:true});assert.equal(s.auraActive,true);beginWipeout(s);assert.equal(s.auraHeld,false);assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
 step(s,{aura:true},30);assert.equal(s.auraHeld,false);assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
 resetPhysics(s);assert.equal(s.auraHeld,false);assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
});

test('short takeoff and low-height input never bypass airborne aura requirements',()=>{
 const s=fresh();Object.assign(s,{air:true,airTime:.05,airProgress:.02,launchVy:5,vy:5,airVX:0,airVZ:0});
 step(s,{aura:true});assert.equal(s.auraHeld,true);assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
 s.airTime=.2;s.y=sampleWater(s.x,s.z,s.oceanTime).h+.3;step(s,{aura:true});assert.equal(s.auraActive,false);assert.equal(s.auraDwell,0);
});

// Load the real skeleton, geometry and skin weights without browser-only image
// decoding. The production GLB is unchanged; only this in-memory texture is omitted.
async function loadTestRig(){
 const raw=await readFile(new URL('../dist/assets/surfer-athlete.glb',import.meta.url));
 const jsonLength=raw.readUInt32LE(12),json=JSON.parse(raw.subarray(20,20+jsonLength).toString());
 const binStart=20+jsonLength,binLength=raw.readUInt32LE(binStart);
 json.buffers[0].uri='data:application/octet-stream;base64,'+raw.subarray(binStart+8,binStart+8+binLength).toString('base64');
 for(const m of json.materials??[])delete m.pbrMetallicRoughness?.baseColorTexture;
 delete json.images;delete json.textures;
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class ProgressEvent{constructor(type,values){this.type=type;Object.assign(this,values);}};
 return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
function bonesOf(surfer){const nodes=[];surfer.rig.traverse(n=>{if(n.isBone)nodes.push(n);});return nodes;}
function poseSnapshot(surfer){return bonesOf(surfer).flatMap(n=>[...n.position.toArray(),...n.quaternion.toArray()]);}
function localHand(surfer,side){const bone=bonesOf(surfer).find(n=>n.name.replace(/[^a-z0-9]/gi,'').endsWith(side+'Hand'));return surfer.rig.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));}
function checkFeet(surfer){const {feet}=surfer.inspect();for(let i=0;i<2;i++)for(let j=0;j<3;j++)near(feet[i][j],[[-.060,.153,-.42],[-.015,.153,.43]][i][j],.012);}
const still={status:'playing',oceanTime:3,x:0,y:1,z:0,wipe:0,lean:0,steer:0,charge:0,air:false,airTime:0,airProgress:0,landingTime:0,nz:0,acceleration:0,auraHeld:false,auraActive:false,auraStyle:0};

test('real athlete rig responds visibly to grounded E, keeps feet planted and freezes with dt=0',async t=>{
 t.mock.method(GLTFLoader.prototype,'loadAsync',loadTestRig);
 const surfer=await createSurfer(new THREE.Scene());for(let i=0;i<60;i++)surfer.pose(still,1/60);
 const before=localHand(surfer,'Left');const held={...still,auraHeld:true};
 for(let i=0;i<20;i++)surfer.pose(held,1/60);
 assert.equal(surfer.inspect().phase,'aura-balance');assert.ok(localHand(surfer,'Left').y-before.y>.15);checkFeet(surfer);
 // Stop mid-transition, rather than after a filter has already converged.
 surfer.pose({...held,auraHeld:false,charge:.8},1/60);const frozen=poseSnapshot(surfer),motion=surfer.inspect();
 for(let i=0;i<120;i++)surfer.pose({...held,auraHeld:false,charge:.8},0);
 assert.deepEqual(surfer.inspect(),motion);assert.deepEqual(poseSnapshot(surfer),frozen);
});

test('airborne salute, sky king and victory differ and transitions stay continuous',async t=>{
 t.mock.method(GLTFLoader.prototype,'loadAsync',loadTestRig);const surfer=await createSurfer(new THREE.Scene());
 const air={...still,air:true,airProgress:.45,airTime:.7,auraHeld:true,auraActive:true};
 const hands=[];
 for(let style=0;style<3;style++){for(let i=0;i<75;i++)surfer.pose({...air,auraStyle:style},1/60);hands.push([localHand(surfer,'Left'),localHand(surfer,'Right')]);checkFeet(surfer);assert.ok(poseSnapshot(surfer).every(Number.isFinite));}
 assert.ok(hands[1][1].z-hands[0][1].z>.2);assert.ok(hands[2][1].y-hands[0][1].y>.35);
 // A style change must blend, rather than teleport a wrist in its first frame.
 const previous=localHand(surfer,'Right');surfer.pose({...air,auraStyle:0},1/120);assert.ok(previous.distanceTo(localHand(surfer,'Right'))<.12);
});

test('athlete filters produce the same pose at 30, 60 and 120 FPS',async t=>{
 t.mock.method(GLTFLoader.prototype,'loadAsync',loadTestRig);const snapshots=[];
 const state={...still,air:true,airTime:.21,airProgress:.45,auraHeld:true,auraActive:true,auraStyle:2,lean:.5,steer:.4,charge:.4,nz:.2};
 for(const fps of [30,60,120]){const surfer=await createSurfer(new THREE.Scene());surfer.rig.rotation.z=.3;for(let i=0;i<fps*.6;i++)surfer.pose(state,1/fps);snapshots.push(poseSnapshot(surfer));checkFeet(surfer);}
 for(const snapshot of snapshots.slice(1))for(let i=0;i<snapshot.length;i++)near(snapshot[i],snapshots[0][i],1e-9);
});

test('aura FX acknowledge ground intent, animate arcs, freeze while paused and fade on release',()=>{
 const scene=new THREE.Scene(),fx=createAura(scene),held={...still,auraHeld:true};fx.update(held,1/60);
 const group=scene.getObjectByName('Held aura');assert.equal(group.visible,true);assert.ok(group.children[0].material.opacity>0);
 const initial=group.children[0].rotation.z;fx.update({...held,oceanTime:3.2},.2);assert.notEqual(group.children[0].rotation.z,initial);
 const snapshot=group.children.map(n=>({position:n.position.toArray(),rotation:n.rotation.toArray(),opacity:n.material.opacity,vertices:n.geometry.attributes.position.array.slice()}));
 for(let i=0;i<120;i++)fx.update({...held,status:'paused'},0);
 assert.equal(group.visible,true);assert.deepEqual(group.children.map(n=>({position:n.position.toArray(),rotation:n.rotation.toArray(),opacity:n.material.opacity,vertices:n.geometry.attributes.position.array.slice()})),snapshot);
 for(let i=0;i<60;i++)fx.update(still,1/60);assert.equal(group.visible,false);fx.clear();assert.equal(group.visible,false);
});

test('aura effect intensity is frame-rate independent',()=>{
 const results=[];
 for(const fps of [30,60,120]){const scene=new THREE.Scene(),fx=createAura(scene);for(let i=0;i<fps;i++)fx.update({...still,auraHeld:true,auraActive:true},1/fps);results.push(scene.getObjectByName('Held aura').children.map(n=>n.material.opacity));}
 for(const result of results.slice(1))for(let i=0;i<result.length;i++)near(result[i],results[0][i]);
});
