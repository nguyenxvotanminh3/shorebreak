import * as THREE from './vendor/three.module.js';
import {sampleWater} from './water.js';
import {createSeaCreature} from './creatures.js?v=3';
import {sampleSwimPath} from './swimming.js';
import {intersectsCreature} from './collision.js';
const water={};
export function createHazards(scene){
 const types=['shark','kraken','seaSerpent','jellyfish'],offsets=[0,4,-4,2,-6,6,0,-3],pool=[];
 const view={},before={},playerBefore={x:0,y:0,z:0,yaw:0},playerNow={x:0,y:0,z:0,yaw:0};let enabled=true;
 const wakeMaterial=new THREE.MeshBasicMaterial({color:0xd8f2e9,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false});
 function makeWake(){
  const positions=new Float32Array(18*6),indices=[];
  for(let i=0;i<17;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));g.setIndex(indices);
  const mesh=new THREE.Mesh(g,wakeMaterial);mesh.frustumCulled=false;scene.add(mesh);return {mesh,positions};
 }
 for(let i=0;i<8;i++){
  const creature=createSeaCreature(types[i%4]);scene.add(creature.group);
  pool.push({...creature,type:types[i%4],index:i,offset:offsets[i],seed:i*1.87,born:0,spawnZ:0,x:0,y:0,z:0,heading:0,speed:0,vx:0,vz:0,turn:0,passed:false,hit:false,closest:Infinity,wasAirNear:false,wake:makeWake(),visible:false});
 }
 function spawn(o,s,z){o.born=s.oceanTime;o.spawnZ=z;o.offset=offsets[(o.index+Math.floor(s.time/25))%offsets.length];o.passed=o.hit=false;o.closest=Infinity;o.wasAirNear=false;sampleSwimPath(o,s.oceanTime,o);o.group.visible=false;o.wake.mesh.visible=false;}
 function reset(s){let nextZ=s.z-48;for(const o of pool){spawn(o,s,nextZ);nextZ-=50;}playerBefore.x=s.x;playerBefore.y=s.y;playerBefore.z=s.z;playerBefore.yaw=0;}
 function step(s,dt,emit){
  if(!enabled||s.status!=='playing')return;
  playerNow.x=s.x;playerNow.y=s.y;playerNow.z=s.z;playerNow.yaw=-Math.atan2(s.latVel||0,s.speed)+(s.spinAngle||0);
  for(const o of pool){
   before.x=o.x;before.y=o.y;before.z=o.z;before.heading=o.heading;before.turn=o.turn;
   sampleSwimPath(o,s.oceanTime,o);
   const dz=o.z-s.z,dx=o.x-s.x,distance=Math.hypot(dx,dz);
   if(distance<9){
    o.closest=Math.min(o.closest,distance);if(s.air&&distance<6)o.wasAirNear=true;
    if(!o.hit&&s.invulnerable<=0&&s.wipe<=0){
     const shapes=o.getColliders();
     if(intersectsCreature(playerBefore,playerNow,before,o,shapes)){o.hit=true;s.collisions++;emit('obstacle-hit',{name:o.label,type:o.type});}
    }
   }
   if(!o.passed&&dz>7){o.passed=true;if(!o.hit){s.obstaclesDodged++;emit('obstacle-clear',{name:o.label,air:o.wasAirNear,near:o.closest<4});}}
   if(dz>30){let front=s.z-145;for(const other of pool)if(other!==o)front=Math.min(front,other.z-45);spawn(o,s,front);}
  }
  Object.assign(playerBefore,playerNow);
 }
 function updateWake(o,s){
  const p=o.wake.positions;let j=0;
  for(let i=0;i<18;i++){
   const age=i*.085;sampleSwimPath(o,s.oceanTime-age,view);
   const tail=o.type==='shark'?2.6:o.type==='seaSerpent'?2.1:1;
   const backX=Math.sin(view.heading),backZ=Math.cos(view.heading),wide=(.14+age*.25)*Math.sin((i+1)/19*Math.PI);
   const cx=view.x+backX*tail,cz=view.z+backZ*tail;
   for(let side=-1;side<=1;side+=2){const x=cx+Math.cos(view.heading)*wide*side,z=cz-Math.sin(view.heading)*wide*side;sampleWater(x,z,s.oceanTime,water);p[j++]=x;p[j++]=water.h+.055;p[j++]=z;}
  }
  o.wake.mesh.geometry.attributes.position.needsUpdate=true;
 }
 function render(s){
  for(const o of pool){
   // Pure sample: never overwrite fixed-step collision state from the render loop.
   sampleSwimPath(o,s.oceanTime,view);const distance=s.z-view.z;
   o.visible=enabled&&s.status!=='menu'&&distance<145&&distance>-24;o.group.visible=o.visible;o.wake.mesh.visible=o.visible&&o.type!=='jellyfish';
   if(!o.visible)continue;
   o.group.position.set(view.x,view.y,view.z);o.group.rotation.set(0,view.heading,view.turn);
   o.animate(s.oceanTime+o.seed,view.speed);
   if(o.wake.mesh.visible)updateWake(o,s);
  }
 }
 function threat(s){let best=null,d=50;for(const o of pool){const dz=s.z-o.z;if(enabled&&!o.passed&&!o.hit&&dz>0&&dz<d){best=o;d=dz;}}return best?{name:best.label,type:best.type,distance:Math.round(d),side:best.x-s.x,radius:best.radius,height:best.height}:null;}
 return {reset,step,render,threat,setEnabled(v){enabled=!!v;},inspect(){return pool.map(o=>({type:o.type,x:o.x,y:o.y,z:o.z,heading:o.heading,velocity:[o.vx,o.vz],swimSpeed:o.speed,radius:o.radius,height:o.height,hit:o.hit,passed:o.passed,visible:o.visible,closest:o.closest,colliders:o.getColliders().length,animation:{...o.inspect}}));}};
}
