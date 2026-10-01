import * as THREE from './vendor/three.module.js';
export function createSurfer(scene){
 const rig=new THREE.Group();scene.add(rig);const body=new THREE.Group();rig.add(body);
 const material=(c,roughness=.65)=>new THREE.MeshStandardMaterial({color:c,roughness});
 const skin=material(0xc78d68),jersey=material(0xf0efe2),shorts=material(0x264b50),hair=material(0x35271e),cream=material(0xf8efdb,.3),orange=material(0xe7824c,.35),dark=material(0x25474a);
 const shape=new THREE.Shape();shape.moveTo(0,1.64);shape.bezierCurveTo(.32,1.5,.48,.6,.42,-.55);shape.bezierCurveTo(.39,-1.2,.25,-1.46,.16,-1.48);shape.lineTo(-.16,-1.48);shape.bezierCurveTo(-.25,-1.46,-.39,-1.2,-.42,-.55);shape.bezierCurveTo(-.48,.6,-.32,1.5,0,1.64);
 const board=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.1,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.045,bevelThickness:.035,curveSegments:14}),cream);board.rotation.x=-Math.PI/2;rig.add(board);
 const stripe=new THREE.Mesh(new THREE.BoxGeometry(.11,.008,2.92),orange);stripe.position.set(0,.153,-.02);rig.add(stripe);
 const pad=new THREE.Mesh(new THREE.BoxGeometry(.48,.016,.6),dark);pad.position.set(0,.16,.86);rig.add(pad);
 const tip=new THREE.Mesh(new THREE.BoxGeometry(.34,.01,.11),orange);tip.position.set(0,.157,-1.04);rig.add(tip);
 for(const x of [-.23,.23]){const fin=new THREE.Mesh(new THREE.ConeGeometry(.12,.3,3),dark);fin.rotation.z=Math.PI;fin.position.set(x,-.14,.91);rig.add(fin);}
 const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.23,.37,4,8),jersey);body.add(torso);
 const hip=new THREE.Mesh(new THREE.CapsuleGeometry(.24,.08,3,8),shorts);hip.rotation.z=Math.PI/2;body.add(hip);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.18,12,10),skin);body.add(head);
 const cap=new THREE.Mesh(new THREE.SphereGeometry(.185,12,8,0,Math.PI*2,0,Math.PI*.59),hair);head.add(cap);cap.position.y=.018;
 const nose=new THREE.Mesh(new THREE.SphereGeometry(.055,6,5),skin);nose.position.set(0,-.015,-.17);head.add(nose);
 const limbs=[];const v=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
 function limb(radius,mat){const m=new THREE.Mesh(new THREE.CylinderGeometry(radius*.88,radius,1,7),mat);body.add(m);limbs.push(m);return m;}
 const leftLeg=[limb(.11,shorts),limb(.076,skin)],rightLeg=[limb(.11,shorts),limb(.076,skin)],leftArm=[limb(.063,skin),limb(.047,skin)],rightArm=[limb(.063,skin),limb(.047,skin)];
 const feet=[];for(let i=0;i<2;i++){const f=new THREE.Mesh(new THREE.CapsuleGeometry(.067,.17,3,6),skin);f.rotation.z=Math.PI/2;body.add(f);feet.push(f);}
 function bone(mesh,a,b){mesh.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);v.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);mesh.scale.y=v.length();mesh.quaternion.setFromUnitVectors(up,v.normalize());}
 function pose(lean,charge,air,t){const crouch=charge*.28,cy=1.04-crouch;hip.position.set(lean*.1,cy,.12);torso.position.set(lean*.16,cy+.37,-.03);torso.rotation.z=-lean*.22;torso.rotation.x=-.16-charge*.15;head.position.set(lean*.21,cy+.86,-.11);
 const lf=[-.18,.23,-.46],rf=[.17,.23,.67],lk=[-.33+lean*.12,.64-crouch*.45,-.17],rk=[.32+lean*.1,.58-crouch*.38,.51];
 bone(leftLeg[0],[-.15+lean*.1,cy,.04],lk);bone(leftLeg[1],lk,lf);bone(rightLeg[0],[.16+lean*.1,cy,.22],rk);bone(rightLeg[1],rk,rf);feet[0].position.set(...lf);feet[1].position.set(...rf);
 const ls=[-.23+lean*.16,cy+.54,-.02],rs=[.23+lean*.16,cy+.54,-.02],le=[-.54,cy+.3+air*.2,-.17+lean*.16],re=[.53,cy+.3+air*.2,.1-lean*.2];
 bone(leftArm[0],ls,le);bone(leftArm[1],le,[-.78,cy+.27+air*.27,-.36+lean*.2]);bone(rightArm[0],rs,re);bone(rightArm[1],re,[.79,cy+.22+air*.24,-.08-lean*.3]);}
 pose(0,0,0,0);return {rig,pose};
}
