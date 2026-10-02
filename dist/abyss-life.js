import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {terrainHeight} from './abyss-world.js';
const creatureDefs=[
 {id:'shark',name:'REEFBREAKER',center:[-9,-20,-46],scale:.5595,radius:2.2,speed:.075,orbit:[28,7,22],range:110,near:30,low:'shark-lod.glb',high:'shark.glb'},
 {id:'kraken',name:'ABYSSAL REGENT',center:[59,0,-114],scale:1.6,radius:5.3,speed:.019,orbit:[12,3,11],range:125,near:38,low:'kraken-lod.glb',high:'kraken.glb'},
 {id:'warden',name:'ABYSSAL WARDEN',center:[-49,0,-193],scale:3.707615,radius:8,speed:.008,orbit:[15,4,8],range:140,near:52,low:'warden-lod.glb',high:'warden.glb'}
];
export function createAbyssLife(scene,{onAsset=()=>{}}={}) {
 const loader=new GLTFLoader(),tmp=new THREE.Object3D(),creatures=[],threats=[],fishGroups=[];
 function disposeObject(object){const geometry=new Set(),materials=new Set(),textures=new Set();object.traverse(o=>{if(o.geometry)geometry.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometry)g.dispose();}
 for(const def of creatureDefs){const root=new THREE.Group();root.name=def.name;scene.add(root);const center=new THREE.Vector3(...def.center);if(def.id!=='shark')center.y=terrainHeight(center.x,center.z)+(def.id==='warden'?19:13);const entry={...def,root,center,lowObject:null,highObject:null,lowState:'idle',highState:'idle',mixerLow:null,mixerHigh:null,lastAsset:'none',threat:{x:0,y:0,z:0,radius:def.radius},alpha:0};creatures.push(entry);}
 async function loadCreature(c,tier){const stateKey=tier+'State';if(disposed||c[stateKey]!=='idle')return;c[stateKey]='loading';try{const gltf=await loader.loadAsync('./assets/abyss/'+c[tier]);const model=gltf.scene;if(disposed){disposeObject(model);return;}model.scale.setScalar(c.scale);model.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=false;o.receiveShadow=false;if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.envMapIntensity=.35;m.depthWrite=true;}}}});model.visible=false;c.root.add(model);c[tier+'Object']=model;c['mixer'+(tier==='low'?'Low':'High')]=new THREE.AnimationMixer(model);for(const a of gltf.animations)c['mixer'+(tier==='low'?'Low':'High')].clipAction(a).play();c[stateKey]='ready';onAsset({id:c.id,tier,status:'ready'});}catch(error){if(disposed)return;c[stateKey]='error';onAsset({id:c.id,tier,status:'error',message:error.message});}}
 // Shared instanced shoals; eight vertices per tapered body, one mesh per habitat.
 const fishGeo=new THREE.BufferGeometry();const verts=new Float32Array([0,0,-.58, -.18,0,0, 0,.22,.02,.18,0,0,0,-.15,.04,0,0,.42, -.22,.25,.65,.22,-.22,.65]);fishGeo.setAttribute('position',new THREE.BufferAttribute(verts,3));fishGeo.setIndex([0,2,1,0,3,2,0,4,3,0,1,4,1,2,5,2,3,5,3,4,5,4,1,5,5,6,7]);fishGeo.computeVertexNormals();
 const fishMat=new THREE.MeshStandardMaterial({color:0xb9ddce,metalness:.38,roughness:.49,side:THREE.DoubleSide});
 for(let j=0;j<5;j++){const group=new THREE.InstancedMesh(fishGeo,fishMat,42);group.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.frustumCulled=false;scene.add(group);fishGroups.push({mesh:group,center:new THREE.Vector3(-45+j*25,-15-j*7,-30-j*31),phase:j*2.17});}
 let disposed=false,quality='medium';
 function update(dt,time,player,tier='medium'){
  if(disposed)return;quality=tier;threats.length=0;
  for(const c of creatures){const a=time*c.speed;const cx=c.center.x+Math.sin(a)*c.orbit[0],cz=c.center.z+Math.cos(a)*c.orbit[2],cy=c.id==='warden'?terrainHeight(cx,cz)+.7:Math.max(terrainHeight(cx,cz)+(c.id==='shark'?3:7),c.center.y+Math.sin(a*.8)*c.orbit[1]);c.root.position.set(cx,cy,cz);c.root.rotation.y=Math.atan2(-Math.cos(a)*c.orbit[0],Math.sin(a)*c.orbit[2]);const d=Math.hypot(player.x-cx,player.y-cy,player.z-cz);const range=quality==='low'?75:c.range;c.root.visible=d<range;
   if(d<range+(c.id==='shark'?20:5))loadCreature(c,'low');if(quality==='high'&&d<c.near+10)loadCreature(c,'high');
   const high=quality==='high'&&d<c.near+(c.lastAsset==='high'?6:0)&&c.highState==='ready';if(c.lowObject)c.lowObject.visible=!high;if(c.highObject)c.highObject.visible=high;c.lastAsset=high?'high':'low';
   if(c.root.visible){(high?c.mixerHigh:c.mixerLow)?.setTime(time);Object.assign(c.threat,{x:cx,y:cy+(c.id==='warden'?12:0),z:cz});if(c.lowState==='ready'||c.highState==='ready')threats.push(c.threat);}
  }
  for(const school of fishGroups){const near=Math.hypot(player.x-school.center.x,player.y-school.center.y,player.z-school.center.z)<(quality==='low'?55:90);school.mesh.visible=near;if(!near)continue;school.mesh.count=quality==='low'?12:quality==='high'?42:25;for(let i=0;i<school.mesh.count;i++){const angle=time*.14+school.phase+i*.77,r=3+(i%8)*.8;tmp.position.set(school.center.x+Math.sin(angle)*r,school.center.y+Math.sin(time*.7+i)*1.3+(i%4),school.center.z+Math.cos(angle)*r);tmp.rotation.set(Math.sin(time*2+i)*.08,-angle-Math.PI/2,Math.sin(time*1.4+i)*.12);tmp.scale.setScalar(.65+(i%5)*.12);tmp.updateMatrix();school.mesh.setMatrixAt(i,tmp.matrix);}school.mesh.instanceMatrix.needsUpdate=true;}
 }
 function dispose(){if(disposed)return;disposed=true;threats.length=0;for(const c of creatures){scene.remove(c.root);disposeObject(c.root);}for(const g of fishGroups)scene.remove(g.mesh);fishGeo.dispose();fishMat.dispose();}
 return {update,threats,creatures,dispose,stats:{maxFish:210,maxLargeCreatures:3,lodPolicy:'Low models by default; high models load only on high quality inside near range; hidden beyond habitat range.'}};
}
