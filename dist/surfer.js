import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a),0,1);return u*u*(3-2*u);};
export async function createSurfer(scene){
 const rig=new THREE.Group();scene.add(rig);
 const white=new THREE.MeshStandardMaterial({color:0xf6f0de,roughness:.24,metalness:.04}),teal=new THREE.MeshStandardMaterial({color:0x148582,roughness:.38}),grip=new THREE.MeshStandardMaterial({color:0x18373e,roughness:.94});
 const shape=new THREE.Shape();shape.moveTo(0,1.14);shape.bezierCurveTo(.21,1.01,.31,.37,.28,-.39);shape.bezierCurveTo(.26,-.83,.16,-1.03,.11,-1.045);shape.lineTo(-.11,-1.045);shape.bezierCurveTo(-.16,-1.03,-.26,-.83,-.28,-.39);shape.bezierCurveTo(-.31,.37,-.21,1.01,0,1.14);
 const board=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.05,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.027,bevelThickness:.024,curveSegments:20}),white);board.rotation.x=-Math.PI/2;rig.add(board);
 const stripe=new THREE.Mesh(new THREE.BoxGeometry(.052,.006,1.92),teal);stripe.position.set(0,.078,-.06);rig.add(stripe);
 const pad=new THREE.Mesh(new THREE.BoxGeometry(.36,.013,.5),grip);pad.position.set(0,.088,.64);rig.add(pad);
 for(const x of [-.17,0,.17]){const finShape=new THREE.Shape();finShape.moveTo(0,0);finShape.quadraticCurveTo(.07,-.25,.18,-.31);finShape.quadraticCurveTo(.14,-.12,.3,0);const fin=new THREE.Mesh(new THREE.ShapeGeometry(finShape,8),grip);fin.rotation.y=Math.PI/2;fin.position.set(x,-.01,.59);rig.add(fin);}
 const gltf=await new GLTFLoader().loadAsync(new URL('./assets/surfer-athlete.glb',import.meta.url).href);
 const avatar=gltf.scene;avatar.name='Anatomical surfer';avatar.rotation.y=Math.PI/2;avatar.scale.setScalar(1.045);rig.add(avatar);
 const bones={},rest=[];let triangles=0,skinMeshes=0;
 avatar.traverse(node=>{if(node.isBone){const name=node.name.replace(/[^a-z0-9]/gi,'').replace(/^mixamorig/i,'');bones[name]=node;rest.push({bone:node,q:node.quaternion.clone(),p:node.position.clone()});}if(node.isMesh){node.frustumCulled=false;node.castShadow=false;node.receiveShadow=false;triangles+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;if(node.isSkinnedMesh)skinMeshes++;node.material.roughness=Math.max(.5,node.material.roughness??.6);}});
 for(const name of ['Hips','Spine','Spine1','Spine2','Head','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'])if(!bones[name])throw new Error('Missing surfer rig bone: '+name);
 const p0=new THREE.Vector3(),p1=new THREE.Vector3(),p2=new THREE.Vector3(),dir=new THREE.Vector3(),desired=new THREE.Vector3(),bend=new THREE.Vector3(),joint=new THREE.Vector3(),tmp=new THREE.Vector3(),q0=new THREE.Quaternion(),q1=new THREE.Quaternion(),delta=new THREE.Quaternion();
 const footL=new THREE.Vector3(),footR=new THREE.Vector3(),poleL=new THREE.Vector3(),poleR=new THREE.Vector3(),handL=new THREE.Vector3(),handR=new THREE.Vector3(),elbowL=new THREE.Vector3(),elbowR=new THREE.Vector3(),toe=new THREE.Vector3(),hipTarget=new THREE.Vector3();
 const motion={charge:0,tuck:0,landing:0,phase:'trim',grab:0};
 function target(out,x,y,z){return out.set(x,y,z).applyMatrix4(rig.matrixWorld);}
 // Each bone keeps its anatomical bind offset. IK aligns its actual child direction,
 // preserving skin weights and continuous elbows/knees instead of moving rigid parts.
 function aim(bone,child,targetWorld){bone.getWorldPosition(p0);child.getWorldPosition(p1);dir.subVectors(p1,p0).normalize();desired.subVectors(targetWorld,p0).normalize();delta.setFromUnitVectors(dir,desired);bone.getWorldQuaternion(q0);q0.premultiply(delta);bone.parent.getWorldQuaternion(q1).invert();bone.quaternion.copy(q1.multiply(q0));bone.updateMatrixWorld(true);}
 function solve(upper,middle,end,goal,pole){upper.getWorldPosition(p0);middle.getWorldPosition(p1);end.getWorldPosition(p2);const a=p0.distanceTo(p1),b=p1.distanceTo(p2);dir.subVectors(goal,p0);const distance=clamp(dir.length(),Math.abs(a-b)+.0001,a+b-.0001);dir.normalize();const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));bend.subVectors(pole,p0);bend.addScaledVector(dir,-bend.dot(dir));if(bend.lengthSq()<.00001)bend.set(1,0,0);bend.normalize();joint.copy(p0).addScaledVector(dir,along).addScaledVector(bend,height);aim(upper,middle,joint);aim(middle,end,goal);}
 const leashArray=new Float32Array(7*3),leashGeometry=new THREE.BufferGeometry();leashGeometry.setAttribute('position',new THREE.BufferAttribute(leashArray,3));const leash=new THREE.Line(leashGeometry,new THREE.LineBasicMaterial({color:0x193c42,transparent:true,opacity:.78}));rig.add(leash);
 function pose(s,dt){
  const phase=s.airProgress||0,tuckTarget=s.air?smooth(.075,.28,phase)*(1-smooth(.65,.9,phase)):0;
  const landElapsed=.65-(s.landingTime||0),landing=s.landingTime>0?(1-Math.exp(-landElapsed*35))*Math.exp(-landElapsed*5)*(s.landingImpact||.5):0;
  const k=1-Math.exp(-dt*13);motion.charge=mix(motion.charge,s.charge||0,k);motion.tuck=mix(motion.tuck,tuckTarget,k);motion.landing=mix(motion.landing,landing,k);motion.grab=smooth(.15,.4,phase)*(1-smooth(.6,.83,phase))*(s.air?1:0);
  motion.phase=s.wipe>0?'recovery':s.air?(phase<.14?'extension':phase<.65?'tuck-grab':'spot-landing'):s.landingTime>.1?'absorb':motion.charge>.1?'compress':Math.abs(s.lean)>.25?'bottom-turn':'trim';
  for(const r of rest){r.bone.quaternion.copy(r.q);r.bone.position.copy(r.p);}
  const lean=s.lean||0,tuck=motion.tuck,charge=motion.charge,compress=charge*.21+tuck*.42+Math.abs(lean)*.095+motion.landing*.23;
  const hipY=.91-compress,hipX=lean*.105+tuck*.055,hipZ=.025-charge*.05-tuck*.055;
  target(hipTarget,hipX,hipY,hipZ);bones.Hips.parent.worldToLocal(hipTarget);bones.Hips.position.copy(hipTarget);bones.Hips.rotation.y=lean*.08;
  bones.Spine.rotation.set(.12+charge*.13+tuck*.26, .10+lean*.1, -.04-lean*.08);
  bones.Spine1.rotation.set(.055+tuck*.12,.12,-.035-charge*.03);
  bones.Spine2.rotation.set(.03+tuck*.09,.12+lean*.08,lean*.06);
  bones.Neck.rotation.y=.15; bones.Head.rotation.set(-.11-tuck*.18,.42+lean*.07,0);
  rig.updateMatrixWorld(true);
  target(footL,-.06,.153,-.42+tuck*.095);target(footR,-.015,.153,.43-tuck*.045);
  target(poleL,.73,.53,-.59);target(poleR,.64,.45,.29);
  solve(bones.LeftUpLeg,bones.LeftLeg,bones.LeftFoot,footL,poleL);solve(bones.RightUpLeg,bones.RightLeg,bones.RightFoot,footR,poleR);
  if(bones.LeftToeBase){target(toe,.093,.105,-.445+tuck*.095);aim(bones.LeftFoot,bones.LeftToeBase,toe);}
  if(bones.RightToeBase){target(toe,.139,.105,.445-tuck*.045);aim(bones.RightFoot,bones.RightToeBase,toe);}
  const grab=motion.grab;
  target(handL,mix(.29+lean*.16,.13,grab),mix(1.04-compress*.62,hipY+.86,grab),mix(-.72,-.53,grab));
  target(handR,mix(.37-lean*.16,.25,grab),mix(.96-compress*.66,.19,grab),mix(.57,.10,grab));
  target(elbowL,.64,hipY+.25,-.48);target(elbowR,.69,hipY+.20,.40);
  solve(bones.LeftArm,bones.LeftForeArm,bones.LeftHand,handL,elbowL);solve(bones.RightArm,bones.RightForeArm,bones.RightHand,handR,elbowR);
  bones.LeftHand.rotation.z=-.08; bones.RightHand.rotation.z=-.12-grab*.20;
  for(const side of ['Left','Right'])for(const finger of ['Index','Middle','Ring','Pinky'])for(let j=1;j<=3;j++){const b=bones[side+'Hand'+finger+j];if(b)b.rotation.x=.13+(side==='Right'?grab*.55:0);}
  rig.updateMatrixWorld(true);
  for(let i=0;i<7;i++){const t=i/6;leashArray[i*3]=mix(-.08,.02,t)+Math.sin(t*Math.PI)*.21;leashArray[i*3+1]=mix(.16,.075,t)-Math.sin(t*Math.PI)*.07;leashArray[i*3+2]=mix(.44,1.01,t);}leashGeometry.attributes.position.needsUpdate=true;
 }
 function inspect(){rig.updateMatrixWorld(true);const left=bones.LeftFoot.getWorldPosition(new THREE.Vector3()),right=bones.RightFoot.getWorldPosition(new THREE.Vector3());rig.worldToLocal(left);rig.worldToLocal(right);return {type:'MakeHuman anatomical skinned mesh',bones:rest.length,skinMeshes,triangles,phase:motion.phase,tuck:motion.tuck,grab:motion.grab,feet:[left.toArray(),right.toArray()]};}
 pose({lean:0,charge:0,air:false,landingTime:0},1);return {rig,pose,inspect};
}
