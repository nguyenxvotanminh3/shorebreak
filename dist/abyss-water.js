import * as THREE from './vendor/three.module.js';
import {ISLAND_LAYOUT} from './abyss-island-terrain.js';
import {SEA_UNIFORMS_GLSL,createSeaUniforms,updateSeaUniforms,sampleSeaState} from './abyss-sea-state.js';

// Art-directed single-pass optics, in metres. These approximate an ocean light
// field: no captured scene reflection/refraction, no screen-space render target.
export const WATER_OPTICS = Object.freeze({
  indexOfRefraction: 1.333,
  extinction: Object.freeze([.038, .020, .014]),
  normalOctaves: Object.freeze([3, 4, 5]),
  surfaceSize: 720,
  surfaceSegments: 64
});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const gl=x=>Number.isInteger(x)?`${x}.0`:String(x);
const extinction=`vec3(${WATER_OPTICS.extinction.map(gl).join(',')})`;
const ior=gl(WATER_OPTICS.indexOfRefraction);

// Numerical counterparts used by the optical-contract tests. Output arrays may
// be reused; the render update only mutates existing uniforms, never calls these.
export function waterTransmittance(distance,meanDepth=0,density=1,out=[0,0,0]){
  const path=Math.max(0,distance)*Math.max(0,density)*(1+.45*smooth(8,85,meanDepth));
  for(let i=0;i<3;i++)out[i]=Math.exp(-WATER_OPTICS.extinction[i]*path);
  return out;
}
export function waterFresnel(cosine,fromWater=true){
  const c=clamp(cosine,0,1),eta=fromWater?WATER_OPTICS.indexOfRefraction:1/WATER_OPTICS.indexOfRefraction;
  const k=1-eta*eta*(1-c*c);
  if(k<=0)return 1;
  const t=Math.sqrt(k),rs=(eta*c-t)/(eta*c+t),rp=(c-eta*t)/(c+eta*t);
  return .5*(rs*rs+rp*rp);
}

export const WATER_PATH_GLSL=`
  uniform vec3 uWaterScatter;
  uniform float uWaterDensity;
  vec3 abyssWaterTransmittance(float distanceToEye,float meanDepth){
    float path=max(0.,distanceToEye)*uWaterDensity*(1.+.45*smoothstep(8.,85.,meanDepth));
    return exp(-${extinction}*path);
  }
`;

// Dry terrain is entirely inside these conservative profile radii. Add a full
// surface-cell diagonal before allowing displacement: even a triangle spanning
// a beach cannot interpolate an offshore crest across the dry path. These zones
// are anchored to terrain world coordinates, independent of the viewer.
export const WATER_SHORE_GUARD=Object.freeze({main:.90,islet:.88,cellMargin:16,fade:24,buoyRadius:22,buoyFade:20});
export function waterWaveMask(x,z){
  let mask=1;
  for(const [name,island] of Object.entries(ISLAND_LAYOUT)){
    const r=Math.hypot((x-island.x)/island.radiusX,(z-island.z)/island.radiusZ);
    const distance=(r-WATER_SHORE_GUARD[name])*Math.min(island.radiusX,island.radiusZ);
    mask=Math.min(mask,smooth(WATER_SHORE_GUARD.cellMargin,WATER_SHORE_GUARD.cellMargin+WATER_SHORE_GUARD.fade,distance));
  }
  return mask*smooth(WATER_SHORE_GUARD.buoyRadius,WATER_SHORE_GUARD.buoyRadius+WATER_SHORE_GUARD.buoyFade,Math.hypot(x,z-18));
}
export function sampleSeaHeight(x,z,state=sampleSeaState(0)){
  const mask=waterWaveMask(x,z);if(mask===0)return 0;
  const q=1/state.wavelength,t=state.waveTime;
  return mask*state.amplitude*(
    .52*Math.sin((x*.065+z*.032)*q+t*.72)+
    .31*Math.sin((-x*.028+z*.089)*q-t*.57)+
    .17*Math.sin((x*.127-z*.051)*q+t*.43));
}
const shoreZones=Object.entries(ISLAND_LAYOUT).map(([name,i])=>`
    d=(length((p-vec2(${gl(i.x)},${gl(i.z)}))/vec2(${gl(i.radiusX)},${gl(i.radiusZ)}))-${gl(WATER_SHORE_GUARD[name])})*${gl(Math.min(i.radiusX,i.radiusZ))};
    mask=min(mask,smoothstep(${gl(WATER_SHORE_GUARD.cellMargin)},${gl(WATER_SHORE_GUARD.cellMargin+WATER_SHORE_GUARD.fade)},d));`).join('');
