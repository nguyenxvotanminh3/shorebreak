import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {createWetLock,WET_LOCK} from './abyss-airlock.js';
import {RIG_LAYOUT} from './abyss-rig-layout.js';
import {RIG_SITE} from './abyss-deep-zone.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const phaseText={'sea-open':'CỬA BIỂN ĐANG MỞ','habitat-open':'KHOANG KHÔ · CỬA TRONG MỞ',closing:'ĐANG ĐÓNG CỬA',draining:'ĐANG RÚT NƯỚC',filling:'ĐANG BƠM NƯỚC',equalizing:'ĐANG CÂN BẰNG KHOANG',opening:'ĐANG MỞ CỬA'};
const labels={'call-sea':'GỌI KHOANG ƯỚT','request-habitat':'ĐÓNG CỬA NGOÀI · RÚT NƯỚC','request-sea':'ĐÓNG CỬA TRONG · BƠM NƯỚC','call-habitat':'GỌI KHOANG KHÔ'};
const interiorName=name=>/Interior|WetLock|Vestibule|Corridor|ControlRoom|MachineryGallery|PressureBulkheads|ControlConsoles/.test(name);
function resources(object){const geometry=new Set(),materials=new Set(),textures=new Set();object.traverse(o=>{if(o.geometry)geometry.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});return{geometry,materials,textures};}
function release(object){const r=resources(object);object.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const v of r.geometry)v.dispose();for(const v of r.materials)v.dispose();for(const v of r.textures)v.dispose();}

