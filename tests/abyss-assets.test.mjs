import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
globalThis.ProgressEvent ||= class ProgressEvent extends Event { constructor(type,init={}){super(type);Object.assign(this,init);} };
for (const file of ['shark-lod.glb','shark.glb','kraken-lod.glb','kraken.glb','warden-lod.glb','warden.glb']) {
 test(`real ${file} has valid embedded resources, skin and finite animated poses`, async () => {
  const raw=await readFile(new URL('../dist/assets/abyss/'+file,import.meta.url));
  assert.equal(raw.readUInt32LE(0),0x46546c67);assert.equal(raw.readUInt32LE(4),2);assert.equal(raw.readUInt32LE(8),raw.length);
  const jsonLength=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+jsonLength));
  assert.ok(doc.images.length>0);assert.ok(doc.images.every(i=>Number.isInteger(i.bufferView)&&!i.uri));
  assert.equal(doc.animations.length,1);assert.ok(doc.skins[0].joints.length>=8);
  const at=20+jsonLength,binLength=raw.readUInt32LE(at),bin=raw.subarray(at+8,at+8+binLength);
  for(const view of doc.bufferViews)assert.ok((view.byteOffset||0)+view.byteLength<=bin.length);
  doc.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
  // Node cannot decode image bitmaps; geometry and actual skin/animation use the unchanged binary.
  // Textures are structurally validated above; this is explicitly not a rendered-material check.
  doc.materials=doc.materials.map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor,metallicFactor:m.pbrMetallicRoughness?.metallicFactor,roughnessFactor:m.pbrMetallicRoughness?.roughnessFactor}}));
  delete doc.images;delete doc.textures;delete doc.samplers;
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');
  const skinned=[];gltf.scene.traverse(o=>{if(o.isSkinnedMesh)skinned.push(o);});assert.ok(skinned.length>0);
  const mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();
  for(const time of [0,.3,1.2,2.4,4,6,12]){mixer.setTime(time);gltf.scene.updateMatrixWorld(true);for(const mesh of skinned){mesh.skeleton.update();assert.ok(Array.from(mesh.skeleton.boneMatrices).every(Number.isFinite));const p=mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i+=Math.max(1,Math.floor(p.count/40))){const v=new THREE.Vector3().fromBufferAttribute(p,i);mesh.applyBoneTransform(i,v);assert.ok([v.x,v.y,v.z].every(Number.isFinite));}}}
  const box=new THREE.Box3().setFromObject(gltf.scene);assert.ok(!box.isEmpty());assert.ok(box.getSize(new THREE.Vector3()).length()<50);
 });
}
