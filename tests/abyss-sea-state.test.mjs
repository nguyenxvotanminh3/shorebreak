// Numerical, resource, and static shader contracts. No mocked GPU/pixel claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {SEA_CYCLE_SECONDS,SEA_REVIEW_TIMES,SEA_UNIFORM_FIELDS,sampleSeaState,createSeaStateController,seaDepthAttenuation} from '../dist/abyss-sea-state.js';
import {WATER_OPTICS,WATER_SURFACE_VERTEX,WATER_SURFACE_FRAGMENT,WATER_SHORE_GLSL,WATER_SHORE_GUARD,waterWaveMask,sampleSeaHeight,createWaterSurfaceMaterial} from '../dist/abyss-water.js';
import {ISLAND_LAYOUT,ISLAND_SAFE_PATH,ISLET_SAFE_PATH,sampleIslandTerrain} from '../dist/abyss-island-terrain.js';
import {createAbyssWorld,terrainHeight} from '../dist/abyss-world.js';
import {createIslandSky} from '../dist/abyss-island-sky.js';
const close=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);

test('deterministic four-minute cycle reaches calm, moderate, rough, moderate and repeats smoothly',()=>{
 assert.equal(SEA_CYCLE_SECONDS,240);
 const states=Object.values(SEA_REVIEW_TIMES).map(t=>sampleSeaState(t));
 assert.deepEqual(states.map(s=>s.label),['Calm','Moderate','Rough','Moderate']);
 states.forEach((s,i)=>close(s.severity,[0,.5,1,.5][i]));
 assert.ok(states[2].amplitude>states[0].amplitude*8);
 for(const field of ['speed','wind','foam','cloud'])assert.ok(states[2][field]>states[0][field]);
 assert.ok(states[2].light<states[0].light);assert.ok(states[2].wavelength<states[0].wavelength);
 for(let t=0;t<=720;t+=.25){
  const s=sampleSeaState(t),other=sampleSeaState(t+240);
  for(const [key,value]of Object.entries(s))if(typeof value==='number')assert.ok(Number.isFinite(value),key);
  for(const key of ['severity','amplitude','wavelength','speed','wind','foam','cloud','light'])close(s[key],other[key]);
  assert.ok(s.severity>=0&&s.severity<=1);assert.ok(s.amplitude<=1.9);assert.ok(s.light>=.62);
  const e=.001,left=sampleSeaState(Math.max(0,t-e)),right=sampleSeaState(t+e);
  if(t>0)close((right.waveTime-left.waveTime)/(2*e),s.speed,1e-7);
  assert.ok(right.waveTime>left.waveTime,'wave phase never reverses');
 }
 for(const boundary of [60,120,180,240,480]){
  const a=sampleSeaState(boundary-1e-5),b=sampleSeaState(boundary+1e-5);
  assert.ok(Math.abs(a.severity-b.severity)<1e-6);assert.ok(Math.abs(a.waveTime-b.waveTime)<.00003);
 }
 for(const t of [NaN,Infinity,-Infinity,-1])assert.deepEqual(sampleSeaState(t),sampleSeaState(0));
 const out={};assert.equal(sampleSeaState(120,out),out);assert.deepEqual(out,sampleSeaState(120));
});

test('controller uses simulation time, freezes paused frames and resets without reallocating',()=>{
 const a=createSeaStateController(),b=createSeaStateController(),ref=a.state;
 for(let i=1;i<=3600;i++)a.update(1/60,i/60);
 for(let i=1;i<=1200;i++)b.update(1/20,i/20);
 assert.deepEqual(a.state,b.state);assert.equal(a.state,ref);
 const frozen={...a.state};for(let i=0;i<100;i++)a.update(0,180);
 assert.deepEqual(a.state,frozen);
 a.update(0,0);assert.deepEqual(a.state,sampleSeaState(0));
 a.update(.1,120,78);assert.equal(a.state.label,'Rough');close(a.state.depthAttenuation,Math.exp(-3));
 a.reset();assert.equal(a.state,ref);assert.deepEqual(a.state,sampleSeaState(0));
 a.update(.5,NaN);close(a.state.time,.5);
});