/** Original physical facility; no teleport, live camera, or player input mutation. */
export function createDeepRig(scene,{terrain,site=RIG_SITE,loader=new GLTFLoader(),onAsset=()=>{}}={}){
 if(typeof terrain!=='function')throw new TypeError('Rig requires the same terrain as player physics');
 const root=new THREE.Group();root.name='Rig07 / original deep-sea habitat';root.position.set(site.x,terrain(site.x,site.z),site.z);scene.add(root);
 const origin=root.position,lock=createWetLock(),boxColliders=[],doors=[],panels=[],models={full:null,medium:null,far:null},states={full:'idle',medium:'idle',far:'idle'};
 let disposed=false,quality='medium',selected='none',time=0;
 const cube=new THREE.BoxGeometry(1,1,1),steel=new THREE.MeshStandardMaterial({color:0x29484e,roughness:.76,metalness:.48}),amber=new THREE.MeshStandardMaterial({color:0xffba54,emissive:0xe58a28,emissiveIntensity:1.5,roughness:.5});
 const fallback=new THREE.Group();fallback.name='Rig load fallback / real collision envelope';root.add(fallback);
 const shells=new THREE.InstancedMesh(cube,steel,RIG_LAYOUT.collisionBoxes.length+9),dummy=new THREE.Object3D();fallback.add(shells);
 function fillMatrix(i,c,size){dummy.position.set(...c);dummy.rotation.set(0,0,0);dummy.scale.set(...size);dummy.updateMatrix();shells.setMatrixAt(i,dummy.matrix);}
 for(const [i,b]of RIG_LAYOUT.collisionBoxes.entries()){
  fillMatrix(i,b.center,b.size);boxColliders.push({name:b.name,minX:origin.x+b.center[0]-b.size[0]/2,maxX:origin.x+b.center[0]+b.size[0]/2,minY:origin.y+b.center[1]-b.size[1]/2,maxY:origin.y+b.center[1]+b.size[1]/2,minZ:origin.z+b.center[2]-b.size[2]/2,maxZ:origin.z+b.center[2]+b.size[2]/2});
 }
 let offset=RIG_LAYOUT.collisionBoxes.length;
 for(const x of [-52,52])for(const z of [-34,0,34])fillMatrix(offset++,[x,24,z],[4,46,4]);
 fillMatrix(offset++,[-20,46,-10],[16,28,16]);fillMatrix(offset++,[0,46,0],[105,.45,70]);fillMatrix(offset++,[0,32,0],[105,.45,70]);shells.instanceMatrix.needsUpdate=true;shells.computeBoundingSphere();
 for(const [name,d]of Object.entries(RIG_LAYOUT.doorNodes)){
  const box={name,dynamic:true,enabled:true};boxColliders.push(box);
  const mesh=new THREE.Mesh(cube,steel);mesh.name='Fallback '+name;mesh.scale.set(d.closedBounds.max[0]-d.closedBounds.min[0],d.closedBounds.max[1]-d.closedBounds.min[1],d.closedBounds.max[2]-d.closedBounds.min[2]);fallback.add(mesh);
  doors.push({name,data:d,box,mesh,outer:name.includes('outer'),refs:{}});
 }
 for(const [id,data]of Object.entries(RIG_LAYOUT.interactionAnchors)){
  const position=new THREE.Vector3(...data.position).add(origin),indicator=new THREE.Mesh(cube,amber);indicator.position.set(...data.position);indicator.position.y+=.52;indicator.scale.set(.28,.055,.055);root.add(indicator);
  panels.push({id,...data,position,indicator,target:data.action.endsWith('sea')?'sea':'habitat',label:labels[data.action]});
 }
 const waterGeometry=new THREE.PlaneGeometry(5.5,6.5,10,12);waterGeometry.rotateX(-Math.PI/2);
 const waterMaterial=new THREE.MeshStandardMaterial({color:0x206d88,roughness:.19,metalness:.35,transparent:true,opacity:.48,side:THREE.DoubleSide,depthWrite:false,fog:false});waterMaterial.forceSinglePass=true;
 const waterClock={value:0};waterMaterial.onBeforeCompile=shader=>{shader.uniforms.uLockTime=waterClock;shader.vertexShader='uniform float uLockTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y+=sin(position.x*4.+uLockTime*2.3)*cos(position.z*3.-uLockTime*1.4)*.014;');};waterMaterial.customProgramCacheKey=()=> 'rig-wetlock-surface-v1';
 const water=new THREE.Mesh(waterGeometry,waterMaterial);water.name='Wet lock / descending local water surface';water.position.set(0,WET_LOCK.flooded,38.5);root.add(water);
 const droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(.026,5,4),new THREE.MeshBasicMaterial({color:0x81c8dd,transparent:true,opacity:.42,depthWrite:false}),32);droplets.name='Bounded wet-lock drainage droplets';droplets.frustumCulled=false;root.add(droplets);
 const lights=[];for(const p of [[0,21,38.5],[0,21,24],[0,24,3],[17,24,3]]){const light=new THREE.PointLight(0xc5e4dd,16,20,1.5);light.position.set(...p);root.add(light);lights.push(light);}
 const rooms=RIG_LAYOUT.rooms.map(room=>({...room,environment:{indoors:true,floorY:origin.y+room.min[1],ceilingY:origin.y+room.max[1]-.45,waterLevel:room.type==='dry'?-Infinity:origin.y+WET_LOCK.flooded,room:room.name}}));
 const entryPosition=new THREE.Vector3(...RIG_LAYOUT.anchors.rig_entry_spawn.position).add(origin);
 const stats={name:RIG_LAYOUT.name,quality,asset:'none',assets:{...states},colliders:boxColliders.length,panels:panels.length,roomCount:rooms.length,phase:lock.state.phase,inside:false,waterLevel:origin.y+WET_LOCK.flooded};
 function localInside(room,p,padding=0){return p.x-origin.x>=room.min[0]-padding&&p.x-origin.x<=room.max[0]+padding&&p.y-origin.y>=room.min[1]-.7&&p.y-origin.y<=room.max[1]+.1&&p.z-origin.z>=room.min[2]-padding&&p.z-origin.z<=room.max[2]+padding;}
 function sampleEnvironment(player){if(disposed)return null;for(const room of rooms)if(localInside(room,player)){if(room.type==='dynamic-water')room.environment.waterLevel=origin.y+lock.state.waterLevel;return room.environment;}return null;}
 function occupancy(player){
  const x=player.x-origin.x,y=player.y-origin.y,z=player.z-origin.z,r=.65,bottom=y-(player.eyeHeight||r),top=y+.65;
  const inDoor=plane=>Math.abs(x)<1.6+r&&Math.abs(z-plane)<.38+r&&top>18&&bottom<21.5;
  return{outerBlocked:inDoor(42),innerBlocked:inDoor(35),inChamber:x>-3&&x<3&&z>35&&z<42&&y>18&&y<23};
 }
 function syncDoors(){
  const s=lock.state;
  for(const door of doors){const a=door.outer?s.outerOpen:s.innerOpen,d=door.data,v=d.openVector;
   door.mesh.position.set((d.closedBounds.min[0]+d.closedBounds.max[0])/2+v[0]*a,(d.closedBounds.min[1]+d.closedBounds.max[1])/2+v[1]*a,(d.closedBounds.min[2]+d.closedBounds.max[2])/2+v[2]*a);
   for(const [i,key]of ['X','Y','Z'].entries()){door.box['min'+key]=origin.getComponent(i)+d.closedBounds.min[i]+v[i]*a;door.box['max'+key]=origin.getComponent(i)+d.closedBounds.max[i]+v[i]*a;}
   for(const ref of Object.values(door.refs))ref.node.position.copy(ref.closed).addScaledVector(ref.vector,a);
  }
  water.position.y=s.waterLevel;water.visible=s.water01>.005;stats.phase=s.phase;stats.waterLevel=origin.y+s.waterLevel;
 }
 function step(dt,player){if(disposed||!(dt>0))return;lock.step(dt,occupancy(player));syncDoors();}
 function report(event){try{onAsset(event);}catch{}}
 async function load(tier){
  if(disposed||states[tier]!=='idle')return;states[tier]='loading';stats.assets[tier]='loading';
  try{const gltf=await loader.loadAsync('./assets/abyss/rig/rig-'+tier+'.glb');const model=gltf.scene;if(disposed){release(model);return;}
   model.name='Rig07 '+tier;model.visible=false;const originals=resources(model).materials,indoorMaterials=new Map();model.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=false;const list=Array.isArray(o.material)?o.material:[o.material],mapped=list.map(m=>{m.envMapIntensity=.4;if(!interiorName(o.name))return m;if(!indoorMaterials.has(m)){const clone=m.clone();clone.fog=false;indoorMaterials.set(m,clone);}return indoorMaterials.get(m);});o.material=Array.isArray(o.material)?mapped:mapped[0];});const used=resources(model).materials;for(const m of originals)if(!used.has(m))m.dispose();root.add(model);models[tier]=model;
   for(const door of doors){const node=model.getObjectByName(door.name);if(node)door.refs[tier]={node,closed:node.position.clone(),vector:new THREE.Vector3(...door.data.openVector)};}
   syncDoors();states[tier]='ready';stats.assets[tier]='ready';report({id:'rig',tier,status:'ready'});
  }catch(error){if(disposed)return;states[tier]='error';stats.assets[tier]='error';report({id:'rig',tier,status:'error',message:error.message});}
 }
 function update(dt,absoluteTime,player,tier='medium'){
  if(disposed)return;quality=tier;stats.quality=tier;if(dt>0&&Number.isFinite(absoluteTime))time=absoluteTime;waterClock.value=time;
  const d=Math.hypot(player.x-origin.x,player.y-origin.y-25,player.z-origin.z),environment=sampleEnvironment(player);stats.inside=!!environment;
  if(d<370)void load('far');if(d<190)void load('medium');if(tier==='high'&&d<110)void load('full');
  const wanted=tier==='high'&&d<125&&states.full==='ready'?'full':d<210&&states.medium==='ready'?'medium':states.far==='ready'?'far':'none';
  selected=wanted;stats.asset=selected;root.visible=d<390;fallback.visible=selected==='none';for(const key of Object.keys(models))if(models[key])models[key].visible=key===selected;
  const s=lock.state,pumping=s.phase==='draining'||s.phase==='filling';amber.emissive.setHex(s.blocked?0xf35b38:pumping?0x2cabc9:0xe58a28);amber.emissiveIntensity=1.5+(pumping?.3*Math.sin(time*7):0);
  droplets.visible=pumping&&d<90;droplets.count=tier==='low'?12:32;
  if(droplets.visible){for(let i=0;i<droplets.count;i++){dummy.position.set(Math.sin(i*2.399)*2.35,18.15+((i*.371-time*1.7)%1+1)%1*4.4,35.6+((i*.618)%1)*5.7);dummy.scale.set(1,2.4,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();droplets.setMatrixAt(i,dummy.matrix);}droplets.instanceMatrix.needsUpdate=true;}
  for(const light of lights)light.visible=!!environment&&Math.hypot(player.x-origin.x-light.position.x,player.y-origin.y-light.position.y,player.z-origin.z-light.position.z)<22;
 }
 function getInteraction(player){
  if(disposed)return null;let best=null,closest=Infinity;const fx=-Math.sin(player.yaw||0)*Math.cos(player.pitch||0),fy=Math.sin(player.pitch||0),fz=-Math.cos(player.yaw||0)*Math.cos(player.pitch||0);
  for(const panel of panels){const lz=player.z-origin.z;if(panel.action==='call-sea'&&lz<42.1||panel.action==='call-habitat'&&lz>34.9||panel.action.startsWith('request-')&&(lz<35.2||lz>41.8))continue;const dx=panel.position.x-player.x,dy=panel.position.y-player.y,dz=panel.position.z-player.z,d=Math.hypot(dx,dy,dz);if(d<panel.radius&&d<closest&&(dx*fx+dy*fy+dz*fz)/Math.max(.001,d)>.35){best=panel;closest=d;}}
  return best;
 }
 function interact(player){const panel=getInteraction(player);if(!panel)return null;const before=lock.state;const accepted=lock.request(panel.target,occupancy(player));return{accepted,changed:accepted&&before.target!==panel.target,label:panel.label,status:statusText()};}
 function statusText(){const s=lock.state;return s.blocked?'LÙI KHỎI NGƯỠNG CỬA ĐỂ TIẾP TỤC':phaseText[s.phase]||s.phase;}
 function reset(){if(disposed)return;lock.reset();syncDoors();}
 function recover(player){if(disposed)return false;const result=lock.recover(occupancy(player));syncDoors();return result;}
 function snapshot(){return{...stats,disposed,origin:origin.toArray(),entry:entryPosition.toArray(),lock:lock.snapshot(),assets:{...states},selected};}
 function dispose(){if(disposed)return;disposed=true;scene.remove(root);release(root);root.clear();for(const key of Object.keys(models))models[key]=null;boxColliders.length=0;doors.length=0;panels.length=0;lights.length=0;rooms.length=0;}
 syncDoors();return{root,step,update,dispose,reset,recover,getInteraction,interact,statusText,sampleEnvironment,boxColliders,entryPosition,stats,snapshot,lock};
}
