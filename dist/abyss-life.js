import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { terrainHeight } from './abyss-world.js';
import { CREATURE_STEP, createCreatureLocomotion } from './abyss-locomotion.js';
import { createSharkMotion } from './abyss-shark-motion.js';
import { createKrakenMotion } from './abyss-kraken-motion.js';
import { createWardenMotion } from './abyss-warden-motion.js';
import { createJellyfishColony } from './abyss-jellyfish.js';
import { createInkDefense } from './abyss-ink-defense.js';
import { createInkClouds } from './abyss-ink-cloud.js';

const TAU = Math.PI * 2;
const creatureDefs = [
  { id: 'shark', name: 'REEFBREAKER', center: [-9,-20,-46], scale: .5595, radius: 2.2, orbit: [28,7,22], range: 110, near: 30, low: 'shark-lod.glb', high: 'shark.glb' },
  { id: 'kraken', name: 'ABYSSAL REGENT', center: [59,0,-114], scale: 1.6, radius: 5.3, orbit: [12,3,11], range: 125, near: 38, low: 'kraken-lod.glb', high: 'kraken.glb' },
  { id: 'warden', name: 'ABYSSAL WARDEN', center: [-49,0,-193], scale: 3.707615, radius: 8, orbit: [15,4,8], range: 140, near: 52, low: 'warden-lod.glb', high: 'warden.glb' }
];

function createFishGeometry() {
  const positions = [], colors = [], indices = [], color = new THREE.Color();
  const ringCount = 9, sides = 8;
  for (let ring = 0; ring < ringCount; ring++) {
    const t = ring / (ringCount - 1), z = -.48 + t * .87;
    const width = .145 * Math.pow(Math.sin(t * Math.PI), .8) + .004;
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * TAU;
      positions.push(Math.cos(angle) * width, Math.sin(angle) * width * .82, z);
      color.setHex(Math.sin(angle) > .12 ? 0x559ca7 : 0xc3e5d6); colors.push(color.r, color.g, color.b);
      if (ring < ringCount - 1) { const a=ring*sides+j,b=ring*sides+(j+1)%sides,c=a+sides,d=b+sides; indices.push(a,c,b,b,c,d); }
    }
  }
  const triangle=(a,b,c,hex)=>{const start=positions.length/3;color.setHex(hex);for(const v of [a,b,c]){positions.push(...v);colors.push(color.r,color.g,color.b);}indices.push(start,start+1,start+2);};
  // A vertical caudal blade and paired pectorals. They share the body draw.
  triangle([0,0,.34],[0,.23,.65],[0,.01,.55],0x548b9d);
  triangle([0,0,.34],[0,.01,.55],[0,-.21,.65],0x548b9d);
  triangle([-.10,-.025,-.04],[-.29,-.06,.16],[-.09,-.045,.16],0x749fac);
  triangle([.10,-.025,-.04],[.09,-.045,.16],[.29,-.06,.16],0x749fac);
  triangle([0,.11,-.02],[0,.29,.09],[0,.095,.23],0x548b9d);
  // Tiny dark eyes are built into the same shared vertex-colored geometry.
  for(const sign of [-1,1]){
    const x=sign*.069,y=.037,z=-.32,r=.017;
    triangle([x,y+r,z],[x+sign*.01,y,z-r],[x,y-r,z],0x122730);
    triangle([x,y-r,z],[x+sign*.01,y,z+r],[x,y+r,z],0x122730);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const phases=new Float32Array(42);for(let i=0;i<phases.length;i++)phases[i]=i*2.399963;
  geometry.setAttribute('aFishPhase',new THREE.InstancedBufferAttribute(phases,1));
  return geometry;
}

