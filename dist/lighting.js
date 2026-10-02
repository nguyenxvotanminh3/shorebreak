import * as THREE from './vendor/three.module.js';

// One shadow-casting light only. Keep the shadow volume near the rider rather
// than stretching it across an endless ocean (which destroys useful resolution).
export function createLighting(scene, renderer) {
  const sky = new THREE.HemisphereLight(0xc7e4f2, 0x173f43, 1.15);
  const sun = new THREE.DirectionalLight(0xffdfb2, 3.15);
  const rim = new THREE.DirectionalLight(0x8fcddd, .65);
  scene.add(sky, sun, sun.target, rim, rim.target);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 47;
  sun.shadow.camera.bottom = -47;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -.00018;
  sun.shadow.normalBias = .035;
  sun.shadow.radius = 2;
  let tier = -1;
  function quality(next) {
    if (next === tier) return;
    tier = next;
    const size = tier === 2 ? 2048 : 1024;
    renderer.shadowMap.enabled = tier > 0;
    sun.castShadow = tier > 0;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.set(size, size);
    }
    renderer.shadowMap.needsUpdate = true;
  }
  function update(x, z) {
    const texel = 68 / sun.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round((z - 26) / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx - 42, 65, sz - 38);
    rim.target.position.set(x, 2, z - 18);
    rim.position.set(x + 35, 22, z + 28);
  }
  quality(1); update(0, 0);
  return { quality, update, inspect: () => ({ shadows: tier > 0, mapSize: sun.shadow.mapSize.x, lights: 3 }) };
}

// Cheap, wave-conforming contact shade complements self-shadow maps. Unlike a
// flat decal, every vertex follows exactly the same travelling wave as water.js.
// Geometry is shared and reused; no render-target/texture allocations per frame.
const contactGeometry = new THREE.PlaneGeometry(2, 2, 12, 12).rotateX(-Math.PI / 2);
const contactVertex = `uniform float uTime; varying vec2 vUv;
void main(){vUv=uv;vec4 p=modelMatrix*vec4(position,1.);
float w=p.x*.23+p.z*.035-uTime*.72,a=p.x*.105+p.z*.18-uTime*1.18,b=p.x*.42-p.z*.31-uTime*1.83,c=p.x*.75+p.z*.64-uTime*2.5;
p.y=2.05*sin(w)+.44*sin(2.*w)+.26*sin(a)+.12*sin(b)+.055*sin(c)+.065;
gl_Position=projectionMatrix*viewMatrix*p;}`;
const contactFragment = `uniform float uOpacity;varying vec2 vUv;
void main(){float r=length(vUv*2.-1.);float a=(1.-smoothstep(.12,1.,r))*uOpacity;
gl_FragColor=vec4(.012,.033,.034,a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export function createWaterContact(scene, rx, rz, opacity = .26) {
  const uniforms = {uTime:{value:0},uOpacity:{value:opacity}};
  const material = new THREE.ShaderMaterial({uniforms,vertexShader:contactVertex,fragmentShader:contactFragment,transparent:true,depthWrite:false});
  const mesh = new THREE.Mesh(contactGeometry, material);
  mesh.scale.set(rx, 1, rz);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  scene.add(mesh);
  return {mesh, update(x,z,t,strength=1){mesh.position.set(x,0,z);uniforms.uTime.value=t;uniforms.uOpacity.value=opacity*strength;}};
}
