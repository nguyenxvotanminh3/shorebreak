import * as THREE from './vendor/three.module.js';
export function createAura(scene){
 const group=new THREE.Group();scene.add(group);group.visible=false;
 const rings=[];for(let i=0;i<2;i++){const m=new THREE.Mesh(new THREE.TorusGeometry(.77+i*.25,.009,4,60),new THREE.MeshBasicMaterial({color:i?0x9affed:0xffd576,transparent:true,opacity:0,depthWrite:false}));m.rotation.x=Math.PI/2;group.add(m);rings.push(m);}
 const n=42,p=new Float32Array(n*3),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3).setUsage(THREE.DynamicDrawUsage));const mat=new THREE.PointsMaterial({color:0xffe8a4,size:.047,transparent:true,opacity:0,depthWrite:false,sizeAttenuation:true});group.add(new THREE.Points(g,mat));let blend=0;
 return {update(s,dt){blend+=(Number(!!s.auraActive)-blend)*(1-Math.exp(-dt*12));group.visible=blend>.015&&s.status==='playing'&&s.wipe<=0;if(!group.visible)return;group.position.set(s.x,s.y+.1,s.z);const t=s.oceanTime;for(let j=0;j<2;j++){rings[j].material.opacity=blend*(j?.45:.7);rings[j].rotation.z=t*(j?-1:1);rings[j].scale.setScalar(1+Math.sin(t*4+j)*.04);}for(let i=0;i<n;i++){const u=(i/n+t*.48)%1,a=i*2.399+t*2.7,rad=.65+u*.28;p[i*3]=Math.cos(a)*rad;p[i*3+1]=u*1.8;p[i*3+2]=Math.sin(a)*rad;}g.attributes.position.needsUpdate=true;mat.opacity=blend*.85;},clear(){blend=0;group.visible=false;}};
}
