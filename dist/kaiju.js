import * as THREE from './vendor/three.module.js';
import {organicMaterial,organicTint,sculptSurface,smoothRingSeam} from './creature-surface.js';

// Original tide-reptile; no external textures/assets. Forward -Z, metres, water y=0.
// Gameplay owns the root. Animation changes child transforms and pooled vertices only.
const TAU=Math.PI*2,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
let skinMaterial,eyeMaterial;
function materials(){
 skinMaterial??=organicMaterial('reptile');
 eyeMaterial??=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.3,metalness:0,emissive:0x8e5a21,emissiveIntensity:.17});
}
function tint(g,hex,lower=hex,min=-1,max=6){return organicTint(g,hex,lower,min,max,.23);}
function combine(parts){
 const list=parts.map(g=>g.index?g.toNonIndexed():g),g=new THREE.BufferGeometry();
 for(const key of ['position','normal','color','uv']){let n=0;for(const p of list)n+=p.attributes[key].array.length;const a=new Float32Array(n);let k=0;for(const p of list){a.set(p.attributes[key].array,k);k+=p.attributes[key].array.length;}g.setAttribute(key,new THREE.BufferAttribute(a,key==='uv'?2:3));}
 for(let i=0;i<list.length;i++){if(list[i]!==parts[i])list[i].dispose();parts[i].dispose();}g.computeBoundingSphere();return g;
}
function add(parent,g,material=skinMaterial){const m=new THREE.Mesh(g,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function ellipsoid(x,y,z,rx,ry,rz,hex,segments=14,rings=9){const g=new THREE.SphereGeometry(1,segments,rings);g.scale(rx,ry,rz);g.translate(x,y,z);return tint(g,hex);}
function horn(a,b,r,hex){const g=new THREE.ConeGeometry(r,new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)),7);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize()));g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);return tint(g,hex);}
function tube(points,radius,hex,segments=18,sides=10,radii=null){
 const c=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),g=new THREE.TubeGeometry(c,segments,radius,sides,false);
 if(radii){const p=g.attributes.position;for(let j=0;j<=segments;j++){const u=j/segments*(radii.length-1),k=Math.min(radii.length-2,Math.floor(u)),f=ease(u-k),r=(radii[k]*(1-f)+radii[k+1]*f)/radius,center=c.getPointAt(j/segments);for(let n=0;n<=sides;n++){const i=j*(sides+1)+n;p.setXYZ(i,center.x+(p.getX(i)-center.x)*r,center.y+(p.getY(i)-center.y)*r,center.z+(p.getZ(i)-center.z)*r);}}g.computeVertexNormals();}
 return tint(g,hex);
}
// Anatomical cross-section loft. Rounded variable section, rather than visible primitives.
function loft(rows,axis='y',sides=20){
 const p=[],uv=[],indices=[],segments=(rows.length-1)*3;
 const cubic=(a,b,c,d,t)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
 for(let j=0;j<=segments;j++){
  const f=j/segments*(rows.length-1),k=Math.min(rows.length-2,Math.floor(f)),t=f-k,a=rows[Math.max(0,k-1)],b=rows[k],c=rows[k+1],d=rows[Math.min(rows.length-1,k+2)];
  const u=cubic(a[0],b[0],c[0],d[0],t),center=cubic(a[1],b[1],c[1],d[1],t),ra=Math.max(.008,cubic(a[2],b[2],c[2],d[2],t)),rb=Math.max(.008,cubic(a[3],b[3],c[3],d[3],t));
  for(let n=0;n<=sides;n++){
   const angle=n/sides*TAU,cs=Math.cos(angle),sn=Math.sin(angle);
   // A flattened crocodilian muzzle and a weighted, muscular torso cross-section.
   const sx=axis==='z'?Math.sign(cs)*Math.pow(Math.abs(cs),.8):cs,sy=axis==='z'?Math.sign(sn)*Math.pow(Math.abs(sn),.86):sn;
   if(axis==='y')p.push(sx*ra,u,center+sy*rb);else p.push(sx*ra,center+sy*rb,u);
   uv.push(n/sides*3,u*.85);
  }
 }
 for(let j=0;j<segments;j++)for(let k=0;k<sides;k++){const a=j*(sides+1)+k,b=a+sides+1;if(axis==='y')indices.push(a,b,a+1,b,b+1,a+1);else indices.push(a,a+1,b,b,a+1,b+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
 smoothRingSeam(g,sides);sculptSurface(g,.011);smoothRingSeam(g,sides);return tint(g,0x315851,0x77866b,-.8,6.1);
}
function plate(y,z,size,hex=0xae9970){
 const s=new THREE.Shape();s.moveTo(-.13*size,0);s.bezierCurveTo(-.1*size,.5*size,-.55*size,.9*size,-.11*size,1.32*size);s.bezierCurveTo(.05*size,.98*size,.38*size,.43*size,.22*size,0);s.closePath();
 const g=new THREE.ExtrudeGeometry(s,{depth:.13*size,bevelEnabled:true,bevelSegments:1,bevelSize:.045*size,bevelThickness:.025*size,steps:1,curveSegments:4});
 // Shape horizontal coordinate follows the spine (-Z), thin in X.
 const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),q=p.getY(i),v=p.getZ(i);p.setXYZ(i,v-.065*size,y+q,z+x);}g.computeVertexNormals();return tint(g,hex,0x526e58,y,y+size*1.3);
}
const proxy=(x,y,z,rx,ry,rz,part)=>({x,y,z,rx,ry,rz,part});

