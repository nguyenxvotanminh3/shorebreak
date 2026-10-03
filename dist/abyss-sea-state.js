// One deterministic weather clock drives the surface, sky, and underwater light.
// Sampling is pure; time is simulation time, never wall time or random weather.
export const SEA_CYCLE_SECONDS=240;
export const SEA_REVIEW_TIMES=Object.freeze({calm:0,moderate:60,rough:120,returning:180});
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function seaDepthAttenuation(depth){return Math.exp(-Math.max(0,Number.isFinite(depth)?depth:0)/26);}
export function sampleSeaState(time=0,out={},depth=0){
 const t=Number.isFinite(time)&&Math.abs(time)<1e12?Math.max(0,time):0;
 const phase=(t%SEA_CYCLE_SECONDS)/SEA_CYCLE_SECONDS,angle=phase*TAU;
 const severity=(1-Math.cos(angle))*.5;
 out.time=t;out.phase=phase;out.severity=severity;
 out.label=severity<.25?'Calm':severity>.75?'Rough':'Moderate';
 out.amplitude=.18+severity*1.72; // Absolute vertical swell bound, metres.
 out.wavelength=1.16-severity*.24;out.speed=.60+severity*.80;
 out.wind=.18+severity*.82;out.foam=clamp((severity-.3)/.7,0,1)*.70;
 out.cloud=.14+severity*.70;out.light=1-severity*.38;
 // Integral of speed: changing wind cannot reverse or abruptly jump wave phase.
 out.waveTime=t-.4*SEA_CYCLE_SECONDS/TAU*Math.sin(angle);
 out.depthAttenuation=seaDepthAttenuation(depth);
 return out;
}
export function createSeaStateController(initialTime=0){
 const state=sampleSeaState(initialTime);
 return{state,update(dt,time,depth=0){
  if(Number.isFinite(time)&&time===0&&state.time!==0)return sampleSeaState(0,state,depth);
  if(Number.isFinite(dt)&&dt>0)return sampleSeaState(Number.isFinite(time)?time:state.time+dt,state,depth);
  state.depthAttenuation=seaDepthAttenuation(depth);return state;
 },reset(time=0){return sampleSeaState(time,state);}};
}
// Plain uniform objects are shared in place; this module needs no renderer.
export const SEA_UNIFORM_FIELDS=Object.freeze({uSeaSeverity:'severity',uSeaAmplitude:'amplitude',uSeaWavelength:'wavelength',uSeaSpeed:'speed',uSeaWind:'wind',uSeaFoam:'foam',uSeaCloud:'cloud',uSeaLight:'light',uSeaWaveTime:'waveTime'});
export const SEA_UNIFORMS_GLSL=Object.keys(SEA_UNIFORM_FIELDS).map(name=>`uniform float ${name};`).join('\n')+'\n';
export function createSeaUniforms(state=sampleSeaState(0)){
 const uniforms={};for(const [name,field]of Object.entries(SEA_UNIFORM_FIELDS))uniforms[name]={value:state[field]};return uniforms;
}
export function updateSeaUniforms(uniforms,state){
 for(const name in SEA_UNIFORM_FIELDS)uniforms[name].value=state[SEA_UNIFORM_FIELDS[name]];
 return uniforms;
}
