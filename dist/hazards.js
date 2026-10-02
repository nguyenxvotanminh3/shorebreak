import * as THREE from './vendor/three.module.js';
import {sampleWater} from './water.js';
import {createSeaCreature} from './creatures.js';
const sample={};
export function createHazards(scene){
 const types=['shark','kraken','seaSerpent','jellyfish'];
 const offsets=[0,5,-4,1,-7,7,0,-3];
 const pool=[];let nextZ=0,enabled=true;
 const ringMaterial=new THREE.MeshBasicMaterial({color:0xffab7b,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false});
 for(let i=0;i<8;i++){
  const type=types[i%types.length],creature=createSeaCreature(type),ring=new THREE.Mesh(new THREE.RingGeometry(creature.radius+.2,creature.radius+.27,48),ringMaterial);ring.rotation.x=-Math.PI/2;ring.position.y=.12;creature.group.add(ring);scene.add(creature.group);
  pool.push({...creature,type,index:i,offset:offsets[i],z:0,x:0,y:0,passed:false,hit:false,ring,seed:i*1.87,near:false});
 }
 function reset(s){nextZ=s.z-58;for(const o of pool){o.z=nextZ;nextZ-=62;o.passed=false;o.hit=false;o.offset=offsets[o.index];o.group.visible=false;}}
 function position(o,t){const drift=o.type==='shark'?Math.sin(t*.65+o.seed)*1.6:o.type==='jellyfish'?Math.sin(t*.45+o.seed)*.9:0;o.x=(t*.72-o.z*.035+.4)/.23+o.offset+drift;sampleWater(o.x,o.z,t,sample);o.y=sample.h;}
 function step(s,dt,emit){if(!enabled||s.status!=='playing')return;
  for(const o of pool){position(o,s.oceanTime);const dz=o.z-s.z,dx=o.x-s.x,dist=Math.hypot(dx,dz),clearance=s.y-o.y;
   if(!o.hit&&s.invulnerable<=0&&s.wipe<=0&&dist<o.radius+.35&&clearance<o.height+.18&&clearance>-.8){o.hit=true;s.collisions++;emit('obstacle-hit',{name:o.label,type:o.type});}
   if(!o.passed&&dz>o.radius+1.5){o.passed=true;if(!o.hit){s.obstaclesDodged++;emit('obstacle-clear',{name:o.label,air:s.air||clearance>1.2,near:Math.abs(dx)<o.radius+2});}}
   if(dz>26){o.z=nextZ;nextZ-=58+(o.index%3)*9;o.offset=offsets[(o.index+Math.floor(s.time/25))%offsets.length];o.passed=false;o.hit=false;}
  }
 }
 function render(s){for(const o of pool){const distance=s.z-o.z;o.group.visible=enabled&&s.status!=='menu'&&distance<145&&distance>-20;if(!o.group.visible)continue;position(o,s.oceanTime);o.group.position.set(o.x,o.y,o.z);o.group.rotation.y=o.type==='shark'?.55+Math.cos(s.oceanTime*.65+o.seed)*.18:0;o.animate(s.oceanTime+o.seed);o.ring.visible=!o.passed&&!o.hit&&distance<55;o.ring.scale.setScalar(1+Math.sin(s.oceanTime*4)*.035);}}
 function threat(s){let best=null,bestDistance=50;for(const o of pool){const distance=s.z-o.z;if(enabled&&!o.passed&&!o.hit&&distance>-.5&&distance<bestDistance){best=o;bestDistance=distance;}}return best?{name:best.label,type:best.type,distance:Math.max(0,Math.round(bestDistance)),side:best.x-s.x,radius:best.radius,height:best.height}:null;}
 return {reset,step,render,threat,setEnabled(v){enabled=!!v;},inspect(){return pool.map(o=>({type:o.type,x:o.x,y:o.y,z:o.z,radius:o.radius,height:o.height,hit:o.hit,passed:o.passed,visible:o.group.visible}));}};
}
