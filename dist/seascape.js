import * as THREE from './vendor/three.module.js';

// Decorative, procedural shipping lanes and tropical landmarks for an endless ocean.
// No collisions and no near-course objects. Rebased to view.z for endless/recentered worlds.
const TAU=Math.PI*2;
let MATERIALS;
function materials(){return MATERIALS??={
  paint:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:.22}),
  sail:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.77,side:THREE.DoubleSide}),
  foam:new THREE.MeshBasicMaterial({color:0xe1ffff,transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide}),
  beacon:new THREE.MeshBasicMaterial({color:0xffe3a1}),
};}
function colored(g,hex){const c=new THREE.Color(hex),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
function merge(list){const gs=list.map(g=>g.index?g.toNonIndexed():g);let total=0;for(const g of gs)total+=g.attributes.position.count;
  const out=new THREE.BufferGeometry();for(const name of ['position','normal','color']){const a=new Float32Array(total*3);let k=0;for(const g of gs){a.set(g.attributes[name].array,k);k+=g.attributes[name].array.length;}out.setAttribute(name,new THREE.BufferAttribute(a,3));}out.computeBoundingSphere();for(let i=0;i<gs.length;i++){if(gs[i]!==list[i])gs[i].dispose();list[i].dispose();}return out;}
function batch(group,key='paint'){const geos=[];return{add(g,hex){geos.push(colored(g,hex));},finish(){const m=new THREE.Mesh(merge(geos),materials()[key]);group.add(m);return m;}};}
function box(x,y,z,w,h,d,rx=0,ry=0,rz=0){const g=new THREE.BoxGeometry(w,h,d);g.rotateX(rx);g.rotateY(ry);g.rotateZ(rz);g.translate(x,y,z);return g;}
function cyl(x,y,z,r,h,rt=r,segments=12){const g=new THREE.CylinderGeometry(rt,r,h,segments);g.translate(x,y,z);return g;}
function sphere(x,y,z,rx,ry,rz){const g=new THREE.SphereGeometry(1,12,7);g.scale(rx,ry,rz);g.translate(x,y,z);return g;}
function beam(a,b,r=.035){const delta=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);const g=new THREE.CylinderGeometry(r,r,delta.length(),7);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);return g;}
function hull(length,width,height){
  const p=[],idx=[],colors=[],sections=28,sides=10,top=new THREE.Color(0xf5f4df),bottom=new THREE.Color(0x183c53);
  // The keel and rounded chine are a continuous mesh; the bow pinches to a true stem.
  for(let j=0;j<=sections;j++){const u=j/sections,z=(u-.5)*length,shape=Math.min(1,Math.pow(u*5,.7))*(1-.14*Math.pow(u,5));
    for(let k=0;k<=sides;k++){const a=k/sides*TAU,x=Math.sin(a)*width*.5*shape,y=Math.cos(a)*height*.5;
      p.push(x,y,z);const f=THREE.MathUtils.clamp((y/height+.12)*2.2,0,1);colors.push(THREE.MathUtils.lerp(bottom.r,top.r,f),THREE.MathUtils.lerp(bottom.g,top.g,f),THREE.MathUtils.lerp(bottom.b,top.b,f));}}
  for(let j=0;j<sections;j++)for(let k=0;k<sides;k++){const a=j*(sides+1)+k,b=a+sides+1;idx.push(a,b,a+1,b,b+1,a+1);}
  const cap=p.length/3;p.push(0,0,length*.5);colors.push(top.r,top.g,top.b);for(let k=0;k<sides;k++)idx.push(cap,sections*(sides+1)+k+1,sections*(sides+1)+k);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
function addHull(group,l,w,h){const mesh=new THREE.Mesh(hull(l,w,h),materials().paint);group.add(mesh);}
function wake(length,width){
  const g=new THREE.BufferGeometry(),p=[],idx=[];for(const side of [-1,1])for(let strip=0;strip<3;strip++){
    const start=p.length/3;for(let i=0;i<=14;i++){const u=i/14,z=length*.45+u*length*1.5,x=side*(width*.35+u*length*.24+strip*.5),w=.12+u*.55;
      p.push(x-w,.04,z,x+w,.04,z);}for(let i=0;i<14;i++){const a=start+i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();return new THREE.Mesh(g,materials().foam);
}
function yacht(){const group=new THREE.Group();addHull(group,15,4.5,1.9);const b=batch(group);
  b.add(box(0,.88,.2,3.55,.12,11.8),0xbc9260);b.add(box(0,1.25,1.4,3.6,.70,5.4),0xeaf4ed);
  b.add(box(0,1.96,.7,2.95,.72,3.95),0x123b51);b.add(box(0,2.39,.85,3.45,.16,4.9),0xf6fbef);b.add(box(0,1.88,-1.39,3.0,.78,.11,-.32),0x365d6a);
  b.add(box(0,1.37,4.78,2.9,.6,.65),0xdedccb);b.add(box(0,1.65,2.4,2.45,.25,1),0xf0e9d6);
  b.add(cyl(0,3.04,1.9,.065,1.3),0xdceeea);b.add(box(0,3.52,1.9,1.75,.13,.22),0x1b3946);
  for(const s of [-1,1]){for(let i=0;i<7;i++){const z=-4.9+i*1.55,x=s*(z< -3?1.45:1.88);b.add(beam([x,.92,z],[x,1.30,z],.025),0xdbe9df);}b.add(beam([s*1.45,1.30,-4.9],[s*1.88,1.30,4.5],.026),0xdbe9df);for(let i=0;i<4;i++)b.add(sphere(s*2.03,.3,-1+i*1.2,.035,.13,.29),0x103b50);}
  b.add(box(0,1.02,-3.6,1.23,.06,1.35),0x22566b);b.add(sphere(0,2.68,1.5,.31,.28,.31),0xf6fbef);b.finish();group.add(wake(15,4.5));return{group,kind:'yacht',length:15};}
function sailSurface(height,length,sign,hex){const p=[],idx=[],n=16;for(let j=0;j<=n;j++){const v=j/n;for(let k=0;k<=n;k++){const u=k/n;p.push(.55*Math.sin(u*Math.PI)*Math.sin(v*Math.PI),1.28+v*height,sign*u*(1-v)*length);}}
  for(let j=0;j<n;j++)for(let k=0;k<n;k++){const a=j*(n+1)+k,b=a+n+1;idx.push(a,a+1,b,b,a+1,b+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();return colored(g,hex);}
function sailboat(){const group=new THREE.Group();addHull(group,12.8,3.4,1.5);const b=batch(group);
  b.add(box(0,.66,.1,2.6,.09,9.4),0xd9b88c);b.add(box(0,.95,2,2.1,.46,3.3),0xf4f2db);b.add(box(0,1.2,1.9,1.9,.12,3.0),0x234d60);
  b.add(cyl(0,7.18,0,.055,13.7),0xe4e8d7);b.add(beam([0,1.30,0],[0,1.30,5.7],.055),0xf1e8ca);b.add(beam([0,13.95,0],[0,.78,-5.8],.014),0xc9dbd8);b.add(beam([0,13.95,0],[0,.78,5.8],.014),0xc9dbd8);
  for(const sign of [-1,1]){b.add(beam([0,13.0,0],[sign*1.3,.85,1.5],.013),0xc9dbd8);b.add(beam([sign*1.15,1.05,-4.5],[sign*1.35,1.05,4.8],.023),0xf4f0dd);}b.finish();
  const sails=new THREE.Group();group.add(sails);const sailGeo=merge([sailSurface(12.2,5.65,1,0xfff0cc),sailSurface(10.8,5.4,-1,0xf1d778)]);sails.add(new THREE.Mesh(sailGeo,materials().sail));
  const accent=batch(sails,'sail');accent.add(beam([.08,4.6,0],[.08,4.6,3.55],.033),0xc77736);accent.add(beam([.08,7.9,0],[.08,7.9,2.15],.027),0xc77736);accent.finish();group.add(wake(12.8,3.4));return{group,sails,kind:'sailboat',length:12.8};}
function cargo(){const group=new THREE.Group();addHull(group,42,8.4,3.8);const b=batch(group);
  b.add(box(0,1.69,0,7.15,.14,35),0x605d50);const colors=[0xc86b3b,0x408989,0xbeb653,0x9d4439,0x335575,0xd5c6a0];
  for(let row=0;row<4;row++)for(let col=0;col<3;col++)for(let level=0;level<(row===3?1:2);level++){
    const x=(col-1)*2.25,z=-12+row*6.5,y=2.65+level*1.83,c=colors[(row*3+col+level)%colors.length];b.add(box(x,y,z,2.10,1.73,5.95),c);
    for(let rib=0;rib<6;rib++)for(const side of [-1,1])b.add(box(x+side*1.07,y,z-2.4+rib*.95,.035,1.58,.065),0x526369);
  }
  b.add(box(0,4.15,13.5,6.5,4.9,5.0),0xe2e8d7);b.add(box(0,6.86,12.8,7.3,.63,4.3),0xeaf2de);b.add(box(0,6.91,10.60,6.9,.31,.06),0x12374a);
  for(const side of [-1,1])b.add(box(side*3.68,6.91,12.8,.06,.31,3.6),0x12374a);
  b.add(box(.8,8.12,14.5,1.8,2.2,1.55),0xc56b39);b.add(box(.8,9.23,14.5,1.92,.25,1.65),0x23383f);b.add(cyl(-2,8.13,12,.055,2.6),0xe3e8d9);b.add(beam([-3,9.05,12],[-1,9.05,12],.045),0xe3e8d9);
  for(const side of [-1,1])b.add(sphere(side*3.55,3.2,12,.6,.47,1.8),0xe09031);
  b.finish();group.add(wake(42,8.4));return{group,kind:'cargo',length:42};}
function islandMesh(rx,rz,height,seed){const vertices=[],idx=[],rings=9,segments=48;for(let j=0;j<=rings;j++){const u=j/rings;for(let k=0;k<=segments;k++){const a=k/segments*TAU,edge=1+.10*Math.sin(a*5+seed)+.045*Math.sin(a*11-seed),r=u*edge;const y=-.18+height*Math.pow(Math.max(0,1-u*u),1.7)*(1+.18*Math.sin(a*3+seed)*u)+.18*Math.sin(a*9)*u;vertices.push(Math.cos(a)*r*rx,y,Math.sin(a)*r*rz);}}
  for(let j=0;j<rings;j++)for(let k=0;k<segments;k++){const a=j*(segments+1)+k,b=a+segments+1;idx.push(a,a+1,b,b,a+1,b+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(idx);g.computeVertexNormals();return g;}
function palm(b,x,y,z,height,phase){const lean=.7*Math.sin(phase);b.add(beam([x,y,z],[x+lean,y+height,z+.25],.16),0x89785a);const top=[x+lean,y+height,z+.25];
  for(let leaf=0;leaf<7;leaf++){const a=leaf/7*TAU+phase,verts=[],idx=[];for(let j=0;j<=8;j++){const u=j/8,r=u*3.8,cy=top[1]+Math.sin(u*Math.PI)*.55-u*u*1.45,cx=top[0]+Math.cos(a)*r,cz=top[2]+Math.sin(a)*r,w=.49*Math.sin(u*Math.PI);verts.push(cx-Math.sin(a)*w,cy,cz+Math.cos(a)*w,cx+Math.sin(a)*w,cy,cz-Math.cos(a)*w);}for(let j=0;j<8;j++){const k=j*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();b.add(g,leaf%2?0x4e7450:0x709357);}
}
function island(kind,seed){const group=new THREE.Group(),b=batch(group,'sail');b.add(islandMesh(21,15,3.6,seed),0xb2ac8e);b.add(islandMesh(16,11,4.1,seed),0x798c70);
  for(let i=0;i<6;i++){const a=i/6*TAU+seed;const g=new THREE.IcosahedronGeometry(1,1);g.scale(3.0+i%2,3.4+(i%3),3.2);g.rotateY(i);g.translate(Math.cos(a)*14,1.3,Math.sin(a)*9);b.add(g,0x718886);}
  let beacon=null;if(kind==='lighthouse'){
    b.add(cyl(0,10.7,0,2.05,15,1.18,20),0xf1eee0);for(let j=0;j<3;j++)b.add(cyl(0,6.8+j*4.1,0,1.78-j*.23,1.15,1.70-j*.23,20),0xb45139);
    b.add(cyl(0,18.38,0,1.62,.23,1.62,20),0x243d44);b.add(cyl(0,19.20,0,1.13,1.55,1.13,12),0x708f91);b.add(cyl(0,20.20,0,1.55,.65,0,20),0x984c3c);
    for(let i=0;i<8;i++){const a=i/8*TAU;b.add(cyl(Math.cos(a)*1.4,18.94,Math.sin(a)*1.4,.036,1.1),0x263e45);}
    b.add(box(0,4.82,1.8,.84,1.65,.05),0x263e45);beacon=new THREE.Mesh(new THREE.SphereGeometry(.58,10,7),materials().beacon);beacon.position.y=19.25;group.add(beacon);
  }else for(let i=0;i<5;i++)palm(b,-7+i*3.0,3.3,-2+(i%2)*4.0,5.2+(i%3),i*.9+seed);
  b.finish();return{group,beacon,kind};}

/**
 * view={x,z,time?,seaLevel?,sampleWater?}; x/z are the surfer/world origin.
 * Optional callback sampleWater(x,z,time) may return a number or {height|y}.
 * Far ships are horizon-relative, so an endless course never outruns the scenery.
 * Ship lanes stay >=98m ahead; landmark centres stay >=105m sideways.
 * update allocates no geometry, matrices, vectors or per-frame arrays.
 */
export function createSeascape(scene,options={}){
  const group=new THREE.Group();group.name='endless-seascape';scene.add(group);
  const boats=[yacht(),sailboat(),cargo()],islands=[island('palms',.6),island('lighthouse',1.4),island('palms',2.6)];
  for(const b of boats)group.add(b.group);for(const i of islands)group.add(i.group);
  const inspect={time:0,drawCalls:0,boats:boats.map(b=>({kind:b.kind,x:0,y:0,z:0,speed:0})),landmarks:3,minShipAhead:98,nearCourseObjects:0};
  group.traverse(o=>{if(o.isMesh)inspect.drawCalls++;});let elapsed=0;const depths=[105,160,240],spans=[460,620,880],speeds=[3.6,-2.7,2.2],starts=[160,380,290];
  function update(view={},dt=1/60){elapsed=Number.isFinite(view.time)?view.time:elapsed+Math.max(0,Math.min(.1,dt));const t=elapsed,x=view.x??view.position?.x??0,z=view.z??view.position?.z??0,sea=view.seaLevel??0,sample=view.sampleWater??options.sampleWater;
    for(let i=0;i<3;i++){const boat=boats[i],phase=t*.014+i*2.1,span=spans[i],sx=x+(((starts[i]+t*speeds[i])%span)+span)%span-span/2,sz=z-depths[i]+Math.cos(phase)*7,dx=speeds[i];
      let sy=sea+.16*Math.sin(t*.75+i*2);if(sample){const water=sample(sx,sz,t);sy=typeof water==='number'?water:(water?.height??water?.h??water?.y??sy);}
      boat.group.position.set(sx,sy,sz);boat.group.rotation.y=dx>=0?-Math.PI/2:Math.PI/2;boat.group.rotation.z=Math.sin(t*.72+i*2)*.018;boat.group.rotation.x=Math.sin(t*.51+i)*.012;
      if(boat.sails)boat.sails.rotation.y=Math.sin(t*.85)*.055;
      const record=inspect.boats[i];record.x=sx;record.y=sy;record.z=sz;record.speed=dx;
    }
    islands[0].group.position.set(x-132,sea,z-192);islands[1].group.position.set(x+168,sea,z-268);islands[2].group.position.set(x-265,sea,z-415);
    if(islands[1].beacon)islands[1].beacon.scale.setScalar(.88+.25*Math.pow(Math.max(0,Math.sin(t*.9)),8));inspect.time=t;
  }
  function dispose(){scene.remove(group);group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});}
  update({x:0,z:0,time:0});return{group,update,inspect,dispose};
}
