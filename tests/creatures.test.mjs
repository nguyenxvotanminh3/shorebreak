import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeaCreature} from '../dist/creatures.js';
import {createKaiju} from '../dist/kaiju.js';
const kinds=['shark','kraken','seaSerpent','jellyfish','kaiju'];
const expected={shark:[5,11],kraken:[11,41],seaSerpent:[5,12],jellyfish:[16,2],kaiju:[11,21]};
const materialSet=new Set(),textureSet=new Set();
const make=k=>k==='kaiju'?createKaiju():createSeaCreature(k);
for(const kind of kinds)test(`${kind} keeps geometry, colliders, anatomy and shared materials stable`,()=>{
 const creature=make(kind),meshes=[];creature.group.traverse(o=>{if(o.isMesh)meshes.push(o)});
 const colliders=creature.getColliders(),geometryRefs=meshes.map(o=>o.geometry),attributeRefs=meshes.map(o=>Object.values(o.geometry.attributes).map(a=>a.array));
 assert.equal(meshes.length,expected[kind][0]);assert.equal(colliders.length,expected[kind][1]);
 creature.group.position.set(7,3,-41);creature.group.rotation.set(.2,.4,.1);creature.group.scale.set(1.3,1.1,1.4);const rootMatrix=creature.group.matrix.clone();creature.group.updateMatrix();const matrixElements=creature.group.matrix.elements.slice();
 const materials=meshes.map(o=>o.material),dynamicBuffers=meshes.filter(o=>o.geometry.attributes.position.usage===35048).map(o=>o.geometry.attributes.position.array.slice());
 for(const mesh of meshes){
  const g=mesh.geometry;assert.equal(g.attributes.normal.count,g.attributes.position.count);if(!g.boundingSphere)g.computeBoundingSphere();assert(Number.isFinite(g.boundingSphere.radius));
  if(mesh.material.map){assert.equal(g.attributes.uv.count,g.attributes.position.count);assert.equal(mesh.material.metalness,0);assert(mesh.material.roughness>=.7);assert(mesh.material.normalMap);assert(mesh.material.roughnessMap);}
  assert(mesh.receiveShadow);if(!mesh.material.transparent)assert(mesh.castShadow);
  for(const attr of Object.values(g.attributes))for(const value of attr.array)assert(Number.isFinite(value));
  materialSet.add(mesh.material);for(const k of ['map','normalMap','roughnessMap'])if(mesh.material[k])textureSet.add(mesh.material[k]);
 }
 const start=performance.now();
 for(let frame=1;frame<=960;frame++){
  creature.animate(frame/60,22+Math.sin(frame*.015)*12);
  assert.equal(creature.getColliders(),colliders);for(const c of colliders){for(const key of ['x','y','z','rx','ry','rz'])assert(Number.isFinite(c[key]));for(const key of ['rx','ry','rz'])assert(c[key]>0)}
  if(frame%120===0)for(const mesh of meshes){for(const value of mesh.geometry.attributes.position.array)assert(Number.isFinite(value));for(const value of mesh.geometry.attributes.normal.array)assert(Number.isFinite(value));if(mesh.isInstancedMesh)for(const value of mesh.instanceMatrix.array)assert(Number.isFinite(value));}
 }
 const elapsed=performance.now()-start;
 creature.group.updateMatrix();assert.deepEqual(creature.group.matrix.elements,matrixElements);
 let triangles=0;
 meshes.forEach((mesh,i)=>{assert.equal(mesh.geometry,geometryRefs[i]);assert.equal(mesh.material,materials[i]);Object.values(mesh.geometry.attributes).forEach((a,j)=>assert.equal(a.array,attributeRefs[i][j]));triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.count??1)});
 const after=[];creature.group.traverse(o=>{if(o.isMesh)after.push(o)});assert.deepEqual(after,meshes);
 // Repeated pool creations may allocate geometry; textures/materials remain shared.
 for(let copy=0;copy<3;copy++){const other=make(kind);other.group.traverse(o=>{if(o.isMesh)assert(materialSet.has(o.material));});}
 assert.ok(triangles<40000);
});
test('all creatures share nine bounded procedural texture maps',()=>{
assert.equal(textureSet.size,9);for(const tex of textureSet){assert.equal(tex.image.width,128);assert.equal(tex.image.height,128);assert(tex.generateMipmaps);assert.equal(tex.image.data.byteLength,65536);}
assert.equal(materialSet.size,7);
});
