import * as THREE from './vendor/three.module.js';

export const DEEP_BOUNDS=Object.freeze({minX:-215,maxX:215,minZ:-420,maxZ:75});
export const RIG_SITE=Object.freeze({x:45,z:-335});

/** Southern extension; no old reef tile, collider or seeded plant is rebuilt. */
export function createDeepBasin(scene,{terrain}={}){
 if(typeof terrain!=='function')throw new TypeError('Deep basin requires shared terrain');
 const root=new THREE.Group();root.name='Deep basin / southern drilling field';scene.add(root);
 const geometries=new Set(),materials=new Set(),tiles=[],colliders=[];
 const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1});materials.add(material);
 const shallow=new THREE.Color(0x284451),deep=new THREE.Color(0x182c39),color=new THREE.Color();
 for(let row=0;row<4;row++)for(let column=0;column<8;column++){
  const x=-220+column*55+27.5,z=-230-row*52.5-26.25;
  const geometry=new THREE.PlaneGeometry(55,52.5,20,20);geometry.rotateX(-Math.PI/2);geometry.translate(x,0,z);
  const positions=geometry.attributes.position,colors=new Float32Array(positions.count*3);
  for(let i=0;i<positions.count;i++){
   const px=positions.getX(i),pz=positions.getZ(i),y=terrain(px,pz);positions.setY(i,y);
   const d=Math.max(0,Math.min(1,(-y-70)/65)),ripple=.92+.08*(.5+.5*Math.sin(px*.56+pz*.77));
   color.copy(shallow).lerp(deep,d).multiplyScalar(ripple).toArray(colors,i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();geometries.add(geometry);
  const mesh=new THREE.Mesh(geometry,material);mesh.name=`Deep terrain ${column}:${row}`;root.add(mesh);tiles.push({mesh,x,z});
 }
 // Low-cost outer rock shoulders keep the enormous site framed without blocking
 // the entrance corridor. Their circular colliders are shared with player physics.
 const pillar=new THREE.CylinderGeometry(.72,1,1,7,2),stone=new THREE.MeshStandardMaterial({color:0x172c38,roughness:1,flatShading:true});geometries.add(pillar);materials.add(stone);
 const shoulders=new THREE.InstancedMesh(pillar,stone,20),temporary=new THREE.Object3D();shoulders.name='Deep basin rim buttresses';root.add(shoulders);
 for(let i=0;i<20;i++){
  const side=i%2?1:-1,x=side*(164+Math.sin(i*4.3)*12),z=-250-Math.floor(i/2)*17,h=18+7*(.5+.5*Math.sin(i*2.3)),radius=8+3*(.5+.5*Math.cos(i*1.2)),y=terrain(x,z)+h*.35;
  temporary.position.set(x,y,z);temporary.rotation.set(0,i*2.399,0);temporary.scale.set(radius,h,radius*.85);temporary.updateMatrix();shoulders.setMatrixAt(i,temporary.matrix);colliders.push({x,y,z,radius:radius*.91,height:h});
 }
 shoulders.instanceMatrix.needsUpdate=true;shoulders.computeBoundingSphere();
 let disposed=false,cullAt=-Infinity;
 const stats={terrainTiles:32,terrainTriangles:32*20*20*2,geometries:geometries.size,materials:materials.size,shoulders:20,visibleTiles:0,quality:'medium'};
 function update(dt,time,player,quality='medium'){
  if(disposed)return;const p=player?.position||player||{x:0,z:18};
  if(!Number.isFinite(p.x)||!Number.isFinite(p.z))return;
  const changed=stats.quality!==quality;stats.quality=quality;
  if(!changed&&Number.isFinite(time)&&time>=cullAt&&time-cullAt<.25)return;
  cullAt=Number.isFinite(time)?time:cullAt+.25;
  const radius=quality==='low'?115:quality==='high'?215:170;let count=0;
  for(const tile of tiles){tile.mesh.visible=Math.hypot(p.x-tile.x,p.z-tile.z)<radius+38;if(tile.mesh.visible)count++;}
  shoulders.visible=p.z< -100;stats.visibleTiles=count;
 }
 function dispose(){if(disposed)return;disposed=true;scene.remove(root);for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();root.clear();colliders.length=0;tiles.length=0;}
 update(0,0,{x:0,z:18});
 return{root,update,dispose,stats,colliders,bounds:DEEP_BOUNDS,site:{x:RIG_SITE.x,y:terrain(RIG_SITE.x,RIG_SITE.z),z:RIG_SITE.z}};
}