export function createAbyssLife(scene, { onAsset = () => {}, terrain = terrainHeight, colliders = [], jellyTextureLoader } = {}) {
  const loader = new GLTFLoader(), tmp = new THREE.Object3D(), creatures = [], threats = [], fishGroups = [];
  const fishClock = { value: 0 }, observer = { x: 0, y: 0, z: 0, flashlight: false };
  const inkClouds=createInkClouds(scene),inkOrigin=new THREE.Vector3(),inkDirection=new THREE.Vector3(),inkRotation=new THREE.Quaternion();
  const defenseObserver={x:0,y:0,z:0,playing:false,submerged:false};
  let disposed = false, quality = 'medium', lastTime = null, accumulator = 0, simulationTime = 0;
  function disposeObject(object) {
    const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
    object.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});
    for(const s of skeletons)s.dispose();for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();
  }
  for (const def of creatureDefs) {
    const root = new THREE.Group(); root.name=def.name; scene.add(root);
    const center = new THREE.Vector3(...def.center); if(def.id!=='shark')center.y=terrain(center.x,center.z)+(def.id==='warden'?19:13);
    const locomotion = createCreatureLocomotion(def,center,terrain,colliders);
    const entry={...def,root,center,locomotion,motion:locomotion.state,lowObject:null,highObject:null,lowState:'idle',highState:'idle',mixerLow:null,mixerHigh:null,driverLow:null,driverHigh:null,clipLow:0,clipHigh:0,lastAsset:'none',threat:{x:0,y:0,z:0,radius:def.radius}};
    if(def.id==='kraken'){entry.inkDefense=createInkDefense({id:def.id});entry.motion.inkDefense=entry.inkDefense.state;entry.lastInkEvent=0;}
    root.position.set(entry.motion.x,entry.motion.y,entry.motion.z);root.rotation.y=entry.motion.heading;creatures.push(entry);
  }
  const colony = createJellyfishColony(scene,{terrain,textureLoader:jellyTextureLoader,onAsset:event=>onAsset({...event,tier:'shared'})});
  async function loadCreature(c,tier) {
    const stateKey=tier+'State';if(disposed||c[stateKey]!=='idle')return;c[stateKey]='loading';
    try {
      const gltf=await loader.loadAsync('./assets/abyss/'+c[tier]),model=gltf.scene;
      if(disposed){disposeObject(model);return;}
      model.scale.setScalar(c.scale);model.traverse(o=>{if(!o.isMesh)return;o.frustumCulled=false;o.castShadow=false;o.receiveShadow=false;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.envMapIntensity=.35;m.depthWrite=true;}});
      model.visible=false;c.root.add(model);c[tier+'Object']=model;
      const suffix=tier==='low'?'Low':'High',mixer=new THREE.AnimationMixer(model);c['mixer'+suffix]=mixer;c['clip'+suffix]=gltf.animations[0]?.duration||1;
      if(gltf.animations[0])mixer.clipAction(gltf.animations[0]).play();
      const factory=c.id==='shark'?createSharkMotion:c.id==='kraken'?createKrakenMotion:createWardenMotion;
      c['driver'+suffix]=factory(model,gltf.animations);c[stateKey]='ready';onAsset({id:c.id,tier,status:'ready'});
    } catch(error) { if(disposed)return;c[stateKey]='error';onAsset({id:c.id,tier,status:'error',message:error.message}); }
  }
  const fishGeo=createFishGeometry(),fishMat=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.25,roughness:.56,side:THREE.DoubleSide});
  fishMat.onBeforeCompile=shader=>{shader.uniforms.uFishTime=fishClock;shader.vertexShader='uniform float uFishTime;attribute float aFishPhase;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    float fishPhase=uFishTime*(8.5+sin(aFishPhase)*1.5)+aFishPhase;
    float flex=pow(clamp((position.z+.36)/1.01,0.,1.),1.65);
    transformed.x+=sin(fishPhase-position.z*5.2)*flex*.115;
    transformed.y+=sin(fishPhase*.5-position.z*2.1)*flex*.016;`);};
  fishMat.customProgramCacheKey=()=> 'abyss-articulated-shoal-v1';
  for(let j=0;j<5;j++){const mesh=new THREE.InstancedMesh(fishGeo,fishMat,42);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh);fishGroups.push({mesh,center:new THREE.Vector3(-45+j*25,-15-j*7,-30-j*31),phase:j*2.17});}

  function reset(time=0){
    if(disposed)return;
    for(const c of creatures){c.locomotion.reset();c.inkDefense?.reset();c.lastInkEvent=0;}
    inkClouds.reset();accumulator=0;simulationTime=Number.isFinite(time)?time:0;lastTime=simulationTime;
  }
  function emitDefense(c){
    const m=c.motion,d=c.inkDefense.state;
    if(d.eventId===c.lastInkEvent)return;c.lastInkEvent=d.eventId;
    c.root.position.set(m.x,m.y,m.z);c.root.rotation.set(m.pitch,m.heading,0,'YXZ');
    const suffix=c.driverHigh&&(c.lastAsset==='high'||!c.driverLow)?'High':'Low',driver=c['driver'+suffix],duration=c['clip'+suffix]||1;
    m.clipTime=((m.phase/TAU)%1+1)%1*duration;c['mixer'+suffix]?.setTime(m.clipTime);driver?.update(0,m);c.root.updateMatrixWorld(true);
    if(!driver?.getSiphonWorldPosition?.(inkOrigin)){
      // The authored aperture's bind-space coordinate, also valid while a
      // structural test fixture lacks the real head rig. Never a mouth source.
      inkOrigin.set(0,1.915,-1.265).multiplyScalar(c.scale).applyMatrix4(c.root.matrixWorld);
    }
    if(!driver?.getSiphonWorldDirection?.(inkDirection)){
      c.root.getWorldQuaternion(inkRotation);inkDirection.set(0,-Math.SQRT1_2,-Math.SQRT1_2).applyQuaternion(inkRotation);
    }
    inkClouds.emit({origin:inkOrigin,direction:inkDirection,bendDirection:d.inkDirection,id:c.id+':'+d.eventId,time:simulationTime});
  }
  function update(dt,time,player,tier='medium') {
    if(disposed)return;quality=tier;threats.length=0;
    observer.x=Number.isFinite(player?.x)?player.x:0;observer.y=Number.isFinite(player?.y)?player.y:0;observer.z=Number.isFinite(player?.z)?player.z:0;observer.flashlight=!!player?.flashlight;
    observer.playing=player?.status==='playing'||player?.playing===true;
    observer.submerged=typeof player?.submerged==='boolean'?player.submerged:(observer.playing&&player?.inAir!==true&&player?.movementMode!=='walk'&&observer.y< -1.1);
    const now=Number.isFinite(time)?time:simulationTime;
    if(lastTime===null||now<lastTime-1e-7)reset(now);
    const elapsed=dt>0?Math.min(.25,Math.max(0,now-lastTime)):0;
    if(dt>0)lastTime=now;
    accumulator+=elapsed;
    while(accumulator+1e-10>=CREATURE_STEP){
      simulationTime+=CREATURE_STEP;
      for(const c of creatures){
        if(c.inkDefense){
          Object.assign(defenseObserver,observer);defenseObserver.playing=observer.playing&&(c.lowState==='ready'||c.highState==='ready');
          c.inkDefense.step(CREATURE_STEP,c.motion,defenseObserver);
        }
        c.locomotion.step(CREATURE_STEP,simulationTime,observer);if(c.inkDefense)emitDefense(c);
      }
      inkClouds.update(CREATURE_STEP,simulationTime,observer,quality);
      accumulator=Math.max(0,accumulator-CREATURE_STEP);
    }
    inkClouds.update(0,simulationTime,observer,quality);
    for(const c of creatures){
      const m=c.motion;c.root.position.set(m.x,m.y,m.z);c.root.rotation.set(m.pitch,m.heading,0,'YXZ');
      const d=Math.hypot(observer.x-m.x,observer.y-m.y,observer.z-m.z),range=quality==='low'?75:c.range;c.root.visible=d<range;
      if(d<range+(c.id==='shark'?20:5))loadCreature(c,'low');if(quality==='high'&&d<c.near+10)loadCreature(c,'high');
      const high=quality==='high'&&d<c.near+(c.lastAsset==='high'?6:0)&&c.highState==='ready';if(c.lowObject)c.lowObject.visible=!high;if(c.highObject)c.highObject.visible=high;c.lastAsset=high?'high':'low';
      if(c.root.visible){
        const suffix=high?'High':'Low',duration=c['clip'+suffix]||1;
        m.clipTime=((m.phase/TAU)%1+1)%1*duration;
        c['mixer'+suffix]?.setTime(m.clipTime);c['driver'+suffix]?.update(elapsed,m);
        Object.assign(c.threat,{x:m.x,y:m.y+(c.id==='warden'?12:0),z:m.z});if(c.lowState==='ready'||c.highState==='ready')threats.push(c.threat);
      }
    }
    fishClock.value=now;
    for(const school of fishGroups){
      const distance=Math.hypot(observer.x-school.center.x,observer.y-school.center.y,observer.z-school.center.z),near=distance<(quality==='low'?55:90);school.mesh.visible=near;if(!near)continue;
      school.mesh.count=quality==='low'?12:quality==='high'?42:25;const alarm=Math.max(0,1-distance/13);
      for(let i=0;i<school.mesh.count;i++){
        const angle=now*.14+school.phase+i*.77,r=3+(i%8)*.8;
        const awayX=(school.center.x-observer.x)/Math.max(distance,1),awayZ=(school.center.z-observer.z)/Math.max(distance,1);
        tmp.position.set(school.center.x+Math.sin(angle)*r+awayX*alarm*4,school.center.y+Math.sin(now*.7+i)*1.3+(i%4),school.center.z+Math.cos(angle)*r+awayZ*alarm*4);
        tmp.rotation.set(Math.sin(now*2+i)*.035,angle-Math.PI/2,Math.sin(now*1.4+i)*.035);tmp.scale.setScalar(.65+(i%5)*.12);tmp.updateMatrix();school.mesh.setMatrixAt(i,tmp.matrix);
      }
      school.mesh.instanceMatrix.needsUpdate=true;
    }
    colony.update(dt,now,observer,quality);
  }
  function dispose(){
    if(disposed)return;disposed=true;threats.length=0;colony.dispose();inkClouds.dispose();
    for(const c of creatures){c.inkDefense?.dispose();c.driverLow?.dispose();c.driverHigh?.dispose();c.mixerLow?.stopAllAction();c.mixerHigh?.stopAllAction();scene.remove(c.root);disposeObject(c.root);c.root.clear();}
    for(const group of fishGroups)scene.remove(group.mesh);fishGeo.dispose();fishMat.dispose();
  }
  function snapshot(){return {large:creatures.map(c=>({id:c.id,position:{x:c.motion.x,y:c.motion.y,z:c.motion.z},speed:c.motion.speed,turnRate:c.motion.turnRate,phase:c.motion.phase,alert:c.motion.alert,mode:c.motion.mode,weights:{cruise:c.motion.cruiseWeight,accelerate:c.motion.accelerateWeight,turn:c.motion.turnWeight,react:c.motion.reactWeight},lod:c.lastAsset,lowState:c.lowState,highState:c.highState,inkDefense:c.inkDefense?.snapshot()||null,joints:(c.lastAsset==='high'?c.driverHigh:c.driverLow)?.snapshot?.()})),jellyfish:colony.snapshot?.(),jellyTissue:colony.tissueStatus,ink:inkClouds.snapshot()};}
  return {update,reset,threats,creatures,dispose,snapshot,inkClouds,inkDensity:point=>inkClouds.sampleDensity(point),stats:{maxFish:210,fishTriangles:fishGeo.index.count/3,maxLargeCreatures:3,ink:inkClouds.stats,jellyfish:colony.stats,locomotionStep:CREATURE_STEP,lodPolicy:'Shared phase/state on both LODs; visible variant samples authored clip then articulated species joints. Large Warden remains planted because its rig has no knees/ankles.'}};
}
