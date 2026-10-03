// Optical math / actual Three resources / real r170 shader-injection contracts.
// These do not compile GLSL on a GPU or establish rendered visual quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { createAbyssWorld } from '../dist/abyss-world.js';
import {
  WATER_OPTICS, WATER_PATH_GLSL, WATER_SURFACE_VERTEX, WATER_SURFACE_FRAGMENT,
  waterTransmittance, waterFresnel, createWaterSurfaceMaterial
} from '../dist/abyss-water.js';

const surfaceOf=world=>world.root.getObjectByName('Ocean surface / underside optics');
const allMaterials=root=>{const out=new Set();root.traverse(n=>{if(n.material)out.add(n.material);});return [...out];};
const compileSource=material=>{
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  material.onBeforeCompile(shader);return shader;
};
const assertFinite=values=>values.forEach(x=>assert.ok(Number.isFinite(x),`${x} must be finite`));
function expandIncludes(source,stack=[]){
  return source.replace(/#include <([\w_]+)>/g,(_,name)=>{
    assert.equal(typeof THREE.ShaderChunk[name],'string',`r170 must provide ${name}`);
    assert.ok(!stack.includes(name),`include cycle at ${name}`);
    return expandIncludes(THREE.ShaderChunk[name],[...stack,name]);
  });
}

test('metre-scale absorption preserves nearby contrast and removes red before blue',()=>{
  assert.deepEqual(waterTransmittance(0,85,1.24),[1,1,1]);
  assert.deepEqual(waterTransmittance(-5),[1,1,1]);
  const near=waterTransmittance(3),far=waterTransmittance(65),deep=waterTransmittance(65,85,1.24);
  assert.ok(near.every(t=>t>.89),'nearby structures should keep most of their original light');
  assert.ok(far[0]<far[1]&&far[1]<far[2],'warm wavelengths attenuate first');
  assert.ok(far[1]>.2&&far[1]<.35,'distant water should haze without becoming a solid near wall');
  assert.ok(far[2]>.35&&far[2]<.5);
  for(let i=0;i<3;i++)assert.ok(deep[i]<far[i]&&far[i]<near[i]);
  const out=[0,0,0];assert.equal(waterTransmittance(12,24,1,out),out);
  let last=[1,1,1];
  for(let d=0;d<=350;d+=.5){
    const next=waterTransmittance(d,45,1.1);assertFinite(next);
    next.forEach((v,i)=>{assert.ok(v>=0&&v<=last[i]);});last=next;
  }
});

test('dielectric window has the water-to-air critical angle and bounded Fresnel energy',()=>{
  const eta=WATER_OPTICS.indexOfRefraction;
  const critical=Math.sqrt(1-1/(eta*eta));
  const degrees=Math.acos(critical)*180/Math.PI;
  assert.ok(degrees>48&&degrees<49);
  assert.ok(Math.abs(waterFresnel(1)-((eta-1)/(eta+1))**2)<1e-12);
  assert.ok(waterFresnel(1)>.019&&waterFresnel(1)<.021);
  assert.equal(waterFresnel(critical-.00001),1);
  assert.equal(waterFresnel(0),1);
  assert.ok(waterFresnel(critical+.04)>.1&&waterFresnel(critical+.04)<.4);
  let previous=1;
  for(let i=0;i<=2000;i++){
    const value=waterFresnel(i/2000);assert.ok(value>=0&&value<=1);
    assert.ok(value<=previous+1e-12,'reflectance falls toward normal incidence');previous=value;
  }
});