export const WATER_SHORE_GLSL=`
  float abyssWaveMask(vec2 p){
    float mask=1.,d;${shoreZones}
    return mask*smoothstep(${gl(WATER_SHORE_GUARD.buoyRadius)},${gl(WATER_SHORE_GUARD.buoyRadius+WATER_SHORE_GUARD.buoyFade)},length(p-vec2(0.,18.)));
  }
`;
const SWELL_GLSL=`
  ${SEA_UNIFORMS_GLSL}
  ${WATER_SHORE_GLSL}
  // Only three low-frequency vertical bands, with the original mesh budget.
  vec3 abyssSwell(vec2 p,float t){
    float frequency=1./uSeaWavelength;
    vec3 phase=vec3(dot(p,vec2(.065,.032))*frequency+t*.72,
                    dot(p,vec2(-.028,.089))*frequency-t*.57,
                    dot(p,vec2(.127,-.051))*frequency+t*.43);
    vec3 s=sin(phase),c=cos(phase);
    float strength=uSeaAmplitude*abyssWaveMask(p);
    return vec3(dot(s,vec3(.52,.31,.17)),
      dot(c,vec3(.0338,-.00868,.02159))*frequency,
      dot(c,vec3(.01664,.02759,-.00867))*frequency)*strength;
  }
`;

export const WATER_SURFACE_VERTEX=`
  uniform float uTime;
  varying vec3 vWaterWorld;
  ${SWELL_GLSL}
  void main(){
    vec3 world=(modelMatrix*vec4(position,1.)).xyz;
    // The source patch retains its .1 m placement; the visual mean is sea level.
    world.y+=abyssSwell(world.xz,uSeaWaveTime).x-.1;
    vWaterWorld=world;
    gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
  }
`;

