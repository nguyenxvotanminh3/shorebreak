import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {createInputState} from '../dist/input.js';
import {createLighting, createWaterContact} from '../dist/lighting.js';
const actions=['left','right','pump','jump','brake','aura'];

test('aliases retain steering until the last physical key is released',()=>{
 const input=createInputState(actions);
 input.press('key:KeyA','left');input.press('key:ArrowLeft','left');
 input.release('key:KeyA');assert.equal(input.values.left,true);
 input.release('key:ArrowLeft');assert.equal(input.values.left,false);
});

test('keyboard and multiple touch pointers do not cancel one another',()=>{
 const input=createInputState(actions);
 input.press('key:KeyE','aura');input.press('pointer:1','aura');input.press('pointer:2','aura');
 input.release('pointer:1');assert.equal(input.values.aura,true);
 input.release('key:KeyE');assert.equal(input.values.aura,true);
 input.release('pointer:2');assert.equal(input.values.aura,false);
});

test('repeat, pointercancel/lostcapture and pause clear are idempotent',()=>{
 const input=createInputState(actions);
 input.press('key:Space','jump');input.press('key:Space','jump');
 input.press('pointer:1','aura');input.release('pointer:1');input.release('pointer:1');
 assert.equal(input.values.aura,false);assert.equal(input.values.jump,true);
 input.clear();assert.ok(Object.values(input.values).every(v=>v===false));
 input.release('key:Space');assert.equal(input.values.jump,false);
 input.press('key:KeyE','aura');assert.equal(input.values.aura,true);
});

test('one directional shadow volume follows the endless course with tier budgets',()=>{
 const renderer={shadowMap:{}},scene=new THREE.Scene(),lighting=createLighting(scene,renderer);
 assert.equal(renderer.shadowMap.enabled,true);assert.equal(lighting.inspect().mapSize,1024);
 const sun=scene.children.find(n=>n.castShadow);
 assert.equal(scene.children.filter(n=>n.castShadow).length,1);
 lighting.update(12500,-76000);assert.ok(Math.abs(sun.target.position.x-12500)<.1);
 assert.ok(Math.abs(sun.target.position.z+76026)<.1);
 let disposed=0;sun.shadow.map={dispose(){disposed++;}};
 lighting.quality(2);assert.equal(disposed,1);assert.equal(sun.shadow.map,null);
 assert.equal(sun.shadow.mapSize.x,2048);
 lighting.quality(2);assert.equal(disposed,1);
 lighting.quality(0);assert.equal(renderer.shadowMap.enabled,false);assert.equal(sun.castShadow,false);
 assert.equal(scene.children.filter(n=>n.isLight).length,3);
});

test('contact shadows share geometry and update only existing uniforms and transforms',()=>{
 const scene=new THREE.Scene(),a=createWaterContact(scene,2,3),b=createWaterContact(scene,1,2,.3);
 assert.equal(a.mesh.geometry,b.mesh.geometry);
 const geometry=a.mesh.geometry,material=a.mesh.material;
 for(let i=0;i<500;i++)a.update(i*.1,-i,13+i/60,.8);
 assert.equal(a.mesh.geometry,geometry);assert.equal(a.mesh.material,material);
 assert.equal(material.depthWrite,false);assert.equal(material.transparent,true);
 assert.equal(a.mesh.position.z,-499);assert.equal(scene.children.length,2);
 assert.ok(material.uniforms.uOpacity.value>0);assert.ok(material.uniforms.uOpacity.value<1);
});