test('wave heights are bounded, continuous, world anchored, and quiet at the recovery buoy',()=>{
 const calm=sampleSeaState(0),rough=sampleSeaState(120);
 let calmEnergy=0,roughEnergy=0;
 for(let x=-200;x<=200;x+=13)for(let z=-300;z<=0;z+=11){
  const a=sampleSeaHeight(x,z,calm),b=sampleSeaHeight(x,z,rough);
  assert.ok(Math.abs(a)<=calm.amplitude);assert.ok(Math.abs(b)<=rough.amplitude);
  calmEnergy+=a*a;roughEnergy+=b*b;
  close(sampleSeaHeight(x,z,sampleSeaState(120)),b);
  assert.ok(Math.abs(sampleSeaHeight(x,z,sampleSeaState(239.999))-sampleSeaHeight(x,z,sampleSeaState(240.001)))<.01);
 }
 assert.ok(roughEnergy>calmEnergy*40);
 for(let t=0;t<240;t+=3)for(let a=0;a<6.3;a+=.3){
  const state=sampleSeaState(t);assert.equal(sampleSeaHeight(0,18,state),0);
  assert.equal(sampleSeaHeight(Math.cos(a)*6,18+Math.sin(a)*6,state),0);
 }
 assert.ok(WATER_SURFACE_VERTEX.includes('world.y+=abyssSwell(world.xz,uSeaWaveTime).x-.1;'));
 assert.doesNotMatch(WATER_SURFACE_VERTEX,/world\.(?:x|z|xz)\s*[+\-]?=/);
});

test('terrain-based shore guard protects all sampled dry approaches including whole mesh triangles',()=>{
 const diagonal=WATER_OPTICS.surfaceSize/WATER_OPTICS.surfaceSegments*Math.SQRT2;
 assert.ok(WATER_SHORE_GUARD.cellMargin>=diagonal);
 let dryCount=0;
 for(const island of Object.values(ISLAND_LAYOUT))for(let r=0;r<1;r+=.02)for(let a=0;a<Math.PI*2;a+=.16){
  const x=island.x+Math.cos(a)*island.radiusX*r,z=island.z+Math.sin(a)*island.radiusZ*r;
  if(sampleIslandTerrain(x,z,terrainHeight)<=0)continue;
  dryCount++;assert.equal(waterWaveMask(x,z),0);
  // A camera-following vertex may be anywhere within this diagonal from a dry
  // point; every such vertex remains flat, so its triangle interpolation does.
  for(let b=0;b<Math.PI*2;b+=.24)assert.equal(waterWaveMask(x+Math.cos(b)*diagonal,z+Math.sin(b)*diagonal),0);
 }
 assert.ok(dryCount>2000);
 for(const p of [...ISLAND_SAFE_PATH,...ISLET_SAFE_PATH])if(sampleIslandTerrain(p.x,p.z,terrainHeight)>0)assert.equal(waterWaveMask(p.x,p.z),0);
 assert.ok(WATER_SURFACE_VERTEX.includes(WATER_SHORE_GLSL));assert.ok(WATER_SURFACE_FRAGMENT.includes(WATER_SHORE_GLSL));
 assert.equal(waterWaveMask(-180,-200),1);
});

