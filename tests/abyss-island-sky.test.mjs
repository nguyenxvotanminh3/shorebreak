import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {createIslandSky} from '../dist/abyss-island-sky.js';
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
const restore=()=>{scene.fog=new THREE.FogExp2(0x168cc0,.008);scene.background=new THREE.Color(0x168cc0);};
test('air view is distinct while submerged fog remains untouched and sky stays behind geometry',()=>{
 restore();const sky=createIslandSky(scene);camera.position.set(115,-3,155);const original=scene.fog.color.clone();sky.update(.1,1,camera);assert.equal(sky.snapshot().visible,false);assert.equal(scene.fog.density,.008);assert.deepEqual(scene.fog.color,original);
 for(const y of [0,.25,.6,10,55]){restore();camera.position.y=y;sky.update(.1,2,camera);assert.ok(sky.snapshot().air>=0&&sky.snapshot().air<=1);assert.ok(scene.fog.density>=.0018-1e-9&&scene.fog.density<=.008);}
 assert.equal(sky.snapshot().air,1);assert.ok(scene.fog.color.r>original.r);assert.equal(sky.root.material.depthWrite,false);assert.equal(sky.root.material.depthTest,true);assert.equal(sky.root.material.side,THREE.BackSide);assert.ok(sky.snapshot().triangles<=1024);
 restore();camera.position.y=-2;sky.update(0,99,camera);assert.equal(sky.snapshot().visible,false);assert.equal(sky.snapshot().time,2);assert.deepEqual(scene.fog.color,original);sky.dispose();
});
test('indoor sky is suppressed and pause/resource lifetime remain bounded',()=>{
 restore();const sky=createIslandSky(scene);camera.position.set(10,4,10);const g=sky.root.geometry,m=sky.root.material;let gd=0,md=0;g.addEventListener('dispose',()=>gd++);m.addEventListener('dispose',()=>md++);
 sky.update(.1,1,camera,{indoors:true});assert.equal(sky.root.visible,false);for(let i=0;i<100;i++){restore();sky.update(0,100,camera);assert.equal(sky.snapshot().time,1);assert.equal(sky.root.geometry,g);assert.equal(sky.root.material,m);}
 sky.dispose();sky.dispose();assert.equal(gd,1);assert.equal(md,1);assert.equal(scene.children.includes(sky.root),false);
});
