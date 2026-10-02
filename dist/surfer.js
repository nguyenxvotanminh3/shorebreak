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
 avatar.traverse(node=>{if(node.isBone){const name=node.name.replace(/[^a-z0-9]/gi,'').replace(/^mixamorig/i,'');bones[name]=node;rest.push({bone:node,q:node.quaternion.clone(),p:node.position.clone()});}if(node.isMesh){node.frustumCulled=false;node.castShadow=true;node.receiveShadow=true;triangles+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;if(node.isSkinnedMesh)skinMeshes++;node.material.roughness=Math.max(.5,node.material.roughness??.6);}});
 for(const name of ['Hips','Spine','Spine1','Spine2','Head','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'])if(!bones[name])throw new Error('Missing surfer rig bone: '+name);
 const p0=new THREE.Vector3(),p1=new THREE.Vector3(),p2=new THREE.Vector3(),dir=new THREE.Vector3(),desired=new THREE.Vector3(),bend=new THREE.Vector3(),joint=new THREE.Vector3(),tmp=new THREE.Vector3(),q0=new THREE.Quaternion(),q1=new THREE.Quaternion(),delta=new THREE.Quaternion();
 const footL=new THREE.Vector3(),footR=new THREE.Vector3(),poleL=new THREE.Vector3(),poleR=new THREE.Vector3(),handL=new THREE.Vector3(),handR=new THREE.Vector3(),elbowL=new THREE.Vector3(),elbowR=new THREE.Vector3(),toe=new THREE.Vector3(),hipTarget=new THREE.Vector3();
 const motion={charge:0,tuck:0,landing:0,phase:'trim',grab:0,lean:0,steer:0,slope:0,accel:0,time:0,aura:0,air:0,style:[1,0,0]};
 const reach=new THREE.Vector3(),palmTarget=new THREE.Vector3();
 const worldUp=new THREE.Vector3(0,1,0),deckUp=new THREE.Vector3(0,1,0),gravityLocal=new THREE.Vector3(),hipPivot=new THREE.Vector3();
 const gravityQ=new THREE.Quaternion(),rigQ=new THREE.Quaternion(),avatarInv=avatar.quaternion.clone().invert(),pelvisGravityQ=new THREE.Quaternion();
 let gravityBlend=0,comShiftX=0,comShiftZ=0;
 function upperTarget(out,x,y,z){out.set(x+comShiftX,y,z+comShiftZ).sub(hipPivot).applyQuaternion(gravityQ).add(hipPivot);return out.applyMatrix4(rig.matrixWorld);}

 const fingerRows=[];
 for(const side of ['Left','Right']){
  const axis=bones[side+'HandIndex1'].position.clone().sub(bones[side+'HandPinky1'].position).normalize();
  for(const finger of ['Index','Middle','Ring','Pinky'])for(let j=1;j<=3;j++){const bone=bones[side+'Hand'+finger+j];if(bone)fingerRows.push({bone,axis,side:side==='Right',factor:j===1?.65:1});}
 }

 function target(out,x,y,z){return out.set(x,y,z).applyMatrix4(rig.matrixWorld);}
 // Each bone keeps its anatomical bind offset. IK aligns its actual child direction,
 // preserving skin weights and continuous elbows/knees instead of moving rigid parts.
 function aim(bone,child,targetWorld){bone.getWorldPosition(p0);child.getWorldPosition(p1);dir.subVectors(p1,p0).normalize();desired.subVectors(targetWorld,p0).normalize();delta.setFromUnitVectors(dir,desired);bone.getWorldQuaternion(q0);q0.premultiply(delta);bone.parent.getWorldQuaternion(q1).invert();bone.quaternion.copy(q1.multiply(q0));bone.updateMatrixWorld(true);}
 function solve(upper,middle,end,goal,pole,arm=false){
  upper.getWorldPosition(p0);middle.getWorldPosition(p1);end.getWorldPosition(p2);
  const a=p0.distanceTo(p1),b=p1.distanceTo(p2);dir.subVectors(goal,p0);
  // Arms retain 25–35 degrees of flexion at maximum reach; legs keep exact deck contacts.
  const distance=clamp(dir.length(),Math.abs(a-b)+.006,(a+b)*(arm?.957:.9999));dir.normalize();
  reach.copy(p0).addScaledVector(dir,distance);
  const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
  bend.subVectors(pole,p0);bend.addScaledVector(dir,-bend.dot(dir));if(bend.lengthSq()<.00001)bend.set(1,0,0);bend.normalize();
  joint.copy(p0).addScaledVector(dir,along).addScaledVector(bend,height);
  aim(upper,middle,joint);aim(middle,end,reach);
 }
 const leashArray=new Float32Array(7*3),leashGeometry=new THREE.BufferGeometry();leashGeometry.setAttribute('position',new THREE.BufferAttribute(leashArray,3));const leash=new THREE.Line(leashGeometry,new THREE.LineBasicMaterial({color:0x193c42,transparent:true,opacity:.78}));rig.add(leash);
 function pose(s,dt){
  // Zero is a real pause. Never substitute a render frame for a frozen clock.
  dt=Number.isFinite(dt)?clamp(dt,0,.1):0;rig.updateMatrixWorld(true);
  if(dt>0)motion.time=Number.isFinite(s.oceanTime)?s.oceanTime:motion.time+dt;
  const phase=clamp(s.airProgress||0,0,1),tuckTarget=s.air?smooth(.10,.34,phase)*(1-smooth(.62,.91,phase)):0;
  const landElapsed=Math.max(0,.65-(s.landingTime||0));
  const landing=s.landingTime>0?(1-Math.exp(-landElapsed*32))*Math.exp(-landElapsed*4.7)*clamp(s.landingImpact||.5,.3,1.3):0;
  const k=1-Math.exp(-dt*12),balanceK=1-Math.exp(-dt*8);
  const auraHeld=(s.auraHeld??s.auraActive)&&!(s.wipe>0),style=clamp(s.auraStyle||0,0,2);
  motion.aura=mix(motion.aura,auraHeld?1:0,1-Math.exp(-dt*15));
  motion.air=mix(motion.air,s.air?1:0,1-Math.exp(-dt*11));
  for(let i=0;i<3;i++)motion.style[i]=mix(motion.style[i],i===style?1:0,k);
  motion.charge=mix(motion.charge,s.charge||0,k);motion.tuck=mix(motion.tuck,tuckTarget,k);
  motion.landing=mix(motion.landing,landing,1-Math.exp(-dt*19));
  motion.grab=mix(motion.grab,s.air?smooth(.22,.43,phase)*(1-smooth(.62,.84,phase)):0,k);
  motion.lean=mix(motion.lean,clamp(s.lean||0,-1,1),balanceK);motion.steer=mix(motion.steer,clamp(s.steer||0,-1,1),balanceK);
  motion.slope=mix(motion.slope,clamp(s.nz||0,-.4,.4),balanceK);motion.accel=mix(motion.accel,clamp(s.acceleration||0,-5,5),balanceK);
  const aura=motion.aura,airPose=motion.air*(1-smooth(.78,.98,phase)),lean=motion.lean,tuck=motion.tuck*(1-aura*.9),charge=motion.charge,grab=motion.grab*(1-aura),t=motion.time;
  const grounded=1-motion.air,breathe=Math.sin(t*1.65)*.006+Math.sin(t*3.1+.7)*.002;
  const rebound=grounded*(breathe-motion.slope*.024),weightShift=Math.sin(t*1.2+.6)*.009*grounded;
  const compress=charge*.205+tuck*.42+Math.abs(lean)*.105+motion.landing*.31;
  const hipY=.855-compress+rebound;
  // The ocean tilts the board, not gravity. Counter only 60% of the deck tilt on water.
  // Airborne support fades to board-relative so a 360 does not fight world-up.
  gravityBlend=mix(gravityBlend,s.air?0:1,1-Math.exp(-dt*(s.air?18:12)));
  rig.getWorldQuaternion(rigQ);rigQ.invert();gravityLocal.copy(worldUp).applyQuaternion(rigQ).normalize();
  gravityQ.setFromUnitVectors(deckUp,gravityLocal);gravityQ.identity().slerp(pelvisGravityQ.setFromUnitVectors(deckUp,gravityLocal),.60*gravityBlend);
  const supportHeight=Math.max(.2,hipY-.153),upY=Math.max(.65,gravityLocal.y);
  comShiftX=clamp(gravityLocal.x/upY*supportHeight*.52,-.19,.19)*gravityBlend;
  comShiftZ=clamp(gravityLocal.z/upY*supportHeight*.48,-.14,.14)*gravityBlend;
  const hipX=.018+lean*.075-charge*.035-tuck*.025+comShiftX;
  const hipZ=.035-charge*.065+tuck*.045+weightShift-motion.accel*.003+comShiftZ;
  hipPivot.set(hipX,hipY,hipZ);
  motion.phase=s.wipe>0?'recovery':aura>.25?(s.air?['aura-salute','aura-sky-king','aura-victory'][style]:'aura-balance'):s.air?(phase<.18?'extension':phase<.67?'tuck-grab':'spot-landing'):s.landingTime>.1?'absorb':charge>.1?'compress':Math.abs(lean)>.25?'bottom-turn':'trim';
  for(let i=0;i<rest.length;i++){const r=rest[i];r.bone.quaternion.copy(r.q);r.bone.position.copy(r.p);}
  target(hipTarget,hipX,hipY,hipZ);bones.Hips.parent.worldToLocal(hipTarget);bones.Hips.position.copy(hipTarget);
  bones.Hips.rotation.set(0,.035-lean*.15-motion.steer*.035,-lean*.045);
  pelvisGravityQ.copy(avatarInv).multiply(gravityQ).multiply(avatar.quaternion);
  bones.Hips.quaternion.premultiply(pelvisGravityQ);
  // Shoulders lead the turn while the pelvis stays above the feet; bend is spread through spine.
  bones.Spine.rotation.set(.12+charge*.13+tuck*.43-aura*.17,.13+lean*.15,.025-lean*.06);
  bones.Spine1.rotation.set(.06+tuck*.23,.105+lean*.12,-.045-charge*.025);
  bones.Spine2.rotation.set(.02+tuck*.11,.07+lean*.10,-lean*.035);
  bones.Neck.rotation.set(-.025,.15,0);bones.Head.rotation.set(-.07-tuck*.36-aura*.10,.34+lean*.13+aura*.16,lean*.025+aura*.13);
  rig.updateMatrixWorld(true);
  // Fixed deck contact points for every phase, including the aerial: the feet never shuffle on the board.
  target(footL,-.060,.153,-.42);target(footR,-.015,.153,.43);
  target(poleL,.55+lean*.08,.46,-.45-charge*.035);
  target(poleR,.48+lean*.08,.40,.26-tuck*.09);
  solve(bones.LeftUpLeg,bones.LeftLeg,bones.LeftFoot,footL,poleL);solve(bones.RightUpLeg,bones.RightLeg,bones.RightFoot,footR,poleR);
  if(bones.LeftToeBase){target(toe,.093,.105,-.445);aim(bones.LeftFoot,bones.LeftToeBase,toe);}
  if(bones.RightToeBase){target(toe,.139,.105,.445);aim(bones.RightFoot,bones.RightToeBase,toe);}
  const armSway=grounded*Math.sin(t*1.45+.4)*.018,armLag=motion.steer*.025;
  // Front hand guides the line. Rear arm is lower and bent rather than a symmetric T-pose.
  upperTarget(handL,mix(.31+lean*.055,.20,grab),mix(hipY+.24+armSway,hipY+.53,grab),mix(-.48-armLag,-.39,grab));
  upperTarget(handR,mix(.29-lean*.075,.277,grab),mix(hipY+.11-armSway,.19,grab),mix(.40+armLag,.10,grab));
  upperTarget(elbowL,.47+lean*.045,hipY+.12,-.32);upperTarget(elbowR,.43-lean*.04,hipY+.02,.29);
  if(aura>.001){
   // A readable salute acknowledges a held button on water. Airborne styles open
   // from it smoothly, then settle back into balance before contact with the water.
   const [salute,sky,victory]=motion.style,wave=Math.sin(t*3.8)*.024;
   const leftX=.13*salute+.36*sky+.24*victory,leftY=.64*salute+.42*sky+.82*victory,leftZ=-.34*salute-.76*sky-.49*victory;
   const rightX=.28*salute+.36*sky+.24*victory,rightY=.12*salute+.38*sky+.78*victory,rightZ=.36*salute+.76*sky+.48*victory;
   upperTarget(palmTarget,mix(.17,leftX,airPose),hipY+mix(.57,leftY,airPose)+wave,-.32+(leftZ+.32)*airPose);handL.lerp(palmTarget,aura);
   upperTarget(palmTarget,mix(.36,rightX,airPose),hipY+mix(.20,rightY,airPose)-wave*.5,mix(.48,rightZ,airPose));handR.lerp(palmTarget,aura);
   upperTarget(palmTarget,.51,hipY+mix(.30,.34*salute+.24*sky+.53*victory,airPose),-.47);elbowL.lerp(palmTarget,aura);
   upperTarget(palmTarget,.48,hipY+mix(.06,.07*salute+.19*sky+.50*victory,airPose),.51);elbowR.lerp(palmTarget,aura);
  }
  solve(bones.LeftArm,bones.LeftForeArm,bones.LeftHand,handL,elbowL,true);
  solve(bones.RightArm,bones.RightForeArm,bones.RightHand,handR,elbowR,true);
  // Wrists stay aligned with the forearm, with a small salute wave and rail-hand pronation.
  bones.LeftHand.rotation.set(.025+aura*Math.sin(t*3.8)*.07,0,.055+aura*.16);bones.RightHand.rotation.set(.025,0,-.045-grab*.12-aura*airPose*.08);
  for(let i=0;i<fingerRows.length;i++){const f=fingerRows[i];f.bone.quaternion.setFromAxisAngle(f.axis,(f.side?-1:1)*(.16+(f.side?grab*.54:0))*f.factor);}
  if(bones.RightHandThumb1)bones.RightHandThumb1.rotation.y=-.10-grab*.27;
  rig.updateMatrixWorld(true);
  for(let i=0;i<7;i++){const u=i/6;leashArray[i*3]=mix(-.08,.02,u)+Math.sin(u*Math.PI)*.21;leashArray[i*3+1]=mix(.16,.075,u)-Math.sin(u*Math.PI)*.07;leashArray[i*3+2]=mix(.44,1.01,u);}leashGeometry.attributes.position.needsUpdate=true;
 }
 function inspect(){rig.updateMatrixWorld(true);const left=bones.LeftFoot.getWorldPosition(new THREE.Vector3()),right=bones.RightFoot.getWorldPosition(new THREE.Vector3());rig.worldToLocal(left);rig.worldToLocal(right);return {type:'MakeHuman anatomical skinned mesh',bones:rest.length,skinMeshes,triangles,phase:motion.phase,tuck:motion.tuck,grab:motion.grab,aura:motion.aura,air:motion.air,auraStyle:motion.style.slice(),gravityBlend,comShift:[comShiftX,comShiftZ],feet:[left.toArray(),right.toArray()]};}
 rig.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
 pose({lean:0,charge:0,air:false,landingTime:0},1);return {rig,pose,inspect};
}
