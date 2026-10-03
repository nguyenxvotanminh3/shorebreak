import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {terrainHeight} from '../dist/abyss-world.js';
import {createDeepBasin,DEEP_BOUNDS} from '../dist/abyss-deep-zone.js';

test('deep extension has a continuous reef edge and keeps the rig foot/deck deeply submerged',()=>{
 for(let x=-200;x<=200;x+=10){assert.ok(Math.abs(terrainHeight(x,-232.001)-terrainHeight(x,-231.999))<.001);assert.ok(Math.abs(terrainHeight(x,-282.001)-terrainHeight(x,-281.999))<.001);}
 const basin=createDeepBasin(new THREE.Scene(),{terrain:terrainHeight});assert.equal(basin.stats.terrainTiles,32);assert.equal(basin.stats.terrainTriangles,25600);assert.ok(basin.site.y<-115);assert.ok(basin.site.y+70< -40);assert.ok(basin.site.z+50< -282);assert.equal(DEEP_BOUNDS.minZ,-420);basin.dispose();
});
test('southern terrain is finite, collision coherent and tier-culls without growing resources',()=>{
 const scene=new THREE.Scene(),basin=createDeepBasin(scene,{terrain:terrainHeight}),resources=[];basin.root.traverse(o=>{resources.push(o);if(o.geometry){for(const a of Object.values(o.geometry.attributes))assert.ok(a.array.every(Number.isFinite));}});
 const counts=[];for(const quality of ['low','medium','high']){basin.update(.4,5,{x:0,z:-280},quality);counts.push(basin.stats.visibleTiles);}assert.ok(counts[0]<counts[1]&&counts[1]<=counts[2]);
 for(let i=0;i<1000;i++)basin.update(1/60,i/60,{x:Math.sin(i*.02)*160,z:-250-(i%150)},'medium');const after=[];basin.root.traverse(o=>after.push(o));assert.deepEqual(after,resources);assert.equal(basin.colliders.length,20);basin.dispose();assert.equal(scene.children.length,0);basin.dispose();
});
