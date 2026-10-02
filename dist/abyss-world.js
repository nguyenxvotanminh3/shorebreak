import * as THREE from './vendor/three.module.js';

// Original geometry and shaders. No downloaded textures or runtime network requests.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const TAU=Math.PI*2;
const BOUNDS=Object.freeze({minX:-220,maxX:220,minZ:-230,maxZ:90});

/** Deterministic continuous seafloor; the player's physics uses this same function. */
export function terrainHeight(x,z){
  const descent=smooth(16,216,-z);
  const rolling=Math.sin(x*.036+z*.017)*2.7+Math.sin(z*.066-x*.024)*1.55+Math.cos(x*.082+z*.038)*.65;
  const channel=-4.2*Math.exp(-Math.pow((x+10+Math.sin(z*.024)*22)/36,2))*smooth(52,145,-z);
  const shoulders=smooth(102,206,Math.abs(x))*10;
  return -23-49*descent+rolling+channel+shoulders;
}

function random(seed=17281){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
function mergeGeometries(parts){
  const positions=[],normals=[],uvs=[];
  for(const input of parts){
    const g=input.index?input.toNonIndexed():input;
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n?.getX(i)??0,n?.getY(i)??1,n?.getZ(i)??0);uvs.push(uv?.getX(i)||0,uv?.getY(i)||0);}
    if(g!==input)g.dispose();input.dispose();
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));return g;
}
function branch(a,b,r0,r1,sides=6){
  const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),d=q.clone().sub(p);
  const g=new THREE.CylinderGeometry(r1,r0,d.length(),sides,1);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate((p.x+q.x)/2,(p.y+q.y)/2,(p.z+q.z)/2);return g;
}
function coralGeometry(){
  const parts=[branch([0,0,0],[0,1.5,0],.17,.11)];
  for(let i=0;i<5;i++){
    const a=i*2.3999,side=i%2?1:-1,h=.45+i*.18,x=Math.cos(a)*(.68+i*.06),z=Math.sin(a)*(.68+i*.06);
    parts.push(branch([0,h,0],[x,h+.58,z],.105,.07),branch([x,h+.58,z],[x*.96,h+1.06,z*1.04],.072,.026));
    parts.push(branch([x*.64,h+.4,z*.64],[x+side*.28,h+.79,z-.16],.06,.025));
  }
  return mergeGeometries(parts);
}
function kelpGeometry(){
  const p=[],uv=[],ix=[],segments=10;
  for(let i=0;i<=segments;i++){
    const t=i/segments,w=(Math.sin(t*Math.PI)*.27+.025)*(1-.15*t),x=Math.sin(t*7)*.22;
    p.push(x-w,t*4,0,x+w,t*4,0);uv.push(0,t,1,t);
    if(i<segments){const a=i*2;ix.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
function fanGeometry(){
  const parts=[branch([0,0,0],[0,2.0,0],.07,.025,5)];
  for(let i=0;i<11;i++){
    const a=-Math.PI*.43+i*Math.PI*.086,tip=[Math.sin(a)*1.45,1.0+Math.cos(a)*1.8,0];
    parts.push(branch([0,.6,0],tip,.047,.009,5));
    for(let j=1;j<4;j++){
      const t=j/4,x=tip[0]*t,y=.6+(tip[1]-.6)*t;
      parts.push(branch([x,y,0],[x+Math.sin(a+(a<0?-.7:.7))*.38,y+.36,.035],.021,.006,4));
    }
  }
  return mergeGeometries(parts);
}

/** Finite, seeded underwater habitat. Geometry/material counts never grow in update(). */
export function createAbyssWorld(scene){
  const root=new THREE.Group();root.name='ABYSS / original underwater world';scene.add(root);
  const geometries=new Set(),materials=new Set(),chunks=[],colliders=[],lights=[],pulses=[];
  const rng=random(),temp=new THREE.Object3D(),color=new THREE.Color();
  const clock={value:0},causticStrength={value:1},fogTint={value:new THREE.Color(0x087b92)},fogDensity={value:.0085};
  let tier=1,cullClock=1,disposed=false,lastPlayer={x:0,y:-4,z:18};
  const previousFog=scene.fog,previousBackground=scene.background;
  scene.fog=new THREE.FogExp2(0x167f95,.009);
  scene.background=new THREE.Color(0x087b92);
  const ownFog=scene.fog,ownBackground=scene.background;
  const registerG=g=>(geometries.add(g),g),registerM=m=>(materials.add(m),m);

  // Analytical caustics in world coordinates stay coherent across every material.
  const caustics=(m,sway=0)=>{
    m.onBeforeCompile=shader=>{
      shader.uniforms.uAbyssTime=clock;shader.uniforms.uAbyssCaustics=causticStrength;
      shader.vertexShader='uniform float uAbyssTime;varying vec3 vAbyssWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        ${sway?`float phase=position.y*.7+uAbyssTime*.65;
        #ifdef USE_INSTANCING
          phase+=instanceMatrix[3].x*.13+instanceMatrix[3].z*.11;
        #endif
        transformed.x+=sin(phase)*pow(max(position.y,0.)/4.,1.65)*${sway.toFixed(3)};
        transformed.z+=cos(phase*.79)*pow(max(position.y,0.)/4.,1.5)*${(sway*.55).toFixed(3)};`:''}`);
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vec4 abyssPosition=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          abyssPosition=instanceMatrix*abyssPosition;
        #endif
        vAbyssWorld=(modelMatrix*abyssPosition).xyz;`);
      shader.fragmentShader='uniform float uAbyssTime;uniform float uAbyssCaustics;varying vec3 vAbyssWorld;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        vec2 cp=vAbyssWorld.xz*.37+vec2(uAbyssTime*.085,-uAbyssTime*.065);
        float c1=sin(cp.x+sin(cp.y*1.47+uAbyssTime*.13));
        float c2=sin(cp.y*.91-sin(cp.x*1.24-uAbyssTime*.17));
        float c3=sin(cp.x*.76+cp.y*.73+uAbyssTime*.18);
        float caustic=pow(1.-abs((c1+c2+c3)/3.),14.);
        float sunDepth=exp(min(vAbyssWorld.y+12.,0.)*.038);
        outgoingLight+=vec3(.075,.22,.19)*caustic*sunDepth*uAbyssCaustics;
        outgoingLight*=vec3(.88,1.,1.02);
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey=()=>`abyss-caustics-v1-${sway}`;return m;
  };
  const standard=(props={},sway=0)=>registerM(caustics(new THREE.MeshStandardMaterial({roughness:.92,metalness:0,...props}),sway));
  const stone=standard({color:0x52676b,roughness:1});
  const rockMat=standard({color:0xffffff,roughness:1});
  const basalt=standard({color:0x2c4550,roughness:1,flatShading:true});
  const coral=standard({color:0xffffff,vertexColors:false,roughness:.85});
  const kelpMat=standard({color:0xffffff,side:THREE.DoubleSide,roughness:.75},.75);
  const fanMat=standard({color:0xc98182,side:THREE.DoubleSide,roughness:.78},.05);
  const metal=standard({color:0x426b73,metalness:.7,roughness:.57});
  const wornMetal=standard({color:0x996e43,metalness:.52,roughness:.82});
  const cyan=registerM(new THREE.MeshStandardMaterial({color:0x43effa,emissive:0x24dcdf,emissiveIntensity:2.2,roughness:.38}));
  const amber=registerM(new THREE.MeshStandardMaterial({color:0xffce83,emissive:0xffa63f,emissiveIntensity:1.8,roughness:.32}));
  const purple=registerM(new THREE.MeshStandardMaterial({color:0x7fe8ed,emissive:0x287bcb,emissiveIntensity:2.8,roughness:.48}));
  const rockGeo=registerG(new THREE.IcosahedronGeometry(1,1));
  const rockP=rockGeo.attributes.position;
  for(let i=0;i<rockP.count;i++){
    const x=rockP.getX(i),y=rockP.getY(i),z=rockP.getZ(i),n=1+.14*Math.sin(x*12+z*9)*Math.cos(y*11);
    rockP.setXYZ(i,x*n,y*(.87+.07*Math.cos(x*9)),z*n);
  }
  rockGeo.computeVertexNormals();rockGeo.computeBoundingSphere();
  const coralGeo=registerG(coralGeometry()),kelpGeo=registerG(kelpGeometry()),fanGeo=registerG(fanGeometry());
  const tubeGeo=registerG(new THREE.CylinderGeometry(.25,.4,1.7,8,2,true));tubeGeo.translate(0,.85,0);
  const bulbGeo=registerG(new THREE.SphereGeometry(1,10,7));
  const shellGeo=registerG(new THREE.SphereGeometry(1,12,7,0,TAU,0,Math.PI*.58));
  const boxGeo=registerG(new THREE.BoxGeometry(1,1,1));
  const pillarGeo=registerG(new THREE.CylinderGeometry(.82,1,1,7,2));
  const ringGeo=registerG(new THREE.TorusGeometry(1,.075,7,32));
  const terrainMat=standard({color:0xffffff,vertexColors:true,roughness:1});
  const sand=new THREE.Color(0x86aca0),deepSand=new THREE.Color(0x244d60),ridgeColor=new THREE.Color(0x36645f);
  const noProps=(x,z,r=7)=>[[-25,-38,11],[44,-102,15],[-18,-180,17],[0,18,8]].some(([a,b,s])=>(x-a)**2+(z-b)**2<(s+r*.2)**2);
  const mesh=(g,m,x,y,z,sx=1,sy=sx,sz=sx,parent=root)=>{
    const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);parent.add(o);return o;
  };
  const solid=(x,y,z,radius,height)=>colliders.push({x,y,z,radius,height});
  const point=(hex,intensity,distance,x,y,z)=>{const l=new THREE.PointLight(hex,intensity,distance,1.65);l.position.set(x,y,z);root.add(l);lights.push(l);return l;};
  const instance=(g,m,items,parent)=>{
    if(!items.length)return null;const o=new THREE.InstancedMesh(g,m,items.length);o.name=`Habitat instances / ${items.length}`;
    for(let i=0;i<items.length;i++){
      const p=items[i];temp.position.set(p.x,p.y,p.z);temp.rotation.set(p.rx||0,p.ry||0,p.rz||0);temp.scale.set(p.sx,p.sy,p.sz);temp.updateMatrix();o.setMatrixAt(i,temp.matrix);if(p.c)o.setColorAt(i,color.set(p.c));
    }
    o.instanceMatrix.needsUpdate=true;if(o.instanceColor)o.instanceColor.needsUpdate=true;o.computeBoundingSphere();parent.add(o);o.userData.fullCount=items.length;return o;
  };

  // 48 independent 55 m tiles: 55,296 terrain triangles, with actual distance culling.
  let rockCount=0,coralCount=0,kelpCount=0,fanCount=0,tubeCount=0;
  for(let iz=0;iz<6;iz++)for(let ix=0;ix<8;ix++){
    const x0=BOUNDS.minX+ix*55,z0=BOUNDS.minZ+iz*(320/6),cx=x0+27.5,cz=z0+160/6;
    const group=new THREE.Group();group.name=`Reef tile ${ix}:${iz}`;root.add(group);
    const resolution=24,g=new THREE.PlaneGeometry(55,320/6,resolution,resolution);g.rotateX(-Math.PI/2);g.translate(cx,0,cz);
    const p=g.attributes.position,colors=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),h=terrainHeight(x,z);p.setY(i,h);
      const d=smooth(28,72,-h),ripple=(Math.sin(z*1.33+x*.32)*.5+.5)*.07;
      color.copy(sand).lerp(deepSand,d).lerp(ridgeColor,Math.max(0,Math.sin(x*.07+z*.044))*.25).multiplyScalar(.92+ripple);
      color.toArray(colors,i*3);
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();registerG(g);group.add(new THREE.Mesh(g,terrainMat));
    const rocks=[],corals=[],kelps=[],fans=[],tubes=[];
    for(let j=0;j<13;j++){
      const x=x0+3+rng()*49,z=z0+3+rng()*(320/6-6);if(noProps(x,z))continue;
      const s=1.0+rng()*4.2,h=terrainHeight(x,z);
      rocks.push({x,y:h+s*.3,z,sx:s,sy:s*(.55+rng()*.9),sz:s*(.65+rng()*.75),ry:rng()*TAU,rx:rng()*.15,rz:rng()*.15,c:color.setHex(0x486e71).lerp(new THREE.Color(0x304e63),smooth(65,190,-z)).multiplyScalar(.8+rng()*.45).getHex()});
      // Large rocks have collision. Pebbles and soft coral can be swum through.
      if(s>3.1)solid(x,h+s*.38,z,s*.8,s*1.35);
    }
    for(let j=0;j<19;j++){
      const x=x0+3+rng()*49,z=z0+3+rng()*(320/6-6),h=terrainHeight(x,z);if(noProps(x,z)||rng()<smooth(80,190,-z)*.65)continue;
      const s=.48+rng()*1.08,palette=[0xd68b82,0xd2ac82,0x78bbac,0xa485b4,0xbfd4b9];
      corals.push({x,y:h-.1,z,sx:s,sy:s,sz:s,ry:rng()*TAU,c:palette[Math.floor(rng()*palette.length)]});
      if(j%3===0)fans.push({x:x+1,y:h-.05,z:z-.7,sx:s*1.3,sy:s*1.3,sz:s,ry:rng()*TAU});
    }
    for(let j=0;j<39;j++){
      const x=x0+2+rng()*51,z=z0+2+rng()*(320/6-4),h=terrainHeight(x,z);if(noProps(x,z)||z< -157||rng()<smooth(80,150,-z)*.5)continue;
      const s=.65+rng()*1.1;kelps.push({x,y:h-.2,z,sx:s,sy:s*(1+rng()*1.6),sz:s,ry:rng()*TAU,c:color.setHex(0x618250).lerp(new THREE.Color(0x34786d),rng()).getHex()});
    }
    for(let j=0;j<6;j++){
      const x=x0+5+rng()*45,z=z0+5+rng()*(320/6-10),h=terrainHeight(x,z);if(noProps(x,z))continue;
      const s=.5+rng()*1.3;for(let k=0;k<3;k++)tubes.push({x:x+k*.36,y:h,z:z+Math.sin(k*3)*.32,sx:s*(1-k*.12),sy:s*(1+k*.2),sz:s*(1-k*.12),rz:(k-1)*.12,c:z< -120?0x4fa5b5:0xd69b82});
    }
    const rockMesh=instance(rockGeo,rockMat,rocks,group),coralMesh=instance(coralGeo,coral,corals,group),kelpMesh=instance(kelpGeo,kelpMat,kelps,group),fanMesh=instance(fanGeo,fanMat,fans,group),tubeMesh=instance(tubeGeo,coral,tubes,group);
    rockCount+=rocks.length;coralCount+=corals.length;kelpCount+=kelps.length;fanCount+=fans.length;tubeCount+=tubes.length;
    chunks.push({group,x:cx,z:cz,details:[coralMesh,kelpMesh,fanMesh,tubeMesh].filter(Boolean),rock:rockMesh});
  }

  // Distant ridgelines give a readable silhouette without closing the exploration space.
  const ridgeItems=[];
  for(let i=0;i<38;i++){
    const side=i%2?-1:1,z=72-(i/38)*302,x=side*(113+rng()*85),h=terrainHeight(x,z),height=17+rng()*35,r=7+rng()*9;
    ridgeItems.push({x,y:h+height*.31,z,sx:r,sy:height,sz:r*(.8+rng()*.45),ry:rng()*TAU});solid(x,h+height*.31,z,r*.92,height);
  }
  instance(pillarGeo,basalt,ridgeItems,root);

  const landmarks={
    A:{id:'A',name:'Coral relay',position:new THREE.Vector3(-25,terrainHeight(-25,-38)+3,-38)},
    B:{id:'B',name:'Drowned observatory',position:new THREE.Vector3(44,terrainHeight(44,-102)+4,-102)},
    C:{id:'C',name:'Luminous vault',position:new THREE.Vector3(-18,terrainHeight(-18,-180)+5,-180)}
  };
  // RELAY A: abandoned instrument cradled by a luminous coral garden.
  {
    const {x,y,z}=landmarks.A.position,base=terrainHeight(x,z),g=new THREE.Group();g.name='A / Coral relay';root.add(g);landmarks.A.object=g;
    mesh(pillarGeo,stone,x,base+.45,z,4.6,.9,4.6,g);mesh(boxGeo,metal,x,base+1.8,z,2.1,2.3,1.6,g);
    const screen=mesh(boxGeo,amber,x,base+2.4,z+.83,1.4,.6,.045,g);pulses.push({mesh:screen,base:1.8,speed:1.4});
    mesh(pillarGeo,wornMetal,x,base+4,z,.08,3,.08,g);mesh(bulbGeo,cyan,x,base+5.55,z,.21,.21,.21,g);
    const ring=mesh(ringGeo,metal,x,base+2.8,z,2.5,2.5,2.5,g);ring.rotation.x=Math.PI/2.3;
    for(let i=0;i<9;i++){
      const a=i*TAU/9,r=3.8+rng(),xx=x+Math.cos(a)*r,zz=z+Math.sin(a)*r,h=terrainHeight(xx,zz);
      const c=mesh(coralGeo,coral,xx,h,zz,1.3,1.6,1.3,g);c.rotation.y=a;
      const b=mesh(bulbGeo,cyan,xx,h+1.3,zz,.13,.13,.13,g);pulses.push({mesh:b,base:2.2,speed:1+i*.08});
    }
    point(0x83ede2,19,18,x,base+4,z);solid(x,base+1.8,z,1.22,3);
  }
  // OBSERVATORY B: interrupted colonnade, open gantry and a battered diving bell.
  {
    const {x,y,z}=landmarks.B.position,base=terrainHeight(x,z),g=new THREE.Group();g.name='B / Drowned observatory';root.add(g);landmarks.B.object=g;
    const slab=mesh(boxGeo,stone,x,base-.1,z,24,1,19,g);slab.rotation.y=.12;
    for(let side=-1;side<=1;side+=2)for(let row=0;row<3;row++){
      const xx=x+side*8.5,zz=z-7+row*7,h=terrainHeight(xx,zz),height=row===0&&side===1?6:13;
      const c=mesh(pillarGeo,stone,xx,h+height/2,zz,1.3,height,1.3,g);c.rotation.z=side*.035;
      mesh(boxGeo,stone,xx,h+.65,zz,3.1,1.3,3.1,g);mesh(boxGeo,stone,xx,h+height-.6,zz,2.8,.8,2.8,g);solid(xx,h+height/2,zz,1.5,height);
    }
    for(let row=0;row<2;row++)mesh(boxGeo,stone,x,base+12.6,z+row*7,19,1.1,2.2,g);
    const beam=mesh(boxGeo,metal,x-1,base+6.5,z-4,15,.5,.5,g);beam.rotation.z=.5;
    const bellX=x+1.1,bellZ=z+1.8;
    mesh(shellGeo,wornMetal,bellX,base+7.3,bellZ,3.1,4.0,3.1,g);
    const rim=mesh(ringGeo,wornMetal,bellX,base+6.3,bellZ,3.1,3.1,3.1,g);rim.rotation.x=Math.PI/2;
    for(let i=0;i<4;i++){
      const a=i*TAU/4,xx=bellX+Math.cos(a)*2.96,zz=bellZ+Math.sin(a)*2.96;
      mesh(pillarGeo,metal,xx,base+7.3,zz,.13,4,.13,g);solid(xx,base+7.3,zz,.18,4);
    }
    const light=mesh(bulbGeo,amber,bellX,base+8.7,bellZ,.34,.2,.34,g);pulses.push({mesh:light,base:1.8,speed:.7});
    // Air remains a game-owned resource; this marks the bell's safe visual volume.
    landmarks.B.airPocket={x:bellX,y:base+7.2,z:bellZ,radius:2.6};
    const pocketMat=registerM(new THREE.MeshBasicMaterial({color:0xb6fff2,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false}));
    const pocket=mesh(registerG(new THREE.CircleGeometry(2.35,32)),pocketMat,bellX,base+9.2,bellZ,1,1,1,g);pocket.rotation.x=-Math.PI/2;
    point(0xffcc87,36,23,bellX,base+6.4,bellZ);
    mesh(boxGeo,metal,x-1.5,base+2.2,z+2,2.4,1.3,1.4,g);mesh(boxGeo,cyan,x-1.5,base+2.85,z+2,1.6,.07,.9,g);
    for(let i=0;i<6;i++){
      const xx=x-12+rng()*24,zz=z-10+rng()*22,h=terrainHeight(xx,zz);const a=mesh(boxGeo,stone,xx,h+.5,zz,2+rng()*3,1,1.5+rng(),g);a.rotation.set(rng()*.2,rng()*TAU,rng()*.2);
    }
  }
  // VAULT C: a vast natural arch with a clear traversable opening and luminous mineral seams.
  {
    const {x,y,z}=landmarks.C.position,base=terrainHeight(x,z),g=new THREE.Group();g.name='C / Luminous vault';root.add(g);landmarks.C.object=g;
    const radius=11.8,tube=3.4,archZ=z-6,archY=base+10;
    const archGeo=registerG(new THREE.TorusGeometry(radius,tube,9,28,Math.PI*1.78));
    const arch=mesh(archGeo,basalt,x,archY,archZ,1,1.13,.83,g);arch.rotation.z=-Math.PI*.39;
    // Each stone section is represented by an upright collision cylinder.
    for(let i=0;i<19;i++){
      const a=-Math.PI*.39+i/(18)*Math.PI*1.78,xx=x+Math.cos(a)*radius,yy=archY+Math.sin(a)*radius*1.13;
      if(yy>terrainHeight(xx,archZ)+1)solid(xx,yy,archZ,tube*.9,tube*2.2);
    }
    for(let i=0;i<16;i++){
      const side=i%2?1:-1,xx=x+side*(14+rng()*9),zz=z-14+(i/16)*35,h=terrainHeight(xx,zz),height=9+rng()*16,r=2.5+rng()*3;
      mesh(pillarGeo,basalt,xx,h+height*.38,zz,r,height,r*.8,g);solid(xx,h+height*.38,zz,r*.92,height);
    }
    const mineralItems=[];
    for(let i=0;i<42;i++){
      const a=i*TAU/42,rr=10.2+rng()*1.9,xx=x+Math.cos(a)*rr,yy=archY+Math.sin(a)*rr*1.13,zz=archZ+3.0;
      if(yy<terrainHeight(xx,zz)+.5)continue;
      mineralItems.push({x:xx,y:yy,z:zz,sx:.15+rng()*.32,sy:.35+rng()*.75,sz:.16+rng()*.22,ry:rng()*TAU,rz:a});
    }
    instance(pillarGeo,purple,mineralItems,g);
    for(let i=0;i<22;i++){
      const a=rng()*TAU,rr=3+rng()*16,xx=x+Math.cos(a)*rr,zz=z+Math.sin(a)*rr,h=terrainHeight(xx,zz);
      mesh(bulbGeo,purple,xx,h+.4,zz,.28+rng()*.2,.17,.28,g);
    }
    mesh(pillarGeo,metal,x,base+1.8,z,1.4,3.6,1.4,g);mesh(bulbGeo,cyan,x,base+4,z,.7,.7,.7,g);
    const ring=mesh(ringGeo,purple,x,base+4,z,1.5,1.5,1.5,g);ring.rotation.x=Math.PI/2;
    point(0x49b4ff,42,32,x,base+8,archZ+3);point(0x78ffdf,16,15,x,base+3,z+2);solid(x,base+1.8,z,1.2,3.6);
  }

  // Sunlit underside of the surface: large waves plus fine moving optical ripples.
  const surfaceMat=registerM(new THREE.ShaderMaterial({side:THREE.DoubleSide,depthWrite:true,fog:false,uniforms:{uTime:clock,uFogColor:fogTint,uFogDensity:fogDensity},vertexShader:`
    uniform float uTime;varying vec3 vWorld;void main(){vec3 p=position;p.z+=sin(p.x*.07+uTime*.6)*.22+cos(p.y*.09-uTime*.4)*.14;vWorld=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader:`uniform float uTime;uniform float uFogDensity;uniform vec3 uFogColor;varying vec3 vWorld;void main(){
      vec2 p=vWorld.xz;float a=sin(p.x*.24+sin(p.y*.17+uTime*.32)*2.);
      float b=sin(p.y*.22+sin(p.x*.19-uTime*.22)*1.7);
      float ripple=pow(1.-abs((a+b)*.5),7.);float sun=exp(-length(p-vec2(-25.,-40.))*.024);
      vec3 water=mix(vec3(.018,.21,.30),vec3(.22,.71,.74),.46+sun*.36);water+=ripple*vec3(.045,.16,.15)+pow(sun,7.)*vec3(.75,.91,.75);
      float opticalDistance=length(cameraPosition-vWorld);float distanceFade=exp(-opticalDistance*opticalDistance*uFogDensity*uFogDensity);water=mix(uFogColor,water,distanceFade);gl_FragColor=vec4(water,1.);}`
  }));
  const surface=mesh(registerG(new THREE.PlaneGeometry(680,680,44,44)),surfaceMat,0,.1,-75);surface.rotation.x=-Math.PI/2;

  // Five shared, soft volume cones. They are visual shafts, never collision solids.
  const beamMat=registerM(new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{uTime:clock,uStrength:{value:1}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform float uTime;uniform float uStrength;varying vec2 vUv;void main(){float edge=pow(sin(vUv.x*3.14159265),4.);float end=sin(vUv.y*3.14159265);float pulse=.8+.2*sin(vUv.y*17.+uTime*.24);gl_FragColor=vec4(.25,.77,.82,edge*end*pulse*.033*uStrength);}`}));
  const beamGeo=registerG(new THREE.CylinderGeometry(.45,7.8,66,14,1,true));
  const beams=new THREE.Group();beams.name='Soft light shafts';root.add(beams);
  for(let i=0;i<5;i++){const b=mesh(beamGeo,beamMat,-54+i*24,-25,-16-i*20,1,1,1,beams);b.rotation.z=-.20;b.rotation.x=.14;}

  // Single point buffer: particulate drifts in the shader inside a viewer-local volume.
  const particleCount=1350,pp=new Float32Array(particleCount*3),seed=new Float32Array(particleCount);
  for(let i=0;i<particleCount;i++){pp[i*3]=(rng()-.5)*110;pp[i*3+1]=(rng()-.5)*86;pp[i*3+2]=(rng()-.5)*110;seed[i]=rng();}
  const particlesGeo=registerG(new THREE.BufferGeometry());particlesGeo.setAttribute('position',new THREE.BufferAttribute(pp,3));particlesGeo.setAttribute('aSeed',new THREE.BufferAttribute(seed,1));
  const particleMat=registerM(new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:clock,uOrigin:{value:new THREE.Vector3(0,-4,18)},uOpacity:{value:.6}},vertexShader:`
    uniform float uTime;uniform vec3 uOrigin;attribute float aSeed;varying float vAlpha;void main(){
      vec3 p=position;p.y=mod(p.y+43.+uTime*(.18+aSeed*.26),86.)-43.;p.x+=sin(uTime*.12+aSeed*40.)*.65;p+=uOrigin;
      vec4 mv=viewMatrix*vec4(p,1.);float d=length(mv.xyz);vAlpha=(1.-smoothstep(18.,58.,d))*(.22+aSeed*.45);gl_PointSize=clamp((.08+aSeed*.13)*420./max(1.,-mv.z),1.,3.4);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform float uOpacity;varying float vAlpha;void main(){float r=length(gl_PointCoord-.5);float a=(1.-smoothstep(.05,.5,r))*vAlpha*uOpacity;gl_FragColor=vec4(.61,.88,.88,a);}`
  }));
  const particles=new THREE.Points(particlesGeo,particleMat);particles.frustumCulled=false;root.add(particles);

  const ambient=new THREE.HemisphereLight(0x86e2dc,0x153541,2.0);root.add(ambient);
  const sunlight=new THREE.DirectionalLight(0xbaffea,2.5);sunlight.position.set(-44,60,15);sunlight.target.position.set(10,-40,-90);root.add(sunlight,sunlight.target);
  const fill=new THREE.DirectionalLight(0x397dac,.65);fill.position.set(100,-5,-100);root.add(fill);
  const shallowFog=new THREE.Color(0x137c91),deepFog=new THREE.Color(0x031421),shallowBG=new THREE.Color(0x076f8e),deepBG=new THREE.Color(0x020e19);
  const stats={terrainTiles:48,terrainTriangles:48*24*24*2,rocks:rockCount,corals:coralCount,kelp:kelpCount,fans:fanCount,tubes:tubeCount,particles:particleCount,lightShafts:5,pointLights:lights.length,colliders:colliders.length,quality:'medium',visibleChunks:0,materials:materials.size,geometries:geometries.size,bounds:BOUNDS,originalArt:true,notes:'All repeated habitat instanced; no per-frame geometry/material allocation; up to 4 local point lights; no dynamic shadows.'};
  const tierFrom=q=>typeof q==='number'?clamp(Math.round(q),0,2):q==='low'?0:q==='high'?2:1;
  function setQuality(q){
    tier=tierFrom(q);stats.quality=['low','medium','high'][tier];
    particlesGeo.setDrawRange(0,[450,850,1350][tier]);beams.visible=tier>0;beamMat.uniforms.uStrength.value=tier===2?1:.72;causticStrength.value=[.68,1,1.12][tier];
    for(const chunk of chunks)for(let i=0;i<chunk.details.length;i++){
      const o=chunk.details[i];o.count=Math.max(1,Math.floor(o.userData.fullCount*[.46,.75,1][tier]));
    }
    for(let i=0;i<lights.length;i++)lights[i].visible=tier>0||i===0||i===2;
    cullClock=1;
  }
  function update(dt,time,player,quality){
    if(disposed)return;
    if(quality!==undefined&&tierFrom(quality)!==tier)setQuality(quality);
    clock.value=Number.isFinite(time)?time:clock.value+Math.max(0,dt||0);
    const p=player?.position||player||lastPlayer;
    const px=Number.isFinite(p.x)?p.x:0,py=Number.isFinite(p.y)?p.y:-4,pz=Number.isFinite(p.z)?p.z:18;
    lastPlayer.x=px;lastPlayer.y=py;lastPlayer.z=pz;
    const depth=smooth(13,78,-py),south=smooth(70,205,-pz),darkness=clamp(depth*.78+south*.22,0,1);
    ownFog.color.copy(shallowFog).lerp(deepFog,darkness);ownFog.density=mix(.0085,.018,darkness);fogDensity.value=ownFog.density;
    ownBackground.copy(shallowBG).lerp(deepBG,darkness);fogTint.value.copy(ownFog.color);
    ambient.intensity=mix(2.0,.48,darkness);sunlight.intensity=mix(2.5,.24,darkness);fill.intensity=mix(.65,.24,darkness);
    beamMat.uniforms.uStrength.value=(tier===2?1:.72)*(1-darkness*.8);
    particleMat.uniforms.uOrigin.value.set(px,Math.min(-4,py),pz);particleMat.uniforms.uOpacity.value=mix(.46,.7,darkness);
    // Material sharing keeps pulse updates constant-sized; no new resources are created.
    cyan.emissiveIntensity=2.1+Math.sin(clock.value*1.25)*.28;
    amber.emissiveIntensity=1.65+Math.sin(clock.value*.8)*.12;
    purple.emissiveIntensity=2.6+Math.sin(clock.value*.53)*.3;
    cullClock+=Math.max(0,dt||0);
    if(cullClock>.32){
      cullClock=0;const radius=[105,145,190][tier];let visible=0;
      for(const chunk of chunks){
        const distance=Math.hypot(px-chunk.x,pz-chunk.z);chunk.group.visible=distance<radius+39;
        if(chunk.group.visible)visible++;
        for(let i=0;i<chunk.details.length;i++)chunk.details[i].visible=distance<[65,98,145][tier]+25;
      }
      stats.visibleChunks=visible;
    }
  }
  function dispose(){
    if(disposed)return;disposed=true;scene.remove(root);
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
    if(scene.fog===ownFog)scene.fog=previousFog;if(scene.background===ownBackground)scene.background=previousBackground;
    chunks.length=0;colliders.length=0;pulses.length=0;lights.length=0;
  }
  setQuality('medium');update(0,0,lastPlayer);
  return {root,update,setQuality,dispose,stats,colliders,landmarks,airBell:landmarks.B.airPocket,terrainHeight,bounds:BOUNDS};
}
