import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('../dist/assets/abyss/',import.meta.url);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
test('asset manifest hashes and geometry budgets describe every shipped GLB exactly',async()=>{
 const manifest=JSON.parse(await readFile(new URL('ASSET-MANIFEST.json',base),'utf8'));
 assert.deepEqual(manifest.models.map(m=>m.file).sort(),(await readdir(base)).filter(n=>n.endsWith('.glb')).sort());
 for(const m of manifest.models){
  const raw=await readFile(new URL(m.file,base)),json=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)));
  assert.equal(m.bytes,raw.length,m.file);assert.equal(m.sha256,hash(raw),m.file);
  const primitives=json.meshes.flatMap(mesh=>mesh.primitives);
  assert.equal(m.triangles,primitives.reduce((n,p)=>n+json.accessors[p.indices].count/3,0),m.file);
  assert.equal(m.meshPrimitives,primitives.length,m.file);assert.equal(m.materials,json.materials.length,m.file);
  assert.equal(m.bones,json.skins?.[0]?.joints?.length??0,m.file);
  assert.deepEqual(m.clips,(json.animations??[]).map(a=>a.name),m.file);
 }
});
test('standalone tissue atlas manifest records the actual shared 512px data payload',async()=>{
 const manifest=JSON.parse(await readFile(new URL('ASSET-MANIFEST.json',base),'utf8'));
 const atlas=manifest.runtimeTextures.find(t=>t.file==='jelly-tissue-atlas-512.png'),raw=await readFile(new URL(atlas.file,base));
 assert.equal(atlas.bytes,raw.length);assert.equal(atlas.sha256,hash(raw));assert.equal(raw.readUInt32BE(16),512);assert.equal(raw.readUInt32BE(20),512);
 assert.equal(atlas.colorSpace,'NoColorSpace');assert.equal(atlas.kind,'tissue-channel-data');
});

test('deep-rig manifest pins all three final Blender exports and generated collision layout',async()=>{
 const rigBase=new URL('rig/',base),manifest=JSON.parse(await readFile(new URL('ASSET-MANIFEST.json',rigBase),'utf8'));
 assert.deepEqual(manifest.models.map(m=>m.file).sort(),(await readdir(rigBase)).filter(n=>n.endsWith('.glb')).sort());
 for(const m of manifest.models){const raw=await readFile(new URL(m.file,rigBase)),g=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12))),p=g.meshes.flatMap(m=>m.primitives);assert.equal(m.bytes,raw.length);assert.equal(m.sha256,hash(raw));assert.equal(m.triangles,p.reduce((n,q)=>n+g.accessors[q.indices].count/3,0));assert.equal(m.primitives,p.length);assert.ok(m.primitives<=60);}
 const raw=await readFile(new URL(manifest.layout.file,rigBase));assert.equal(manifest.layout.sha256,hash(raw));assert.equal(manifest.layout.bytes,raw.length);
 const layout=JSON.parse(raw),{RIG_LAYOUT}=await import('../dist/abyss-rig-layout.js');for(const key of Object.keys(RIG_LAYOUT))assert.deepEqual(RIG_LAYOUT[key],layout[key],key);
 assert.equal(layout.collisionBoxes.filter(b=>b.name.endsWith('_shaft')).length,6);
});

test('island manifest pins the original shared-atlas Blender prototype pack',async()=>{
 const folder=new URL('island/',base),m=JSON.parse(await readFile(new URL('ASSET-MANIFEST.json',folder))),model=m.models[0],raw=await readFile(new URL(model.file,folder)),g=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)));
 assert.equal(model.bytes,raw.length);assert.equal(model.sha256,hash(raw));assert.equal(model.primitives,30);assert.equal(g.materials.length,1);assert.equal(g.images.length,1);
 assert.equal(model.triangles,g.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+g.accessors[p.indices].count/3,0));
 const layoutRaw=await readFile(new URL(m.layout.file,folder));assert.equal(m.layout.bytes,layoutRaw.length);assert.equal(m.layout.sha256,hash(layoutRaw));
 const layout=JSON.parse(layoutRaw);assert.equal(layout.assets.length,15);const nodes=new Set(g.nodes.map(n=>n.name));for(const a of layout.assets)for(const lod of a.lods)assert.ok(nodes.has(lod.node));
 assert.equal(layout.alpha_mode,'OPAQUE');assert.ok(g.meshes.every(m=>m.primitives.every(p=>p.attributes.TEXCOORD_1!==undefined)));
});
