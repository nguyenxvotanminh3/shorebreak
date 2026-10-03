import * as THREE from './vendor/three.module.js';
import {sampleWater} from './water.js';
import {createSeaCreature} from './creatures.js?v=3';
import {createMachine} from './machines.js?v=4';
import {createKaiju} from './kaiju.js?v=4';
import {sampleSwimPath} from './swimming.js';
import {intersectsCreature} from './collision.js';
import {createWaterContact} from './lighting.js';
const water={},beaconGeometry=new THREE.OctahedronGeometry(.24,0);
const animalTypes=new Set(['shark','kraken','seaSerpent','jellyfish']);
const layout=[['grinder',0],['sawGate',3],['piston',-3],['shark',0],['kaiju',-2],['grinder',3],['kraken',-5],['sawGate',-3],['seaSerpent',5],['piston',3],['jellyfish',-1],['kaiju',4]];
export function createGauntlet(scene){
 const pool=[],view={},before={},playerBefore={x:0,y:0,z:0,yaw:0},playerNow={x:0,y:0,z:0,yaw:0};let row=0;
 const beaconMaterial=new THREE.MeshBasicMaterial({color:0xffb64b});
 const wakeMaterial=new THREE.MeshBasicMaterial({color:0xd8f2e9,transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false});
 function makeWake(){const positions=new Float32Array(16*6),indices=[];for(let i=0;i<15;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));g.setIndex(indices);const mesh=new THREE.Mesh(g,wakeMaterial);mesh.frustumCulled=false;scene.add(mesh);return {mesh,positions};}
 function samplePath(o,t,out){if(o.animal)return sampleSwimPath(o,t,out);out.z=o.spawnZ;out.x=(t*.72-out.z*.035+.4)/.23+o.offset;out.y=sampleWater(out.x,out.z,t,water).h-.1;out.heading=o.type==='kaiju'?Math.PI:0;out.turn=0;out.speed=0;out.vx=.72/.23;out.vz=0;return out;}
 for(let i=0;i<layout.length;i++){
  const [type,offset]=layout[i],animal=animalTypes.has(type),asset=animal?createSeaCreature(type):type==='kaiju'?createKaiju():createMachine(type);
  scene.add(asset.group);asset.group.traverse(n=>{if(n.isMesh&&!n.material.transparent){n.castShadow=true;n.receiveShadow=true;}});const contact=createWaterContact(scene,type==='kaiju'?4.8:type==='shark'?1.5:Math.min(5,asset.radius||3),type==='kaiju'?4:type==='shark'?3.6:2.5,type==='jellyfish'?.14:.28);const markers=new THREE.Group();for(const side of [-1,1]){const m=new THREE.Mesh(beaconGeometry,beaconMaterial);m.position.set(side*((asset.radius||4)+.5),.5,0);markers.add(m);}scene.add(markers);
  pool.push({...asset,contact,type,animal,markers,index:i,offset,seed:i*1.87,born:0,spawnZ:0,x:0,y:0,z:0,heading:0,speed:0,vx:0,vz:0,turn:0,passed:false,hit:false,closest:Infinity,wasAirNear:false,aura:0,wake:animal?makeWake():null,visible:false,oldShapes:[]});
 }
 function rememberShapes(o){const shapes=o.getColliders();for(let i=0;i<shapes.length;i++){if(!o.oldShapes[i])o.oldShapes[i]={};Object.assign(o.oldShapes[i],shapes[i]);}o.oldShapes.length=shapes.length;}
 function spawn(o,s,z){o.born=s.oceanTime;o.spawnZ=z;o.row=row++;o.offset=layout[o.index][1]+(o.row>=12?Math.sin(o.row*2.1)*1.8:0);o.passed=o.hit=false;o.closest=Infinity;o.wasAirNear=false;o.aura=0;samplePath(o,s.oceanTime,o);o.animate(s.oceanTime+o.seed,o.speed);rememberShapes(o);o.group.visible=o.markers.visible=false;o.contact.mesh.visible=false;if(o.wake)o.wake.mesh.visible=false;}
 function reset(s){row=0;let nextZ=s.z-35;for(const o of pool){spawn(o,s,nextZ);nextZ-=o.type==='kaiju'?48:39;}playerBefore.x=s.x;playerBefore.y=s.y;playerBefore.z=s.z;playerBefore.yaw=0;}
 function step(s,dt,emit){
  if(s.status!=='playing')return;playerNow.x=s.x;playerNow.y=s.y;playerNow.z=s.z;playerNow.yaw=-Math.atan2(s.latVel||0,s.speed)+(s.spinAngle||0);
  for(const o of pool){
   before.x=o.x;before.y=o.y;before.z=o.z;before.heading=o.heading;before.turn=o.turn;samplePath(o,s.oceanTime,o);
   const dz=o.z-s.z,dx=o.x-s.x,distance=Math.hypot(dx,dz),radius=Math.max(7,(o.radius||3)+2.2);
   if(distance<radius+6){
    if(!o.animal)o.animate(s.oceanTime+o.seed,o.speed);
    o.closest=Math.min(o.closest,distance);if(s.air&&distance<radius){o.wasAirNear=true;o.aura=Math.max(o.aura,s.auraDwell||0);}
    if(!o.hit&&s.invulnerable<=0&&s.wipe<=0&&intersectsCreature(playerBefore,playerNow,before,o,o.getColliders(),o.oldShapes)){o.hit=true;s.collisions++;emit('obstacle-hit',{name:o.label,type:o.type});}
    rememberShapes(o);
   }
   if(!o.passed&&dz>Math.max(7,(o.radius||3)+1)){o.passed=true;if(!o.hit&&s.wipe<=0){s.obstaclesDodged++;emit('obstacle-clear',{name:o.label,type:o.type,air:o.wasAirNear,near:o.closest<4,aura:o.aura});}}
   if(dz>34){let front=s.z-165;for(const other of pool)if(other!==o)front=Math.min(front,other.z-(other.type==='kaiju'?44:Math.max(29,39-Math.floor(-s.z/500))));spawn(o,s,front);}
  }Object.assign(playerBefore,playerNow);
 }
 function updateWake(o,s){const p=o.wake.positions;let j=0;for(let i=0;i<16;i++){const age=i*.085;samplePath(o,s.oceanTime-age,view);const tail=o.type==='shark'?2.6:o.type==='seaSerpent'?2.1:1,bx=Math.sin(view.heading),bz=Math.cos(view.heading),wide=(.14+age*.25)*Math.sin((i+1)/17*Math.PI),cx=view.x+bx*tail,cz=view.z+bz*tail;for(let side=-1;side<=1;side+=2){const x=cx+Math.cos(view.heading)*wide*side,z=cz-Math.sin(view.heading)*wide*side;p[j++]=x;p[j++]=sampleWater(x,z,s.oceanTime,water).h+.055;p[j++]=z;}}o.wake.mesh.geometry.attributes.position.needsUpdate=true;}
 function render(s){for(const o of pool){samplePath(o,s.oceanTime,view);const distance=s.z-view.z;o.visible=s.status!=='menu'&&distance<158&&distance>-27;o.group.visible=o.visible;o.contact.mesh.visible=o.visible&&distance<85;o.contact.update(view.x,view.z,s.oceanTime);o.contact.mesh.rotation.y=view.heading;o.markers.visible=o.visible&&!o.animal;if(o.wake)o.wake.mesh.visible=o.visible&&o.type!=='jellyfish';if(!o.visible)continue;o.group.position.set(view.x,view.y,view.z);o.group.rotation.set(0,view.heading,view.turn);o.markers.position.set(view.x,view.y+.22,view.z);o.markers.rotation.y=s.oceanTime*.9;o.animate(s.oceanTime+o.seed,view.speed);if(o.wake?.mesh.visible)updateWake(o,s);}}
 function threat(s){let best=null,d=65;for(const o of pool){const dz=s.z-o.z;if(!o.passed&&!o.hit&&dz>0&&dz<d){best=o;d=dz;}}if(!best)return null;const info=typeof best.inspect==='function'?best.inspect():best.inspect;let hint=best.type==='grinder'?'GIỮ SPACE · THẢ ĐỂ BẬT QUA':best.type==='sawGate'?'CANH KHE CƯA · HOẶC NÉ HAI BÊN':best.type==='piston'?'CANH BÚA NÂNG · HOẶC NÉ SANG BÊN':best.type==='kaiju'?(info?.danger?'ĐUÔI ĐANG QUÉT · NÉ HOẶC NHẢY':'KAIJU PHÍA TRƯỚC · NÉ HAI BÊN'):best.height>2.6?'NGHIÊNG VÁN ĐỂ NÉ':'NÉ HOẶC BẬT QUA';return {name:best.label,type:best.type,distance:Math.round(d),side:best.x-s.x,radius:best.radius,height:best.height,hint,urgent:d<17};}
 function inspect(){return pool.map(o=>({type:o.type,row:o.row,offset:o.offset,x:o.x,y:o.y,z:o.z,heading:o.heading,velocity:[o.vx,o.vz],swimSpeed:o.speed,radius:o.radius,height:o.height,hit:o.hit,passed:o.passed,visible:o.visible,closest:o.closest,colliders:o.getColliders().length,animation:{...(typeof o.inspect==='function'?o.inspect():o.inspect)}}));}
 return {reset,step,render,threat,inspect};
}