export function createKaiju(){
 materials();const group=new THREE.Group();group.name='Original Tide Reptile';
 const chest=new THREE.Group();group.add(chest);const fixed=[];
 fixed.push(loft([[-1,0,.05,.05],[-.6,.2,.72,.6],[0,.25,1.13,.86],[.65,.23,1.26,.95],[1.4,.16,1.1,.86],[2.2,.08,.94,.74],[3.0,.04,1.07,.82],[3.8,0,1.28,.85],[4.25,-.08,1.15,.75],[4.7,-.14,.76,.57],[5.2,-.25,.57,.5],[5.52,-.37,.35,.32]]));
 // Continuous pale ventral shield, subtly ridged from neck down to belly.
 fixed.push(loft([[.15,-.64,.50,.07],[.6,-.74,.73,.11],[1.25,-.70,.71,.10],[2,-.60,.62,.09],[2.8,-.69,.69,.09],[3.5,-.77,.77,.1],[4.0,-.72,.69,.08],[4.5,-.61,.46,.07],[4.85,-.58,.28,.04]],'y',16));
 const last=fixed[fixed.length-1];tint(last,0xb4b494,0x6c8063,0,5);
 // Low, overlapping flank scutes sit within the body silhouette and share its draw.
 for(const sign of [-1,1])for(let row=0;row<8;row++){
  const y=.65+row*.46,width=.97+Math.cos((y-.55)*1.7)*.13;
  for(let band=0;band<2;band++){
   const scute=new THREE.OctahedronGeometry(1,0);scute.scale(.12,.27,.22);scute.rotateZ(sign*-.12);scute.translate(sign*(width-band*.13),y+band*.13,-.25+band*.40);
   fixed.push(tint(scute,0x4e6e59,0x344f46,y-.27,y+.27));
  }
 }
 // Shallow transverse ventral folds turn broad highlights into a leathery chest.
 for(let row=0;row<9;row++){
  const y=.48+row*.44,w=.44+Math.sin(row/8*Math.PI)*.20,z=-.73-(row>5?.02:0);
  fixed.push(tube([[-w,y,z+.065],[0,y-.032,z-.012],[w,y,z+.065]],.019,0x63785a,8,5));
 }
 for(const sign of [-1,1]){
  // Heavy integrated thighs emerging below the waterline, flattened webbed feet.
  fixed.push(tube([[sign*.63,1.28,.2],[sign*1.08,.76,.05],[sign*1.15,-.18,-.38]],.46,0x59796d,14,12,[.53,.5,.32]));
  fixed.push(ellipsoid(sign*1.12,-.32,-.62,.55,.23,.88,0x4d6d65));
  for(let toe=0;toe<3;toe++)fixed.push(horn([sign*(.85+toe*.24),-.24,-1.18],[sign*(.85+toe*.24),-.23,-1.66],.11,0xc8bc8f));
 }
 // Head has a broad brow and a long crocodilian snout with deliberately non-IP silhouette.
 fixed.push(loft([[-2.45,5.44,.07,.035],[-2.38,5.45,.35,.16],[-2.13,5.50,.51,.22],[-1.85,5.58,.62,.31],[-1.35,5.77,.78,.48],[-.80,5.83,.83,.59],[-.30,5.67,.68,.59],[.05,5.42,.39,.36]],'z',22));
 for(const sign of [-1,1]){
  fixed.push(tube([[sign*.45,6.08,-1.5],[sign*.75,6.22,-1.03],[sign*.83,6.19,-.60]],.12,0x476b61,12,8));
  fixed.push(horn([sign*.52,6.10,-.35],[sign*.84,6.91,.04],.18,0xb6ad80));
  fixed.push(ellipsoid(sign*.40,5.66,-2.22,.095,.035,.052,0x132f31,10,6));
  // Teeth are merged into their owning skin surfaces: no tooth draw calls.
  for(let i=0;i<7;i++){const z=-2.12+i*.21,x=sign*(.45+i*.032);fixed.push(horn([x,5.32,z],[x*.98,5.02-(i%2)*.07,z-.035],.075,0xe8ddba));}
 }
 for(let i=0;i<7;i++)fixed.push(plate(4.85-i*.57,.20+i*.13,.66+Math.sin(i/6*Math.PI)*.35));
 add(chest,combine(fixed));
 const eyeParts=[];for(const sign of [-1,1]){eyeParts.push(ellipsoid(sign*.728,5.96,-1.17,.075,.125,.15,0xeec16c,12,8));eyeParts.push(ellipsoid(sign*.778,5.967,-1.19,.03,.074,.047,0x173a32,10,6));}
 add(chest,combine(eyeParts),eyeMaterial);
 // Hinged jaw, dark mouth lining and teeth all one draw call.
 const jaw=new THREE.Group();jaw.position.set(0,5.25,-.68);chest.add(jaw);
 const jawParts=[loft([[-1.68,-.11,.025,.03],[-1.49,-.1,.44,.13],[-1.0,-.12,.55,.17],[-.45,-.11,.65,.19],[.22,-.07,.53,.23]],'z',18)];
 tint(jawParts[0],0x708875);jawParts.push(ellipsoid(0,.032,-.63,.56,.042,.73,0x442f3b));
 for(const sign of [-1,1])for(let i=0;i<7;i++){const z=-1.42+i*.20,x=sign*(.39+i*.032);jawParts.push(horn([x,.01,z],[x*.98,.24+(i%2)*.07,z-.03],.069,0xe8ddba));}
 add(jaw,combine(jawParts));
 // Arms share geometry construction; their natural curved muscles stay coherent.
 const arms=[];
 for(const sign of [-1,1]){
  const arm=new THREE.Group();arm.position.set(sign*1.05,3.84,-.06);chest.add(arm);
  const parts=[tube([[0,0,0],[sign*.43,-.38,-.16],[sign*.76,-1.0,-.48],[sign*1.02,-1.54,-.83],[sign*1.19,-1.94,-1.09]],.34,0x466b5c,26,14,[.47,.43,.25,.34,.27]),ellipsoid(sign*1.19,-1.99,-1.14,.36,.34,.37,0x526f5a)];
  for(let k=0;k<3;k++){const x=sign*(.93+k*.24);parts.push(tube([[x,-2.03,-1.10],[x+sign*.05,-2.22,-1.40],[x+sign*.04,-2.24,-1.58]],.095,0x527569,9,7));parts.push(horn([x+sign*.04,-2.24,-1.54],[x+sign*.02,-2.37,-1.87],.1,0xe0ce9c));}
  add(arm,combine(parts));arms.push(arm);
 }
 // Tail is a single tapered moving surface, not a chain of visible capsules.
 const segments=42,sides=12,positions=new Float32Array((segments+1)*(sides+1)*3),normals=new Float32Array(positions.length),uvs=new Float32Array((segments+1)*(sides+1)*2),indices=[];
 for(let j=0;j<=segments;j++)for(let k=0;k<=sides;k++){const i=(j*(sides+1)+k)*2;uvs[i]=k/sides*3;uvs[i+1]=j/segments*5.2;}
 for(let j=0;j<segments;j++)for(let k=0;k<sides;k++){const a=j*(sides+1)+k,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1);}
 const tailGeometry=new THREE.BufferGeometry();tailGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));tailGeometry.setAttribute('normal',new THREE.BufferAttribute(normals,3).setUsage(THREE.DynamicDrawUsage));tailGeometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));tailGeometry.setIndex(indices);
 const tailPlates=new THREE.Group();group.add(tailPlates);const plates=[];for(let i=0;i<5;i++){const p=add(tailPlates,plate(0,0,.43-i*.054,0x9a906b));plates.push(p);}
 const colliders=[proxy(0,.55,.12,1.1,1.1,.80,'body'),proxy(0,2.02,0,.91,1.03,.69,'body'),proxy(0,3.69,0,1.12,.95,.72,'body'),proxy(0,5.58,-1.19,.75,.65,1.08,'head')];
 for(let arm=0;arm<2;arm++)for(let j=0;j<4;j++)colliders.push(proxy(0,0,0,.39,.4,.42,'arm'));
 for(let i=0;i<9;i++)colliders.push(proxy(0,0,0,.3,.3,.35,'tail'));
 const inspect={phase:'idle',phaseTime:0,danger:false,telegraph:0,attackCycle:0,tailTipX:0,armHeight:0,triangles:0,drawCalls:0};
 function tailPoint(u,t,sweep,out){const z=.70+u*6.5,amplitude=.30+u*u*2.3;out.x=Math.sin(t*1.3-u*3.2)*amplitude+sweep*Math.sin(u*Math.PI*.68)*2.6;out.y=.22+Math.sin(u*Math.PI)*.15+Math.sin(t*1.1-u*5)*u*.10;out.z=z;return out;}
 const point={x:0,y:0,z:0},near={x:0,y:0,z:0},far={x:0,y:0,z:0};
 function animate(t){
  const cycle=((t%8)+8)%8;let armAngle,warning=0,sweep=0;
  if(cycle<3.2){inspect.phase='idle';armAngle=.10*Math.sin(t*.85);}
  else if(cycle<4.8){inspect.phase='windup';warning=ease((cycle-3.2)/1.6);armAngle=warning*1.48;}
  else if(cycle<5.2){inspect.phase='slam';const f=ease((cycle-4.8)/.4);armAngle=1.48-f*2.22;sweep=-f;warning=1;}
  else if(cycle<6.25){inspect.phase='sweep';const f=ease((cycle-5.2)/1.05);armAngle=-.74+f*.18;sweep=-1+f*2;}
  else{inspect.phase='recover';const f=ease((cycle-6.25)/1.75);armAngle=-.56*(1-f);sweep=1-f;}
  inspect.phaseTime=cycle;inspect.attackCycle=Math.floor(t/8);inspect.danger=cycle>=4.8&&cycle<6.25;inspect.telegraph=warning;
  // Head breathing and jaw opening make the windup readable from surf-camera scale.
  jaw.rotation.x=.10+Math.sin(t*.7)*.025+warning*.34;
  arms[0].rotation.z=.12*Math.sin(t*.75+.8);arms[1].rotation.z=armAngle;
  for(let arm=0;arm<2;arm++){const sign=arm===0?-1:1,angle=arms[arm].rotation.z,c=Math.cos(angle),s=Math.sin(angle);for(let j=0;j<4;j++){const u=(j+1)/4,x=sign*1.19*u,y=-1.95*u,z=-1.10*u;const p=colliders[4+arm*4+j];p.x=sign*1.05+c*x-s*y;p.y=3.84+s*x+c*y;p.z=-.06+z;}}
  inspect.armHeight=colliders[11].y;
  for(let j=0;j<=segments;j++){const u=j/segments;tailPoint(u,t,sweep,point);tailPoint(Math.max(0,u-.002),t,sweep,near);tailPoint(Math.min(1,u+.002),t,sweep,far);const dx=far.x-near.x,dz=far.z-near.z,inv=1/(Math.hypot(dx,dz)||1),nx=dz*inv,nz=-dx*inv,r=.76*Math.pow(1-u,1.3)+.018;for(let k=0;k<=sides;k++){const a=k/sides*TAU,cs=Math.cos(a),sn=Math.sin(a),i=(j*(sides+1)+k)*3;positions[i]=point.x+nx*cs*r;positions[i+1]=point.y+sn*r*.72;positions[i+2]=point.z+nz*cs*r;const taper=.152*Math.pow(1-u,.3),normalX=nx*cs+dx*inv*taper,normalY=sn/.72,normalZ=nz*cs+dz*inv*taper,nl=1/Math.hypot(normalX,normalY,normalZ);normals[i]=normalX*nl;normals[i+1]=normalY*nl;normals[i+2]=normalZ*nl;}}
  tailGeometry.attributes.position.needsUpdate=true;tailGeometry.attributes.normal.needsUpdate=true;
  for(let i=0;i<5;i++){const u=.10+i*.145;tailPoint(u,t,sweep,point);plates[i].position.set(point.x,point.y+(.76*Math.pow(1-u,1.3)+.018)*.72-.08,point.z);}
  for(let i=0;i<9;i++){const u=.06+i*.108;tailPoint(u,t,sweep,point);const c=colliders[12+i],r=.76*Math.pow(1-u,1.3)+.04;c.x=point.x;c.y=point.y;c.z=point.z;c.rx=r;c.ry=r*.72;c.rz=.43;}
  tailPoint(1,t,sweep,point);inspect.tailTipX=point.x;
 }
 animate(0);tint(tailGeometry,0x446b64,0x8fa38a,-.4,.7);tailGeometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.3,3.5),6.5);add(group,tailGeometry);
 group.traverse(o=>{if(o.isMesh){inspect.drawCalls++;inspect.triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;}});
 return {group,animate,getColliders:()=>colliders,label:'THỦY QUÁI KHỔNG LỒ',radius:7.3,height:7.1,inspect,forwardAxis:'-Z'};
}
