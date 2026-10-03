import * as THREE from './vendor/three.module.js';
export function createAura(scene){
 const group=new THREE.Group();group.name='Held aura';scene.add(group);group.visible=false;
 // Open arcs reveal their orbit instead of spinning an indistinguishable circle.
 const rings=[];for(let i=0;i<2;i++){const m=new THREE.Mesh(new THREE.TorusGeometry(.77+i*.25,.012,5,60,Math.PI*1.72),new THREE.MeshBasicMaterial({color:i?0x9affed:0xffd576,transparent:true,opacity:0,depthWrite:false}));m.rotation.x=Math.PI/2;group.add(m);rings.push(m);}
 const n=42,p=new Float32Array(n*3),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3).setUsage(THREE.DynamicDrawUsage));const mat=new THREE.PointsMaterial({color:0xffe8a4,size:.055,transparent:true,opacity:0,depthWrite:false,sizeAttenuation:true});group.add(new THREE.Points(g,mat));let blend=0,power=0,time=0;
 return {update(s,dt){
  dt=Number.isFinite(dt)?Math.max(0,dt):0;
  const held=(s.auraHeld??s.auraActive)&&s.wipe<=0;
  blend+=(Number(!!held)-blend)*(1-Math.exp(-dt*15));
  power+=(Number(!!s.auraActive)-power)*(1-Math.exp(-dt*10));
  if(dt>0)time=Number.isFinite(s.oceanTime)?s.oceanTime:time+dt;
  group.visible=blend>.015&&(s.status==='playing'||s.status==='paused')&&s.wipe<=0;if(!group.visible)return;
  group.position.set(s.x,s.y+.15,s.z);const t=time,strength=.48+power*.52;
  for(let j=0;j<2;j++){const ring=rings[j];ring.material.opacity=blend*strength*(j?.52:.8);ring.rotation.set(Math.PI/2+Math.sin(t*1.7+j)*.10,Math.cos(t*1.4+j)*.08,t*(j?-1.3:1.1)+j*Math.PI);ring.position.y=.05+j*(.13+power*.18);ring.scale.setScalar(.88+power*.12+Math.sin(t*4+j)*.035);}
  for(let i=0;i<n;i++){const u=(i/n+t*.48)%1,a=i*2.399+t*2.7,rad=.61+u*.26;p[i*3]=Math.cos(a)*rad;p[i*3+1]=u*(1.1+power*.8);p[i*3+2]=Math.sin(a)*rad;}
  g.attributes.position.needsUpdate=true;mat.opacity=blend*strength*.85;
 },clear(){blend=0;power=0;time=0;group.visible=false;}};
}