test('surface, sky, and caustic materials share finite sea parameters with bounded resource work',()=>{
 const scene=new THREE.Scene(),world=createAbyssWorld(scene),sky=createIslandSky(scene),camera=new THREE.PerspectiveCamera();
 try{
  const surface=world.root.getObjectByName('Ocean surface / underside optics'),material=surface.material;
  const uniforms={...material.uniforms},geometry=surface.geometry,colliders=JSON.stringify(world.colliders),version=material.version,sea=world.seaState;
  camera.position.set(0,3,18);
  world.update(.1,120,{x:0,y:-3,z:18,status:'menu'});sky.update(.1,120,camera,{seaState:sea});
  assert.equal(world.stats.seaState,sea);assert.equal(sea.label,'Rough');assert.equal(sky.snapshot().seaSeverity,1);
  for(const [name,field]of Object.entries(SEA_UNIFORM_FIELDS)){
   assert.equal(material.uniforms[name].value,sea[field]);assert.equal(sky.root.material.uniforms[name].value,sea[field]);
  }
  let causticMaterial;world.root.traverse(n=>{if(n.material?.customProgramCacheKey().startsWith('abyss-caustics-water'))causticMaterial=n.material;});
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};causticMaterial.onBeforeCompile(shader);
  assert.doesNotMatch(shader.fragmentShader,/;#[a-z]/,'Three preprocessor directives retain a line boundary');
  assert.equal(shader.uniforms.uSeaSeverity,material.uniforms.uSeaSeverity);assert.equal(shader.uniforms.uSeaWaveTime,material.uniforms.uSeaWaveTime);
  assert.ok(shader.fragmentShader.includes('exp(min(vAbyssWorld.y,0.)/26.)'));
  assert.ok(shader.fragmentShader.includes('uAbyssCaustics*seaLight'));
  for(let i=0;i<240;i++){
   world.update(.1,i,{x:i/2,y:-3,z:-20,status:'menu'},['low','medium','high'][i%3]);
   for(const name in uniforms)assert.equal(material.uniforms[name],uniforms[name]);
  }
  assert.equal(surface.geometry,geometry);assert.equal(surface.material,material);assert.equal(material.version,version);
  assert.equal(geometry.index.count/3,8192);assert.ok(sky.snapshot().triangles<=1024);assert.equal(JSON.stringify(world.colliders),colliders);
  const frozen={...sea};world.update(0,120,{x:0,y:-3,z:18,status:'menu'});assert.deepEqual(sea,frozen);
  world.update(0,0,{x:0,y:-3,z:18,status:'menu'});assert.equal(sea.severity,0);assert.equal(material.uniforms.uTime.value,0);
  assert.equal(material.uniforms.uSeaWaveTime.value,0);assert.equal(world.seaState,sea);
  assert.ok(WATER_SURFACE_FRAGMENT.includes('octave<5'));assert.ok(WATER_SURFACE_FRAGMENT.includes('uSeaFoam*abyssWaveMask'));
 }finally{sky.dispose();world.dispose();}
});

test('rough weather dims shallow sunlight while its influence vanishes with depth and preserves torch contrast',()=>{
 const world=createAbyssWorld(new THREE.Scene());
 try{
  const read=(time,y,z)=>{world.update(.1,time,{x:0,y,z,status:'menu'});return{...world.stats.lighting};};
  const clear=read(0,-3,18),rough=read(120,-3,18);assert.ok(rough.sunlight<clear.sunlight*.7);
  const deepClear=read(0,-110,-260),deepRough=read(120,-110,-260);
  for(const key of ['ambient','sunlight','fill']){
   assert.ok(deepRough[key]<=deepClear[key]);assert.ok(deepRough[key]>deepClear[key]*.99);assert.ok(deepRough[key]<.15);
  }
  assert.equal(seaDepthAttenuation(-10),1);assert.ok(seaDepthAttenuation(110)<.015);
 }finally{world.dispose();}
});

test('legacy standalone water material and sky follow their provided clock without new caller arguments',()=>{
 const clock={value:0},material=createWaterSurfaceMaterial(clock,{value:new THREE.Color()},{value:1});
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),sky=createIslandSky(scene);camera.position.y=3;
 try{
  const reference=material.uniforms.uSeaWaveTime;clock.value=120;material.onBeforeRender();
  assert.equal(material.uniforms.uSeaSeverity.value,1);assert.equal(material.uniforms.uSeaWaveTime,reference);
  sky.update(.1,120,camera);assert.equal(sky.snapshot().seaSeverity,1);
  sky.update(0,200,camera);assert.equal(sky.snapshot().time,120);assert.equal(sky.snapshot().seaSeverity,1);
  sky.update(0,0,camera);assert.equal(sky.snapshot().seaSeverity,0);
  clock.value=0;material.onBeforeRender();assert.equal(material.uniforms.uSeaSeverity.value,0);
 }finally{material.dispose();sky.dispose();}
});