test('above-water surface uses air-to-water Fresnel without a false critical-angle cutoff',()=>{
  const eta=1/WATER_OPTICS.indexOfRefraction;
  const normalReflectance=((eta-1)/(eta+1))**2;
  assert.ok(Math.abs(waterFresnel(1,false)-normalReflectance)<1e-12);
  assert.ok(Math.abs(waterFresnel(1,false)-waterFresnel(1))<1e-12);
  let previous=1;
  for(let i=0;i<=2000;i++){
    const c=i/2000,k=1-eta*eta*(1-c*c),r=waterFresnel(c,false);
    assert.ok(k>0,'air-to-water refraction must have a real transmitted ray at every angle');
    assert.ok(Number.isFinite(r)&&r>=0&&r<=previous+1e-12);
    if(i>0)assert.ok(r<1,'only the grazing limit may reflect all incoming air-side light');
    previous=r;
  }
  const waterCritical=Math.sqrt(1-1/(WATER_OPTICS.indexOfRefraction**2));
  assert.equal(waterFresnel(waterCritical-.01),1);
  assert.ok(waterFresnel(waterCritical-.01,false)<.1,'the underwater critical angle must not darken the top face');
  const world=createAbyssWorld(new THREE.Scene());
  try{
    const surface=surfaceOf(world);surface.updateMatrixWorld(true);
    const frontNormal=new THREE.Vector3(0,0,1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(surface.matrixWorld));
    assert.ok(frontNormal.y>.999,'gl_FrontFacing must identify the air side of the actual surface');
  }finally{world.dispose();}
  assert.ok(WATER_SURFACE_FRAGMENT.includes('bool aboveWater=gl_FrontFacing;'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('interfaceNormal=aboveWater?-normal:normal'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes(`eta=aboveWater?1./${WATER_OPTICS.indexOfRefraction}:${WATER_OPTICS.indexOfRefraction}`));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('airRay=aboveWater?reflectedRay:refractedRay'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('transmission=aboveWater?vec3(1.):abyssWaterTransmittance'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('aboveWater?vec3(1.-fresnel):(1.-transmission)'));
});

test('surface uses finite wave/normal work, angular optics and the actual r170 output chunks',async()=>{
  assert.equal(THREE.REVISION,'170');
  assert.deepEqual(WATER_OPTICS.normalOctaves,[3,4,5]);
  assert.ok(WATER_OPTICS.surfaceSegments**2*2<=12000);
  assert.ok(WATER_SURFACE_VERTEX.includes('abyssSwell(world.xz,uSeaWaveTime)'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('octave<5'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('float(octave)>=uWaterOctaves'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('dFdx(vWaterWorld.xz)'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('dFdy(vWaterWorld.xz)'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('smoothstep(.22,.9,footprint*frequency*1.25)'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('dot(ray,interfaceNormal)'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('reflect(ray,normal)'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes('sqrt(max(k,.0001))'));
  assert.ok(WATER_SURFACE_FRAGMENT.includes(WATER_PATH_GLSL));
  assert.ok(WATER_PATH_GLSL.includes(`vec3(${WATER_OPTICS.extinction.join(',')})`));
  const output=expandIncludes(WATER_SURFACE_FRAGMENT);
  assert.ok(output.includes('toneMapping( gl_FragColor.rgb )'));
  assert.ok(output.includes('linearToOutputTexel( gl_FragColor )'));
  assert.ok(output.indexOf('radiance*transmission')<output.indexOf('toneMapping( gl_FragColor.rgb )'));
  assert.ok(output.indexOf('toneMapping( gl_FragColor.rgb )')<output.indexOf('gl_FragColor.rgb+=uWaterScatter'));
  assert.ok(output.indexOf('gl_FragColor.rgb+=uWaterScatter')<output.indexOf('linearToOutputTexel'));
  assert.ok(!output.includes('#include'));
  const module=await readFile(new URL('../dist/abyss-water.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/new THREE\.(?:\w*RenderTarget|Texture|TextureLoader|CubeCamera)|texture2D\(|sampler2D|fetch\(/);
});

test('standard materials apply one shared eye path before output conversion, without double fog',()=>{
  const world=createAbyssWorld(new THREE.Scene());
  try{
    const surface=surfaceOf(world),uniforms=surface.material.uniforms;
    const materials=allMaterials(world.root).filter(m=>m.customProgramCacheKey().startsWith('abyss-caustics-water'));
    assert.ok(materials.length>=8);
    for(const material of materials){
      const shader=compileSource(material);
      assert.equal(shader.uniforms.uWaterScatter,uniforms.uWaterScatter);
      assert.equal(shader.uniforms.uWaterDensity,uniforms.uWaterDensity);
      assert.equal(shader.uniforms.uAbyssTime,uniforms.uTime);
      assert.ok(shader.vertexShader.includes('instanceMatrix*abyssPosition'));
      assert.ok(shader.fragmentShader.includes('length(cameraPosition-vAbyssWorld)'));
      assert.ok(shader.fragmentShader.includes('-(cameraPosition.y+vAbyssWorld.y)*.5'));
      assert.ok(shader.fragmentShader.includes('outgoingLight*=waterTransmission;'));
      assert.equal((shader.fragmentShader.match(/uniform vec3 uWaterScatter/g)||[]).length,1);
      assert.ok(!shader.fragmentShader.includes('#include <fog_fragment>'));
      const expanded=expandIncludes(shader.fragmentShader);
      assert.ok(!expanded.includes('float fogFactor'));
      assert.ok(expanded.indexOf('outgoingLight*=waterTransmission')<expanded.indexOf('toneMapping( gl_FragColor.rgb )'));
      assert.ok(expanded.indexOf('gl_FragColor.rgb+=uWaterScatter')<expanded.indexOf('linearToOutputTexel'));
      expandIncludes(shader.vertexShader);
    }
  }finally{world.dispose();}
});

test('surface covers the camera far radius at every map corner without changing gameplay colliders',()=>{
  const world=createAbyssWorld(new THREE.Scene());
  try{
    const surface=surfaceOf(world),geometry=surface.geometry,colliders=[...world.colliders];
    assert.equal(geometry.index.count/3,8192);
    assert.equal(world.stats.surfaceTriangles,8192);
    assert.ok(geometry.parameters.width/2>330,'patch covers the existing camera far plane');
    assert.equal(surface.material.depthTest,true);assert.equal(surface.material.depthWrite,true);
    assert.equal(surface.material.transparent,false);assert.equal(surface.material.fog,false);
    assert.equal(surface.material.side,THREE.DoubleSide);
    for(const x of [world.bounds.minX,0,world.bounds.maxX])for(const z of [world.bounds.minZ,world.bounds.maxZ]){
      world.update(.016,1,{x,y:-.8,z});
      assert.equal(surface.position.x,x);assert.equal(surface.position.z,z);assert.equal(surface.position.y,.1);
      assert.equal(surface.geometry,geometry);assert.deepEqual(world.colliders,colliders);
    }
    assertFinite(geometry.attributes.position.array);
    assert.ok(geometry.boundingSphere.radius>Math.SQRT2*360);
  }finally{world.dispose();}
});

test('quality tiers change bounded normal octaves in place, without shader recompiles or texture work',()=>{
  const world=createAbyssWorld(new THREE.Scene());
  try{
    const surface=surfaceOf(world),material=surface.material,geometry=surface.geometry;
    const uniforms=material.uniforms,octaves=uniforms.uWaterOctaves,version=material.version;
    for(const [i,q] of ['low','medium','high','low','high'].entries()){
      world.setQuality(q);const count=WATER_OPTICS.normalOctaves[q==='low'?0:q==='medium'?1:2];
      assert.equal(uniforms.uWaterOctaves,octaves);assert.equal(octaves.value,count);
      assert.equal(world.stats.surfaceNormalOctaves,count);
      assert.equal(surface.material,material);assert.equal(surface.geometry,geometry);
      assert.equal(material.version,version,'uniform quality change must not invalidate the program');
      assert.equal(geometry.index.count/3,8192);
      for(const uniform of Object.values(uniforms))assert.ok(!uniform.value?.isTexture);
    }
  }finally{world.dispose();}
});

test('depth lighting and blue distant haze remain coherent, finite and stable through 1200 updates',()=>{
  const scene=new THREE.Scene(),world=createAbyssWorld(scene);
  try{
    const surface=surfaceOf(world),uniforms=surface.material.uniforms;
    const refs=Object.fromEntries(Object.entries(uniforms));
    const scatter=uniforms.uWaterScatter.value;
    const near=waterTransmittance(2,3),originalMaterials=allMaterials(world.root);
    world.update(0,0,{x:0,y:-4,z:18});
    const shallow=scatter.toArray(),shallowDensity=uniforms.uWaterDensity.value;
    assert.ok(shallow[2]>shallow[1]&&shallow[1]>shallow[0]);
    world.update(0,0,{x:0,y:-78,z:-205});
    const deep=scatter.toArray();
    deep.forEach((v,i)=>assert.ok(v<shallow[i]));
    assert.ok(uniforms.uWaterDensity.value>shallowDensity);
    assert.ok(near.every(v=>v>.92));
    for(let i=0;i<1200;i++){
      const p={x:Math.sin(i*.04)*210,y:-.8-(i%780)/10,z:80-(i%310)};
      world.update(1/60,i/60,p,['low','medium','high'][i%3]);
      assert.equal(uniforms.uWaterScatter.value,scatter);
      assert.deepEqual(scene.fog.color.toArray(),scatter.toArray());
      assert.deepEqual(scene.background.toArray(),scatter.toArray());
      assertFinite([...scatter.toArray(),uniforms.uTime.value,uniforms.uWaterDensity.value,uniforms.uWaterOctaves.value]);
      for(const name of Object.keys(refs))assert.equal(uniforms[name],refs[name]);
    }
    assert.deepEqual(allMaterials(world.root),originalMaterials);
    const p={x:24,y:-22,z:-40};world.update(0,27,p,'medium');
    const frozen=[...scatter.toArray(),uniforms.uTime.value,uniforms.uWaterDensity.value,...surface.position.toArray()];
    for(let i=0;i<120;i++)world.update(0,27,p,'medium');
    assert.deepEqual([...scatter.toArray(),uniforms.uTime.value,uniforms.uWaterDensity.value,...surface.position.toArray()],frozen);
  }finally{world.dispose();}
});

test('surface resources dispose exactly once and release no external caller resources',()=>{
  const clock={value:1},scatter={value:new THREE.Color(0x168cc0)},density={value:1};
  const standalone=createWaterSurfaceMaterial(clock,scatter,density);
  assert.equal(standalone.uniforms.uTime,clock);assert.equal(standalone.uniforms.uWaterScatter,scatter);
  standalone.dispose();assert.equal(scatter.value.getHex(),0x168cc0);
  const scene=new THREE.Scene(),originalFog=new THREE.FogExp2(0x123456,.03),originalBackground=new THREE.Color(0x123456);
  scene.fog=originalFog;scene.background=originalBackground;
  const world=createAbyssWorld(scene),surface=surfaceOf(world);let geometry=0,material=0;
  surface.geometry.addEventListener('dispose',()=>geometry++);surface.material.addEventListener('dispose',()=>material++);
  const time=surface.material.uniforms.uTime.value;
  world.dispose();world.dispose();world.update(.2,123,{x:1,y:-30,z:3});
  assert.equal(geometry,1);assert.equal(material,1);assert.equal(surface.material.uniforms.uTime.value,time);
  assert.equal(scene.fog,originalFog);assert.equal(scene.background,originalBackground);
});
