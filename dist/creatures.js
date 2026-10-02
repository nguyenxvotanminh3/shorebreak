import * as THREE from './vendor/three.module.js';

// Original lightweight, texture-free sea life. Units are metres; waterline is y=0.
// Every animated tube reuses its typed arrays. Materials are shared between instances.
const TAU = Math.PI * 2;
const palette = {
  shark: [0x435e68, 0xb3c6bc], kraken: [0x85465e, 0xe8a477],
  serpent: [0x2e756f, 0xaac99d], jelly: [0x95bddd, 0xe2bafa],
};
let cachedMaterials;
function materials() {
  if (!cachedMaterials) cachedMaterials = {
    skin: new THREE.MeshStandardMaterial({vertexColors:true, roughness:.49, metalness:.06}),
    eye: new THREE.MeshStandardMaterial({vertexColors:true, roughness:.18, metalness:.06}),
    bell: new THREE.MeshPhysicalMaterial({color:0x9bcbea, transparent:true, opacity:.57,
      roughness:.2, metalness:0, clearcoat:.8, side:THREE.DoubleSide, depthWrite:false}),
    glow: new THREE.MeshStandardMaterial({vertexColors:true, roughness:.4,
      emissive:0x2a1636, emissiveIntensity:.4}),
  };
  return cachedMaterials;
}
const color = hex => new THREE.Color(hex);
function reflectX(g, sign) {
  if (sign===1) return g;
  g.scale(-1,1,1);
  if(g.index){const a=g.index.array;for(let i=0;i<a.length;i+=3){const b=a[i+1];a[i+1]=a[i+2];a[i+2]=b;}}
  else for(const name of Object.keys(g.attributes)){
    const attr=g.attributes[name],a=attr.array,size=attr.itemSize;
    for(let i=0;i<attr.count;i+=3)for(let j=0;j<size;j++){const b=a[(i+1)*size+j];a[(i+1)*size+j]=a[(i+2)*size+j];a[(i+2)*size+j]=b;}
  }
  return g;
}
const mix = (a,b,t) => a + (b-a)*t;
const smooth = x => x*x*(3-2*x);
const cubic = (a,b,c,d,t) => .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
function tint(geometry, upper, lower=upper, yMin=-1, yMax=1) {
  const p=geometry.attributes.position, c=new Float32Array(p.count*3);
  const a=color(lower), b=color(upper);
  for(let i=0;i<p.count;i++) {
    const f=smooth(THREE.MathUtils.clamp((p.getY(i)-yMin)/(yMax-yMin),0,1));
    c[i*3]=mix(a.r,b.r,f); c[i*3+1]=mix(a.g,b.g,f); c[i*3+2]=mix(a.b,b.b,f);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(c,3)); return geometry;
}
function merge(parts) {
  const sizes=parts.map(g=>g.index?g.toNonIndexed():g);
  let count=0; sizes.forEach(g=>count+=g.attributes.position.count);
  const result=new THREE.BufferGeometry();
  for(const name of ['position','normal','color']) {
    const data=new Float32Array(count*3); let offset=0;
    for(const g of sizes) {data.set(g.attributes[name].array,offset); offset+=g.attributes[name].array.length;}
    result.setAttribute(name,new THREE.BufferAttribute(data,3));
  }
  result.computeBoundingSphere();
  sizes.forEach((g,i)=>{if(g!==parts[i])g.dispose(); parts[i].dispose();});
  return result;
}
function mesh(group, geometry, material=materials().skin) {
  const m=new THREE.Mesh(geometry,material); m.castShadow=false; m.receiveShadow=false;
  group.add(m); return m;
}
function ellipsoid(x,y,z,sx,sy,sz,hex,segments=14,rings=10) {
  const g=new THREE.SphereGeometry(1,segments,rings); g.scale(sx,sy,sz);g.translate(x,y,z);
  return tint(g,hex);
}
function pathTube(points,radius,hex,sides=7) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  return tint(new THREE.TubeGeometry(curve,Math.max(8,points.length*4),radius,sides,false),hex);
}
// A smooth fusiform loft along z, with independent width/height and a soft belly gradient.
function loft(rows, upper, lower, segments=32, sides=22) {
  const verts=[], idx=[];
  for(let j=0;j<=segments;j++) {
    const f=j/segments*(rows.length-1), k=Math.min(rows.length-2,Math.floor(f)), u=f-k;
    const a=rows[Math.max(0,k-1)],b=rows[k],c=rows[k+1],d=rows[Math.min(rows.length-1,k+2)];
    const z=cubic(a[0],b[0],c[0],d[0],u), cy=cubic(a[1],b[1],c[1],d[1],u),
      rx=Math.max(.005,cubic(a[2],b[2],c[2],d[2],u)),ry=Math.max(.005,cubic(a[3],b[3],c[3],d[3],u));
    for(let i=0;i<=sides;i++){const q=i/sides*TAU;verts.push(Math.cos(q)*rx,cy+Math.sin(q)*ry,z);}
  }
  for(let j=0;j<segments;j++)for(let i=0;i<sides;i++) {
    const a=j*(sides+1)+i,b=a+sides+1;idx.push(a,a+1,b,b,a+1,b+1);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();
  return tint(g,upper,lower,-.25,.75);
}
// Bevelled organic fins: curves on a 2D plane, mapped to one of the animal's planes.
function fin(commands,plane,hex,thickness=.05) {
  const shape=new THREE.Shape();
  for(const c of commands) shape[c[0]](...c.slice(1));
  const g=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSegments:2,
    steps:1,bevelSize:thickness*.55,bevelThickness:thickness*.55,curveSegments:7});
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++) {
    const u=p.getX(i),v=p.getY(i),w=p.getZ(i)-thickness*.5;
    if(plane==='zy')p.setXYZ(i,-w,v,u);
    else if(plane==='xz')p.setXYZ(i,u,-w,v);
    else p.setXYZ(i,u,v,w);
  }
  g.computeVertexNormals();return tint(g,hex);
}
function eyes(group, x,y,z,scale=.1, gold=0x101d22) {
  const parts=[];
  for(const side of [-1,1]) {
    parts.push(ellipsoid(side*x,y,z,scale*.5,scale,scale*.9,gold));
    parts.push(ellipsoid(side*(x+scale*.42),y+.02,z-.02,scale*.15,scale*.32,scale*.31,0xe4ffff,10));
  }
  mesh(group,merge(parts),materials().eye);
}
// Update a tapered tube from a centre-line without allocations or computeVertexNormals.
function dynamicTube(segments,sides,sample,radius,upper,lower=upper) {
  const centers=new Float32Array((segments+1)*3),rs=new Float32Array(segments+1);
  const p=new Float32Array((segments+1)*(sides+1)*3),n=new Float32Array(p.length),idx=[];
  const cos=new Float32Array(sides+1),sin=new Float32Array(sides+1);
  for(let k=0;k<=sides;k++){cos[k]=Math.cos(k/sides*TAU);sin[k]=Math.sin(k/sides*TAU);}
  for(let j=0;j<segments;j++)for(let k=0;k<sides;k++){
    const a=j*(sides+1)+k,b=a+sides+1;idx.push(a,a+1,b,b,a+1,b+1);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal',new THREE.BufferAttribute(n,3).setUsage(THREE.DynamicDrawUsage));g.setIndex(idx);
  function update(t) {
    for(let j=0;j<=segments;j++){sample(j/segments,t,centers,j*3);rs[j]=radius(j/segments);}
    let lastNx=0,lastNy=0,lastNz=0;
    for(let j=0;j<=segments;j++) {
      const prev=Math.max(0,j-1)*3,next=Math.min(segments,j+1)*3;
      let tx=centers[next]-centers[prev],ty=centers[next+1]-centers[prev+1],tz=centers[next+2]-centers[prev+2];
      let inv=1/(Math.hypot(tx,ty,tz)||1);tx*=inv;ty*=inv;tz*=inv;
      // Parallel transport removes sudden frame flips on the creature's curved neck/arms.
      let nx,ny,nz;
      if(j===0){nx=-tz;ny=0;nz=tx;if(Math.hypot(nx,nz)<.00001){nx=1;ny=0;nz=0;}}
      else {const dot=lastNx*tx+lastNy*ty+lastNz*tz;nx=lastNx-dot*tx;ny=lastNy-dot*ty;nz=lastNz-dot*tz;}
      inv=1/(Math.hypot(nx,ny,nz)||1);nx*=inv;ny*=inv;nz*=inv;
      lastNx=nx;lastNy=ny;lastNz=nz;
      const bx=ty*nz-tz*ny,by=tz*nx-tx*nz,bz=tx*ny-ty*nx;
      for(let k=0;k<=sides;k++) {
        const o=(j*(sides+1)+k)*3;
        const dx=nx*cos[k]+bx*sin[k],dy=ny*cos[k]+by*sin[k],dz=nz*cos[k]+bz*sin[k];
        p[o]=centers[j*3]+dx*rs[j];p[o+1]=centers[j*3+1]+dy*rs[j];p[o+2]=centers[j*3+2]+dz*rs[j];
        n[o]=dx;n[o+1]=dy;n[o+2]=dz;
      }
    }
    g.attributes.position.needsUpdate=true;g.attributes.normal.needsUpdate=true;
  }
  update(0);tint(g,upper,lower,-.5,1);g.computeBoundingSphere();
  // Radius covers the entire small animation envelope, keeping culling stable.
  g.boundingSphere.radius+=.8;
  return {geometry:g,update};
}

function shark() {
  const group=new THREE.Group(),[top,belly]=palette.shark,statics=[];
  statics.push(loft([[-3,.2,.02,.03],[-2.65,.26,.38,.23],[-2.1,.28,.66,.43],[-1.25,.31,.77,.58],[-.3,.28,.66,.57],[.8,.23,.4,.39],[1.65,.21,.18,.19],[2.13,.23,.12,.11]],top,belly));
  statics.push(fin([['moveTo',-.75,.72],['bezierCurveTo',-.6,1.1,-.36,1.65,-.08,1.88],['bezierCurveTo',.01,1.4,.21,1.01,.67,.7],['quadraticCurveTo',.14,.74,-.75,.72]],'zy',top,.085));
  statics.push(fin([['moveTo',.85,.5],['quadraticCurveTo',1.22,1.04,1.29,1.01],['quadraticCurveTo',1.35,.72,1.69,.44],['lineTo',.85,.5]],'zy',top,.04));
  for(const s of [-1,1]) {
    const f=fin([['moveTo',.49,-1.1],['bezierCurveTo',1.04,-.89,1.8,-.13,2.23,.91],['bezierCurveTo',1.69,.67,1.02,.27,.57,.3],['quadraticCurveTo',.59,-.45,.49,-1.1]],'xz',top,.075);
    reflectX(f,s);f.rotateZ(s*-.13);f.translate(0,.03,0);statics.push(f);
    const pelvic=fin([['moveTo',.3,.64],['quadraticCurveTo',.8,.99,.99,1.5],['quadraticCurveTo',.5,1.34,.18,1.22],['lineTo',.3,.64]],'xz',top,.035);
    reflectX(pelvic,s);pelvic.translate(0,.01,0);statics.push(pelvic);
    for(let k=0;k<5;k++) {
      const z=-1.48+k*.13,x=.70-k*.018;
      statics.push(pathTube([[s*x,.53,z],[s*(x+.055),.26,z+.025],[s*(x+.015),.02,z+.085]],.014,0x213943,5));
    }
  }
  mesh(group,merge(statics));
  eyes(group,.51,.38,-2.28,.105);
  mesh(group,pathTube([[-.36,.1,-2.63],[-.24,-.035,-2.58],[0,-.095,-2.57],[.24,-.035,-2.58],[.36,.1,-2.63]],.024,0x263333));
  const nostrils=[];for(const s of [-1,1])nostrils.push(ellipsoid(s*.25,.29,-2.815,.053,.026,.014,0x243237,10));mesh(group,merge(nostrils));
  const tail=new THREE.Group();tail.position.set(0,.23,2.0);group.add(tail);
  const tailParts=[loft([[0,0,.13,.12],[.35,0,.09,.11],[.7,.05,.025,.04]],top,belly,12,14),
    fin([['moveTo',.33,0],['bezierCurveTo',.5,.48,.75,1.01,1.32,1.56],['quadraticCurveTo',1.47,.9,1.04,.16],['quadraticCurveTo',.85,-.08,1.38,-1.04],['quadraticCurveTo',.82,-.9,.48,-.34],['quadraticCurveTo',.32,-.14,.33,0]],'zy',top,.065)];
  mesh(tail,merge(tailParts));
  return {group,radius:2.35,height:1.9,label:'CÁ MẬP',animate(t){tail.rotation.y=Math.sin(t*3.9)*.24;group.rotation.z=Math.sin(t*1.5)*.025;}};
}

function kraken() {
  const group=new THREE.Group(),top=palette.kraken[0],bottom=palette.kraken[1];
  // Rotated loft gives a continuous pear-shaped mantle instead of a stack of primitives.
  const mantle=loft([[-1.9,0,.012,.012],[-1.65,0,.5,.47],[-1.2,0,.86,.75],[-.65,0,.89,.71],[-.12,0,.58,.5],[.18,0,.46,.35]],top,bottom,25,24);
  mantle.rotateX(Math.PI/2);mantle.translate(0,.08,0);tint(mantle,top,0xbd6b76,-.1,1.9);mesh(group,mantle);
  const arms=[];
  for(let i=0;i<8;i++) {
    const a=i/8*TAU+.16,cs=Math.cos(a),sn=Math.sin(a),phase=i*1.67;
    const arm=dynamicTube(25,9,(u,t,out,o)=>{
      const reach=.48+u*3.05, curl=Math.pow(u,3)*.68;
      const wiggle=Math.sin(u*7.5-t*1.25+phase)*.15*u;
      out[o]=cs*reach-sn*(curl+wiggle);
      out[o+1]=-.03+Math.sin(u*Math.PI)*(.66+(i%3)*.14)-u*.45+Math.sin(t*1.1+phase+u*5)*.07*u;
      out[o+2]=sn*reach+cs*(curl+wiggle);
    },u=>.28*Math.pow(1-u,.8)+.016,top,bottom);
    const am=mesh(group,arm.geometry);arms.push(arm);
    // Suckers form a single merged mesh per arm; it follows the slow arm wave as a group.
    const suckers=[];
    for(let j=3;j<18;j+=2){const u=j/25,r=.48+u*3.05,curl=Math.pow(u,3)*.68;
      const y=-.03+Math.sin(u*Math.PI)*(.66+(i%3)*.14)-u*.45;
      suckers.push(ellipsoid(cs*r-sn*curl,y+.16*(1-u),sn*r+cs*curl,.075*(1-u)+.025,.037,.075*(1-u)+.025,0xde9e88,8,5));}
    const sm=mesh(group,merge(suckers));sm.userData.phase=phase;am.frustumCulled=true;
  }
  const pupils=[];for(const s of [-1,1]){
    pupils.push(ellipsoid(s*.32,.49,-.595,.135,.145,.075,0xf7bf63,12));
    pupils.push(ellipsoid(s*.32,.49,-.666,.031,.097,.019,0x21162b,10));
    pupils.push(ellipsoid(s*.293,.535,-.68,.019,.025,.01,0xffffff,8,6));
  }mesh(group,merge(pupils),materials().eye);
  return {group,radius:3.5,height:2,label:'KRAKEN',animate(t){for(const a of arms)a.update(t);group.rotation.y=Math.sin(t*.25)*.06;}};
}

function seaSerpent() {
  const group=new THREE.Group(),[top,belly]=palette.serpent;
  const body=dynamicTube(62,15,(u,t,out,o)=>{
    const lift=Math.pow(Math.max(0,(u-.64)/.36),1.55);
    out[o]=Math.sin(u*TAU)*1.5*(1-u*.55)+Math.sin(u*10-t*1.35)*.10*Math.sin(u*Math.PI);
    out[o+1]=-.22+Math.sin(u*Math.PI*4)*.4+lift*2.2;
    out[o+2]=3.5-u*5.5;
  },u=>(.035+Math.sin(Math.min(1,u*1.7)*Math.PI*.5)*.43)*(1-.18*u),top,belly);
  mesh(group,body.geometry);
  const head=new THREE.Group();head.position.set(0,1.98,-2);group.add(head);
  const headParts=[loft([[-1.35,-.03,.025,.02],[-1.15,.015,.35,.18],[-.72,.11,.48,.32],[-.2,.06,.39,.37],[.28,-.12,.26,.28]],top,belly,23,20)];
  for(const s of [-1,1]) {
    const f=fin([['moveTo',.18,-.27],['bezierCurveTo',.76,-.16,1.05,.25,.91,.72],['quadraticCurveTo',.62,.45,.23,.43],['lineTo',.18,-.27]],'xy',0x528e81,.04);
    reflectX(f,s);f.translate(0,.1,.17);headParts.push(f);
    headParts.push(pathTube([[s*.23,.29,.08],[s*.36,.6,.20],[s*.33,.88,.34]],.063,0xc0c697,7));
    headParts.push(pathTube([[s*.36,-.10,-.96],[s*.37,-.13,-.65],[s*.32,-.11,-.35]],.025,0x193e3c,6));
  }
  mesh(head,merge(headParts));eyes(head,.44,.22,-.55,.14,0xe0bf59);
  const features=[];for(const s of [-1,1]){
    features.push(ellipsoid(s*.506,.22,-.56,.014,.086,.038,0x142d2d,10));
    features.push(ellipsoid(s*.21,.16,-1.13,.045,.025,.022,0x234943,10));
  }mesh(head,merge(features),materials().eye);
  const crest=[];
  for(let i=2;i<12;i++){
    const u=i/14,x=Math.sin(u*TAU)*1.5*(1-u*.55),y=-.22+Math.sin(u*Math.PI*4)*.4+Math.pow(Math.max(0,(u-.64)/.36),1.55)*2.2,z=3.5-u*5.5;
    const g=fin([['moveTo',-.14,0],['quadraticCurveTo',-.09,.31,.08,.54],['quadraticCurveTo',.16,.2,.36,0],['lineTo',-.14,0]],'zy',0x86aaa0,.028);
    g.translate(x,y+.29,z);crest.push(g);
  }mesh(group,merge(crest));
  return {group,radius:3.15,height:3.1,label:'THỦY QUÁI',animate(t){body.update(t);head.rotation.z=Math.sin(t*1.1)*.035;head.rotation.y=Math.sin(t*.75)*.055;}};
}

function jellyfish() {
  const group=new THREE.Group(),bellGroup=new THREE.Group();group.add(bellGroup);
  const verts=[],idx=[],seg=40,rings=16;
  for(let j=0;j<=rings;j++) {
    const v=j/rings,theta=v*Math.PI*.51;
    for(let i=0;i<=seg;i++){
      const a=i/seg*TAU,r=Math.sin(theta)*1.18*(1+.027*Math.cos(a*12)*v*v);
      verts.push(Math.cos(a)*r,.45+Math.cos(theta)*1.32+.035*Math.sin(a*12)*v*v,Math.sin(a)*r);
    }
  }
  for(let j=0;j<rings;j++)for(let i=0;i<seg;i++){const a=j*(seg+1)+i,b=a+seg+1;idx.push(a,a+1,b,b,a+1,b+1);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(idx);geo.computeVertexNormals();mesh(bellGroup,geo,materials().bell);
  const ribs=[];
  for(let i=0;i<12;i++){
    const a=i/12*TAU,points=[];for(let k=0;k<8;k++){const th=k/7*Math.PI*.51,r=Math.sin(th)*1.19;points.push([Math.cos(a)*r,.45+Math.cos(th)*1.32,Math.sin(a)*r]);}
    ribs.push(pathTube(points,.012,0xc9bde8,5));
  }
  mesh(bellGroup,merge(ribs),materials().glow);
  mesh(bellGroup,tint(new THREE.TorusGeometry(1.165,.039,6,40).rotateX(Math.PI/2).translate(0,.415,0),0xb6a8da),materials().glow);
  // Four translucent oral lobes, silhouetted through the bell, and the hanging stinging fringe.
  const inners=[];
  for(let i=0;i<4;i++){const a=i*Math.PI*.5;inners.push(ellipsoid(Math.cos(a)*.29,.9,Math.sin(a)*.29,.23,.27,.20,0xe4b7e9));}
  mesh(bellGroup,merge(inners),materials().glow);
  const threads=[];
  for(let i=0;i<12;i++){
    const a=i/12*TAU,cs=Math.cos(a),sn=Math.sin(a),length=1.65+(i%3)*.24;
    const tube=dynamicTube(21,6,(u,t,out,o)=>{
      const sway=Math.sin(u*8-t*1.7+a)*.16*u;
      out[o]=cs*(1.0+u*.12)+sway;out[o+1]=.44-u*length;
      out[o+2]=sn*(1.0+u*.12)+Math.cos(u*7-t*1.3+a)*.13*u;
    },u=>.017+.015*(1-u),0xb6b8e9,0xe1bde5);
    mesh(group,tube.geometry,materials().glow);threads.push(tube);
  }
  return {group,radius:1.65,height:1.9,label:'SỨA ĐỘC',animate(t){for(const p of threads)p.update(t);const pulse=Math.sin(t*2);bellGroup.scale.set(1+pulse*.045,1-pulse*.035,1+pulse*.045);}};
}

/** type: 'shark' | 'kraken' | 'seaSerpent' (or 'serpent') | 'jellyfish'.
 * animate(t) uses absolute time in seconds. Set position/heading on a parent anchor;
 * the returned group uses small local rotations for swimming motions. Shared materials
 * must not be disposed per creature; geometries may be disposed when retiring a level.
 */
export function createSeaCreature(type) {
  switch(type){
    case 'shark':return shark();
    case 'kraken':return kraken();
    case 'seaSerpent':case 'serpent':return seaSerpent();
    case 'jellyfish':return jellyfish();
    default:throw new Error(`Unknown sea creature: ${type}`);
  }
}
