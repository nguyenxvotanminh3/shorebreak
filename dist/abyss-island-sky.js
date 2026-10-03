import * as THREE from './vendor/three.module.js';
import {createSeaStateController,createSeaUniforms,updateSeaUniforms,SEA_UNIFORMS_GLSL} from './abyss-sea-state.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** Called after the water world restores its current fog/background each frame.
 * One small sky shell only above water; no reflection target or downloaded sky.
 */
export function createIslandSky(scene){
 const seaController=createSeaStateController(),seaUniforms=createSeaUniforms(seaController.state);
 const clock={value:0},alpha={value:0},airFog=new THREE.Color(0xb2d0d9),clearFog=airFog.clone(),stormFog=new THREE.Color(0x7c969f);
 const geometry=new THREE.SphereGeometry(305,32,16),material=new THREE.ShaderMaterial({
  name:'Island / daylight hemisphere',side:THREE.BackSide,transparent:true,depthTest:true,depthWrite:false,fog:false,
  uniforms:{uTime:clock,uAir:alpha,...seaUniforms},vertexShader:`varying vec3 vSkyDirection;void main(){vSkyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`${SEA_UNIFORMS_GLSL}
uniform float uTime;uniform float uAir;varying vec3 vSkyDirection;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
  void main(){vec3 d=normalize(vSkyDirection);float h=clamp(d.y,0.,1.);vec3 sky=mix(vec3(.45,.65,.72),vec3(.12,.32,.58),sqrt(h));
  vec2 uv=d.xz/max(.18,d.y)+vec2(uSeaWaveTime*.006,0.);float cloud=noise(uv*1.7)*.68+noise(uv*3.8)*.32;sky=mix(sky,vec3(.38,.48,.54),uSeaSeverity*.48);sky=mix(sky,vec3(.75,.83,.86),smoothstep(.65-uSeaCloud*.4,.85-uSeaCloud*.3,cloud)*smoothstep(0.,.25,h)*(.35+uSeaCloud*.5));sky*=uSeaLight;
  float sun=pow(max(0.,dot(d,normalize(vec3(-.28,.93,-.22)))),280.);sky+=vec3(1.,.86,.58)*sun*.65*(1.-uSeaCloud*.86);
  gl_FragColor=vec4(sky,uAir);#include <tonemapping_fragment>
  #include <colorspace_fragment>}`.replace(';#include',';\n#include')
 });
 const root=new THREE.Mesh(geometry,material);root.name='Island daylight sky';root.frustumCulled=false;root.renderOrder=-1000;root.visible=false;scene.add(root);
 let disposed=false;
 function update(dt,time,camera,context={}){
  if(disposed)return;const h=camera.position.y,t=clamp((h+.1)/.7,0,1);alpha.value=context.indoors?0:t*t*(3-2*t);root.visible=alpha.value>.001;
  root.position.copy(camera.position);if((dt>0||time===0)&&Number.isFinite(time))clock.value=Math.max(0,time);
  const sea=context.seaState||seaController.update(dt,clock.value,Math.max(0,-h));updateSeaUniforms(seaUniforms,sea);airFog.copy(clearFog).lerp(stormFog,sea.severity);
  if(alpha.value>0){if(scene.fog){scene.fog.color.lerp(airFog,alpha.value);if(scene.fog.isFogExp2)scene.fog.density+=(.0018-scene.fog.density)*alpha.value;}if(scene.background?.isColor)scene.background.copy(scene.fog?.color||airFog);}
 }
 function dispose(){if(disposed)return;disposed=true;root.removeFromParent();geometry.dispose();material.dispose();}
 return{root,update,dispose,snapshot:()=>({disposed,visible:root.visible,air:alpha.value,time:clock.value,seaSeverity:seaUniforms.uSeaSeverity.value,triangles:geometry.index.count/3})};
}