export const WATER_SURFACE_FRAGMENT=`
  uniform float uTime;
  uniform float uWaterOctaves;
  varying vec3 vWaterWorld;
  ${WATER_PATH_GLSL}
  ${SWELL_GLSL}
  float abyssHash(vec2 p){
    vec3 q=fract(vec3(p.xyx)*.1031);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  // Value AND analytic spatial derivative; no four extra height samples for
  // every normal. Anisotropy makes wind-aligned, irregular broken wave facets.
  vec3 abyssNoiseGradient(vec2 p){
    vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
    float a=abyssHash(i),b=abyssHash(i+vec2(1.,0.));
    float c=abyssHash(i+vec2(0.,1.)),d=abyssHash(i+vec2(1.,1.));
    float n=mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    return vec3(n*2.-1.,2.*du.x*mix(b-a,d-c,u.y),2.*du.y*mix(c-a,d-b,u.x));
  }
  vec3 abyssSurfaceNormal(vec2 p,float footprint){
    // Wind axes, not circular rings. Different advection rates break up an
    // otherwise static noise sheet, while world coordinates prevent swimming.
    mat2 wind=mat2(.94,-.341174,.341174,.94);
    vec2 q=wind*p;
    vec2 slope=vec2(0.);
    float frequency=1.,weight=.54;
    for(int octave=0;octave<5;octave++){
      if(float(octave)>=uWaterOctaves)break;
      float detail=1.-smoothstep(.22,.9,footprint*frequency*1.25);
      if(detail>.001){
        vec2 drift=vec2(.075,-.11)*uSeaWaveTime*(1.+float(octave)*.17);
        vec3 band=abyssNoiseGradient(q*vec2(.38,1.25)*frequency+drift+float(octave)*vec2(13.7,7.3));
        slope+=band.yz*vec2(.38,1.25)*(weight*detail);
      }
      frequency*=2.07;
      weight*=.56;
    }
    // Transpose of wind carries the height gradient back to world X/Z.
    vec2 worldSlope=vec2(.94*slope.x-.341174*slope.y,.341174*slope.x+.94*slope.y);
    worldSlope*=mix(.20,1.22,uSeaWind)*mix(.34,1.,abyssWaveMask(p));
    worldSlope+=abyssSwell(p,uSeaWaveTime).yz;
    return normalize(vec3(-worldSlope.x,1.,-worldSlope.y));
  }
  float abyssDielectricFresnel(float c,float k,float eta){
    float transmitted=sqrt(max(k,0.));
    float rs=(eta*c-transmitted)/max(eta*c+transmitted,.0001);
    float rp=(c-eta*transmitted)/max(c+eta*transmitted,.0001);
    return clamp(.5*(rs*rs+rp*rp),0.,1.);
  }
  void main(){
    vec3 toSurface=vWaterWorld-cameraPosition;
    float distanceToEye=max(length(toSurface),.001);
    vec3 ray=toSurface/distanceToEye;
    float footprint=max(length(dFdx(vWaterWorld.xz)),length(dFdy(vWaterWorld.xz)));
    vec3 normal=abyssSurfaceNormal(vWaterWorld.xz,footprint);
    // The plane's front face points toward air. Use geometric sidedness so a
    // rippled shading normal cannot incorrectly flip the incident medium.
    bool aboveWater=gl_FrontFacing;
    vec3 interfaceNormal=aboveWater?-normal:normal;
    float eta=aboveWater?1./${ior}:${ior};
    float c=clamp(dot(ray,interfaceNormal),.0001,1.);
    float k=1.-eta*eta*(1.-c*c);
    float fresnel=abyssDielectricFresnel(c,k,eta);
    // Snell's window follows VIEW ANGLE and is rippled by local normals. The
    // small derivative-width transition avoids a hard aliased critical circle.
    float edge=max(.012,fwidth(k)*1.1);
    float window=smoothstep(-edge,edge,k)*(1.-fresnel);
    vec3 reflectedRay=reflect(ray,normal);
    vec3 refractedRay=normalize(eta*ray+(sqrt(max(k,.0001))-eta*c)*interfaceNormal);
    vec3 airRay=aboveWater?reflectedRay:refractedRay;
    float elevation=clamp(airRay.y,0.,1.);
    vec3 sky=mix(vec3(.68,.93,1.04),vec3(.25,.66,.98),sqrt(elevation));
    // Broad, non-repeating overcast variation, refracted by the wave normals.
    vec2 skyUV=airRay.xz/max(.22,airRay.y);
    float cloud=abyssNoiseGradient(skyUV*1.8+vec2(uSeaWaveTime*.006,0.)).x;
    sky=mix(sky,vec3(.40,.54,.63),uSeaSeverity*.48);
    sky=mix(sky,vec3(.75,.83,.86),smoothstep(.30-uSeaCloud,.85-uSeaCloud,cloud)*(.25+uSeaCloud*.60));
    sky*=uSeaLight;
    vec3 sunDirection=normalize(vec3(-.28,.93,-.22));
    float sun=max(dot(airRay,sunDirection),0.);
    float silver=pow(sun,220.);
    sky+=vec3(.63,.79,.82)*(pow(sun,10.)*.48+silver*2.1)*(1.-uSeaCloud*.86);
    // Analytical below-water radiance, not a claim of a scene reflection.
    // Total internal reflection is darker and blue-gray outside the window.
    float grazing=pow(clamp(1.-abs(reflectedRay.y),0.,1.),2.);
    vec3 reflected=mix(vec3(.009,.031,.051),vec3(.033,.125,.19),grazing);
    reflected*=.82+.18*normal.y;
    vec3 radiance=aboveWater?sky*fresnel:mix(reflected,sky,window);
    // Broken crest foam uses existing analytic noise, with no texture or pass.
    float crest=abyssSwell(vWaterWorld.xz,uSeaWaveTime).x/max(.001,uSeaAmplitude);
    float breakup=abyssNoiseGradient(vWaterWorld.xz*.33+vec2(uSeaWaveTime*.14,0.)).x;
    float whitecap=smoothstep(.32,.82,crest)*smoothstep(-.4,.55,breakup)*uSeaFoam*abyssWaveMask(vWaterWorld.xz);
    radiance=mix(radiance,vec3(.76,.88,.89)*uSeaLight,whitecap*(aboveWater?1.:.18));
    float meanDepth=max(0.,-cameraPosition.y)*.5;
    vec3 transmission=aboveWater?vec3(1.):abyssWaterTransmittance(distanceToEye,meanDepth);
    gl_FragColor=vec4(radiance*transmission,1.);
    #include <tonemapping_fragment>
    // Shared, display-linear scattered light keeps the finite surface, scene
    // background and fallback FogExp2 on other actors the same far-water hue.
    // Above water, transmitted radiance is the existing analytic water-light
    // field, not captured underwater objects. The eye-to-surface path is air.
    gl_FragColor.rgb+=uWaterScatter*(aboveWater?vec3(1.-fresnel):(1.-transmission));
    #include <colorspace_fragment>
  }
`;

export function createWaterSurfaceMaterial(clock,scatter,density,seaUniforms){
  const ownState=seaUniforms?null:sampleSeaState(clock.value);
  seaUniforms=seaUniforms||createSeaUniforms(ownState);
  const material=new THREE.ShaderMaterial({
    name:'Abyss / refracted sky and underside waves',side:THREE.DoubleSide,
    depthTest:true,depthWrite:true,fog:false,
    uniforms:{uTime:clock,uWaterScatter:scatter,uWaterDensity:density,uWaterOctaves:{value:4},...seaUniforms},
    vertexShader:WATER_SURFACE_VERTEX,fragmentShader:WATER_SURFACE_FRAGMENT
  });
  // Preserve standalone three-argument callers: their existing clock still
  // animates the water. World-owned callers provide shared in-place uniforms.
  if(ownState)material.onBeforeRender=()=>updateSeaUniforms(seaUniforms,sampleSeaState(clock.value,ownState));
  return material;
}
