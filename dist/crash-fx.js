import * as THREE from './vendor/three.module.js';

// A pooled slapstick fracture of the actual posed surfer mesh. All skinning/baking
// happens once per crash; ordinary updates move ten rigid anatomical fragments.
export function createCrashFX(scene, surfer) {
  const DURATION = 2.4, BLOOD_COUNT = 78, SPRAY_COUNT = 34;
  const root = new THREE.Group(); root.name = 'SHOREBREAK comic crash'; root.visible = false; scene.add(root);
  const pieces = [], draws = [], names = ['head','torso','upperArmL','foreArmL','upperArmR','foreArmR','thighL','calfL','thighR','calfR'];
  const v = new THREE.Vector3(), center = new THREE.Vector3(), origin = new THREE.Vector3(), dummy = new THREE.Object3D();
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const fragments = new Map();
  let age = DURATION, active = false, crashes = 0, totalTriangles = 0, bakedVertices = 0, waterImpacts = 0, randomState = 1;
  function random() { randomState = (Math.imul(randomState,1664525)+1013904223)>>>0; return randomState/4294967296; }
  function groupFor(name) {
    const n = name.replace(/[^a-z0-9]/gi,'').replace(/^mixamorig/i,'');
    if (/Head|Neck/.test(n)) return 0;
    const side = n.startsWith('Left') ? 0 : n.startsWith('Right') ? 1 : -1;
    if (side<0) return 1;
    if (/Hand|ForeArm/.test(n)) return side ? 5 : 3;
    if (/Arm/.test(n)) return side ? 4 : 2;
    if (/Toe|Foot|Leg$/.test(n) && !/UpLeg/.test(n)) return side ? 9 : 7;
    if (/UpLeg/.test(n)) return side ? 8 : 6;
    return 1;
  }
  for(let i=0;i<names.length;i++) {
    const group=new THREE.Group(); group.name='Crash '+names[i];root.add(group);
    const p={group,parts:[],velocity:new THREE.Vector3(),spin:new THREE.Vector3(),center:new THREE.Vector3(),count:0,radius:.16,hit:false,seed:i*.73};
    pieces.push(p);fragments.set(i,p);
  }
  surfer.rig.traverse(mesh => {
    if(!mesh.isSkinnedMesh) return;
    const geometry=mesh.geometry, pos=geometry.attributes.position, skinIndex=geometry.attributes.skinIndex, weights=geometry.attributes.skinWeight;
    const index=geometry.index, n=index ? index.count : pos.count, boneGroups=mesh.skeleton.bones.map(b=>groupFor(b.name));
    const partition=Array.from({length:names.length},()=>[]), score=new Float32Array(names.length);
    for(let t=0;t<n;t+=3) {
      score.fill(0);
      for(let k=0;k<3;k++) {const vi=index ? index.getX(t+k) : t+k;for(let j=0;j<4;j++) score[boneGroups[skinIndex.array[vi*4+j]]] += weights.array[vi*4+j];}
      let winner=0;for(let j=1;j<score.length;j++)if(score[j]>score[winner])winner=j;
      for(let k=0;k<3;k++)partition[winner].push(index ? index.getX(t+k) : t+k);
    }
    for(let g=0;g<partition.length;g++) {
      if(!partition[g].length) continue;
      const remap=new Map(),source=[],triangles=[],uv=geometry.attributes.uv,uvs=[];
      for(const old of partition[g]) {if(!remap.has(old)){remap.set(old,source.length);source.push(old);if(uv)uvs.push(uv.getX(old),uv.getY(old));}triangles.push(remap.get(old));}
      const baked=new THREE.BufferGeometry();baked.setAttribute('position',new THREE.BufferAttribute(new Float32Array(source.length*3),3).setUsage(THREE.DynamicDrawUsage));
      baked.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(source.length*3),3));
      if(uv)baked.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));baked.setIndex(triangles);
      const original=Array.isArray(mesh.material)?mesh.material[0]:mesh.material,material=original.clone();material.transparent=true;material.depthWrite=true;material.side=THREE.DoubleSide;material.forceSinglePass=true;
      const chunk=new THREE.Mesh(baked,material);chunk.frustumCulled=false;chunk.name=names[g]+' '+original.name;pieces[g].group.add(chunk);
      const part={sourceMesh:mesh,sourceIndices:new Uint32Array(source),geometry:baked,mesh:chunk,material,opacity:original.opacity??1};
      pieces[g].parts.push(part);draws.push(part);totalTriangles+=triangles.length/3;bakedVertices+=source.length;
    }
  });
  // Keep the real board visible while the regular surfer rig is hidden.
  const flyingBoard=new THREE.Group();flyingBoard.name='Flying surfboard';root.add(flyingBoard);
  const boardMaterials=[],boardVelocity=new THREE.Vector3(),boardSpin=new THREE.Vector3(),focus=new THREE.Vector3(),focusTarget=new THREE.Vector3();
  let boardHit=false,boardDraws=0;
  for(let i=0;i<surfer.rig.children.length;i++){const source=surfer.rig.children[i];if(!source.isMesh||source.isSkinnedMesh)continue;
    const copy=source.clone(false);copy.material=source.material.clone();copy.material.transparent=true;copy.material.forceSinglePass=true;copy.frustumCulled=false;flyingBoard.add(copy);boardMaterials.push({material:copy.material,opacity:source.material.opacity??1});boardDraws++;
  }
  const dropGeometry=new THREE.IcosahedronGeometry(1,0);
  const bloodMaterial=new THREE.MeshBasicMaterial({color:0x8f1733,transparent:true,opacity:1,depthWrite:false});
  const sprayMaterial=new THREE.MeshBasicMaterial({color:0xd8fcff,transparent:true,opacity:.9,depthWrite:false});
  const bloodMesh=new THREE.InstancedMesh(dropGeometry,bloodMaterial,BLOOD_COUNT),sprayMesh=new THREE.InstancedMesh(dropGeometry,sprayMaterial,SPRAY_COUNT);
  bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);sprayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);bloodMesh.frustumCulled=sprayMesh.frustumCulled=false;
  bloodMesh.name='Cartoon dark red spray';sprayMesh.name='Sea impact foam';root.add(bloodMesh,sprayMesh);
  function pool(count,mesh){return {count,mesh,p:new Float32Array(count*3),v:new Float32Array(count*3),life:new Float32Array(count),size:new Float32Array(count)};}
  const blood=pool(BLOOD_COUNT,bloodMesh),spray=pool(SPRAY_COUNT,sprayMesh);
  const ringGeometry=new THREE.TorusGeometry(1,.028,3,36),rings=[];
  for(let i=0;i<2;i++){const m=new THREE.MeshBasicMaterial({color:i?0x72d9df:0xf2ffff,transparent:true,opacity:.7,depthWrite:false});const ring=new THREE.Mesh(ringGeometry,m);ring.rotation.x=Math.PI/2;root.add(ring);rings.push(ring);}
  function hideParticles(pool){for(let i=0;i<pool.count;i++){pool.life[i]=0;dummy.position.set(0,-1000,0);dummy.scale.setScalar(0);dummy.updateMatrix();pool.mesh.setMatrixAt(i,dummy.matrix);}pool.mesh.instanceMatrix.needsUpdate=true;}
  hideParticles(blood);hideParticles(spray);
  function waterHeight(sample,x,z,time) {if(!sample)return 0;const result=sample(x,z,time);return typeof result==='number'?result:(result?.height??result?.h??result?.y??0);}
  function seedPool(pool,ox,oy,oz,vx,vz,force,isBlood) {
    for(let i=0;i<pool.count;i++){const a=random()*Math.PI*2,r=(.5+random())*(isBlood?2.6:3.2)*force,j=i*3;
      pool.p[j]=ox+(random()-.5)*.22;pool.p[j+1]=oy+(isBlood?random()*.32:random()*.06);pool.p[j+2]=oz+(random()-.5)*.22;
      pool.v[j]=Math.cos(a)*r+vx*.2;pool.v[j+1]=(isBlood?2+random()*3.1:1.8+random()*2.7)*force;pool.v[j+2]=Math.sin(a)*r+vz*.2;
      pool.life[i]=isBlood?.58+random()*.75:.35+random()*.45;pool.size[i]=isBlood?.023+random()*.047:.024+random()*.067;
    }
  }
  function burst(event={}) {
    age=0;active=true;crashes++;waterImpacts=0;root.visible=true;
    randomState=((event.time??crashes)*100003+crashes*719)>>>0;
    surfer.rig.updateMatrixWorld(true);origin.set(event.x??surfer.rig.position.x,event.y??surfer.rig.position.y,event.z??surfer.rig.position.z);
    const force=clamp(event.force??1,.55,1.65),vx=event.vx??0,vz=event.vz??0;
    for(let g=0;g<pieces.length;g++) {
      const piece=pieces[g];center.set(0,0,0);let count=0;
      piece.group.visible=piece.parts.length>0;piece.group.quaternion.identity();piece.group.scale.setScalar(1);piece.hit=false;
      for(let j=0;j<piece.parts.length;j++) {
        const part=piece.parts[j],mesh=part.sourceMesh;mesh.skeleton.update();const out=part.geometry.attributes.position;
        for(let k=0;k<part.sourceIndices.length;k++){const si=part.sourceIndices[k];v.fromBufferAttribute(mesh.geometry.attributes.position,si);mesh.applyBoneTransform(si,v);v.applyMatrix4(mesh.matrixWorld);out.setXYZ(k,v.x,v.y,v.z);center.add(v);count++;}
        part.material.opacity=part.opacity;
      }
      if(!count)continue;center.multiplyScalar(1/count);piece.center.copy(center);piece.group.position.copy(center);let radius=0;
      for(let j=0;j<piece.parts.length;j++){const part=piece.parts[j],out=part.geometry.attributes.position;for(let k=0;k<out.count;k++){v.fromBufferAttribute(out,k).sub(center);out.setXYZ(k,v.x,v.y,v.z);radius=Math.max(radius,v.length());}out.needsUpdate=true;part.geometry.computeVertexNormals();}
      piece.radius=Math.min(.3,radius*.36);
      const angle=Math.atan2(center.z-origin.z,center.x-origin.x)+(random()-.5)*1.4,scatter=(g===1?1.1:2.1+random()*1.4)*force;
      piece.velocity.set(vx*.4+Math.cos(angle)*scatter,(g===0?5.0:3.2+random()*2.2)*force,vz*.4+Math.sin(angle)*scatter);
      piece.spin.set((random()-.5)*13,(random()-.5)*11,(random()-.5)*15);
    }
    surfer.rig.getWorldPosition(flyingBoard.position);surfer.rig.getWorldQuaternion(flyingBoard.quaternion);surfer.rig.getWorldScale(flyingBoard.scale);
    boardVelocity.set(vx*.52+1.1*force,3.5*force,vz*.52-.8*force);boardSpin.set(4.8,-2.4,3.9);boardHit=false;focus.copy(origin);focus.y+=.6;
    for(let i=0;i<boardMaterials.length;i++)boardMaterials[i].material.opacity=boardMaterials[i].opacity;
    seedPool(blood,origin.x,origin.y+.78,origin.z,vx,vz,force,true);seedPool(spray,origin.x,origin.y+.05,origin.z,vx,vz,force,false);
    for(let i=0;i<rings.length;i++){rings[i].position.set(origin.x,origin.y+.06+i*.012,origin.z);rings[i].scale.setScalar(.24);rings[i].visible=true;}
    updateParticles(blood,0,1,true);updateParticles(spray,0,1,false);
    return DURATION;
  }
  function updateParticles(pool,dt,fade,isBlood) {
    let alive=0;
    for(let i=0;i<pool.count;i++){const j=i*3;pool.life[i]-=dt;
      if(pool.life[i]>0){alive++;pool.v[j+1]-=(isBlood?11:10)*dt;pool.p[j]+=pool.v[j]*dt;pool.p[j+1]+=pool.v[j+1]*dt;pool.p[j+2]+=pool.v[j+2]*dt;
        dummy.position.set(pool.p[j],pool.p[j+1],pool.p[j+2]);const size=pool.size[i]*Math.min(1,pool.life[i]*5)*fade;dummy.scale.set(size,size*(isBlood?1.55:1),size);
      }else{dummy.position.set(0,-1000,0);dummy.scale.setScalar(0);}
      dummy.rotation.set(0,0,0);dummy.updateMatrix();pool.mesh.setMatrixAt(i,dummy.matrix);
    }pool.mesh.instanceMatrix.needsUpdate=true;return alive;
  }
  function update(dt,waterSample,worldTime=0) {
    if(!active)return;dt=clamp(dt,0,.05);age+=dt;if(age>=DURATION){clear();return;}
    const fade=clamp((DURATION-age)/.5,0,1);
    for(let i=0;i<pieces.length;i++) {
      const p=pieces[i];if(!p.parts.length)continue;
      const y=waterHeight(waterSample,p.group.position.x,p.group.position.z,worldTime);
      if(!p.hit){p.velocity.y-=9.5*dt;p.group.position.addScaledVector(p.velocity,dt);if(p.group.position.y<y+p.radius*.18 && p.velocity.y<0){p.hit=true;waterImpacts++;p.group.position.y=y+p.radius*.18;p.velocity.y=Math.abs(p.velocity.y)*.16;p.velocity.x*=.55;p.velocity.z*=.55;}}
      else{const drag=Math.exp(-dt*2.4);p.velocity.multiplyScalar(drag);p.group.position.addScaledVector(p.velocity,dt);p.group.position.y=THREE.MathUtils.lerp(p.group.position.y,y-.055+Math.sin(worldTime*3+p.seed)*.035,1-Math.exp(-dt*5));p.spin.multiplyScalar(Math.exp(-dt*1.8));}
      p.group.rotation.x+=p.spin.x*dt;p.group.rotation.y+=p.spin.y*dt;p.group.rotation.z+=p.spin.z*dt;
      for(let j=0;j<p.parts.length;j++)p.parts[j].material.opacity=p.parts[j].opacity*fade;
    }
    const boardY=waterHeight(waterSample,flyingBoard.position.x,flyingBoard.position.z,worldTime);
    if(!boardHit){boardVelocity.y-=9.5*dt;flyingBoard.position.addScaledVector(boardVelocity,dt);if(flyingBoard.position.y<boardY+.04&&boardVelocity.y<0){boardHit=true;flyingBoard.position.y=boardY+.04;boardVelocity.y=Math.abs(boardVelocity.y)*.14;boardVelocity.x*=.55;boardVelocity.z*=.55;}}
    else{boardVelocity.multiplyScalar(Math.exp(-dt*2.6));flyingBoard.position.addScaledVector(boardVelocity,dt);flyingBoard.position.y=THREE.MathUtils.lerp(flyingBoard.position.y,boardY+.045,1-Math.exp(-dt*5));boardSpin.multiplyScalar(Math.exp(-dt*3));}
    flyingBoard.rotation.x+=boardSpin.x*dt;flyingBoard.rotation.y+=boardSpin.y*dt;flyingBoard.rotation.z+=boardSpin.z*dt;
    for(let i=0;i<boardMaterials.length;i++)boardMaterials[i].material.opacity=boardMaterials[i].opacity*fade;
    focusTarget.set(0,0,0);let mass=0;for(let i=0;i<pieces.length;i++)if(pieces[i].parts.length){const w=i===1?3:1;focusTarget.addScaledVector(pieces[i].group.position,w);mass+=w;}if(mass)focusTarget.multiplyScalar(1/mass);focus.lerp(focusTarget,1-Math.exp(-dt*5));
    updateParticles(blood,dt,fade,true);updateParticles(spray,dt,fade,false);
    for(let i=0;i<rings.length;i++){const r=rings[i],life=.72+i*.18;r.visible=age<life;if(r.visible){r.position.y=waterHeight(waterSample,r.position.x,r.position.z,worldTime)+.035+i*.012;r.scale.setScalar(.25+age*(3.1+i*.8));r.material.opacity=(1-age/life)*.65;}}
  }
  function clear(){active=false;age=DURATION;root.visible=false;hideParticles(blood);hideParticles(spray);}
  function inspect(){let drops=0,foam=0;for(let i=0;i<blood.count;i++)if(blood.life[i]>0)drops++;for(let i=0;i<spray.count;i++)if(spray.life[i]>0)foam++;return {active,age,duration:DURATION,crashes,fragments:pieces.filter(p=>p.parts.length).length,meshDraws:draws.length,additionalDraws:draws.length+boardDraws+4,boardDraws,board:true,center:{x:focus.x,y:focus.y,z:focus.z},origin:origin.toArray(),triangles:totalTriangles,bakedVertices,bloodDrops:drops,seaSpray:foam,waterImpacts,anatomicalMesh:true};}
  return {burst,update,clear,inspect,get active(){return active;},duration:DURATION};
}
