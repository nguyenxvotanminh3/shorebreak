import * as THREE from './vendor/three.module.js';

// Original procedural sea machinery. Metres, waterline y=0, incoming surfer moves -Z.
// animate only touches internal pivots; callers own root position, rotation and scale.
// Collision proxies are unscaled ROOT-LOCAL ellipsoids from the last visual frame.
const TAU=Math.PI*2;
let MATERIALS;
function mats(){return MATERIALS??={
  painted:new THREE.MeshStandardMaterial({vertexColors:true,metalness:.63,roughness:.46}),
  steel:new THREE.MeshStandardMaterial({color:0xa1b1b2,metalness:.77,roughness:.32}),
  rust:new THREE.MeshStandardMaterial({color:0x8d4031,metalness:.58,roughness:.72}),
  dark:new THREE.MeshStandardMaterial({color:0x17242a,metalness:.58,roughness:.48}),
  yellow:new THREE.MeshStandardMaterial({color:0xffc128,metalness:.31,roughness:.4}),
  red:new THREE.MeshStandardMaterial({color:0xd93828,metalness:.28,roughness:.47}),
  white:new THREE.MeshStandardMaterial({color:0xd8e9df,metalness:.25,roughness:.43}),
  lens:new THREE.MeshStandardMaterial({color:0xff3c19,emissive:0xff2200,emissiveIntensity:1.5,roughness:.27}),
};}
function addMesh(group,g,key){const m=new THREE.Mesh(g,mats()[key]);group.add(m);return m;}
function merge(geos){
  const list=geos.map(g=>g.index?g.toNonIndexed():g);let count=0;for(const g of list)count+=g.attributes.position.count;
  const g=new THREE.BufferGeometry();for(const key of ['position','normal','color']){const a=new Float32Array(count*3);let offset=0;for(const part of list){a.set(part.attributes[key].array,offset);offset+=part.attributes[key].array.length;}g.setAttribute(key,new THREE.BufferAttribute(a,3));}
  g.computeBoundingSphere();for(let i=0;i<list.length;i++){if(list[i]!==geos[i])list[i].dispose();geos[i].dispose();}return g;
}
function batch(group){const bins={};return{add(key,g){(bins[key]??=[]).push(g);return g;},finish(){const all=[];for(const [key,geos]of Object.entries(bins)){const c=mats()[key].color;for(const g of geos){const colors=new Float32Array(g.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(colors,3));all.push(g);}}addMesh(group,merge(all),'painted');}};}
function box(x,y,z,w,h,d,rx=0,ry=0,rz=0){const g=new THREE.BoxGeometry(w,h,d);g.rotateX(rx);g.rotateY(ry);g.rotateZ(rz);g.translate(x,y,z);return g;}
function cylinder(x,y,z,r,h,axis='y',segments=18,r2=r){const g=new THREE.CylinderGeometry(r,r2,h,segments,1,false);if(axis==='x')g.rotateZ(Math.PI/2);if(axis==='z')g.rotateX(Math.PI/2);g.translate(x,y,z);return g;}
function sphere(x,y,z,r){const g=new THREE.SphereGeometry(r,10,6);g.translate(x,y,z);return g;}
function torus(x,y,z,r,t,axis='z'){const g=new THREE.TorusGeometry(r,t,7,28);if(axis==='x')g.rotateY(Math.PI/2);if(axis==='y')g.rotateX(Math.PI/2);g.translate(x,y,z);return g;}
function beam(a,b,width=.1){const v=new THREE.Vector3(...a),w=new THREE.Vector3(...b),delta=w.clone().sub(v),g=new THREE.CylinderGeometry(width,width,delta.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);return g;}
function collider(x,y,z,rx,ry,rz,part){return{x,y,z,rx,ry,rz,part};}
function boltRing(b,x,y,z,r,axis='z',count=8){for(let k=0;k<count;k++){const a=k/count*TAU;let px=x,py=y,pz=z;if(axis==='x'){py+=Math.sin(a)*r;pz+=Math.cos(a)*r;}else{px+=Math.sin(a)*r;py+=Math.cos(a)*r;}b.add('dark',cylinder(px,py,pz,.058,.075,axis,6));}}
// Raised diagonal yellow/black marks remain readable from gameplay distance.
function hazardBar(b,x,y,z,w,h=.24){b.add('dark',box(x,y,z,w,h,.12));const step=.32;for(let i=0;i<Math.floor(w/step);i++)b.add('yellow',box(x-w/2+.16+i*step,y,z+.071,.13,h*.93,.018,0,0,-.38));}
function pontoon(b,x,z,length=3.4){b.add('rust',cylinder(x,-.13,z,.38,length,'z',16));b.add('dark',cylinder(x,-.13,z-length/2,.41,.1,'z',16));b.add('dark',cylinder(x,-.13,z+length/2,.41,.1,'z',16));for(const dz of [-.7,.7])b.add('yellow',torus(x,-.13,z+dz,.38,.034));}
function ringMarker(b,x,z,r=.9){b.add('yellow',torus(x,.04,z,r,.035,'y'));for(let i=0;i<8;i++){const a=i/8*TAU;b.add('yellow',box(x+Math.sin(a)*r,.055,z+Math.cos(a)*r,.07,.022,.24,0,a,0));}}
function machineResult(type,root,proxies,animate,inspect,dimensions){
  const result={group:root,animate,getColliders(){return proxies;},inspect,type,...dimensions};animate(0);return result;
}

function grinder(){
  const root=new THREE.Group(),frame=new THREE.Group();root.add(frame);const b=batch(frame);
  for(const s of [-1,1]){pontoon(b,s*2.65,0,3.3);b.add('dark',box(s*2.54,.52,0,.34,1.35,1.35));b.add('rust',box(s*2.55,.95,0,.62,.45,1.6));b.add('steel',cylinder(s*2.48,1.13,0,.28,.34,'x'));b.add('yellow',box(s*2.55,1.35,0,.6,.12,1.65));hazardBar(b,s*2.55,.97,.82,.57,.30);}
  b.add('dark',box(0,.07,.73,5.35,.13,.18));b.add('dark',box(0,.07,-.73,5.35,.13,.18));
  hazardBar(b,0,.22,1.14,4.65,.26);b.add('rust',box(0,.03,0,4.85,.14,1.8));
  // A ramp lip makes the low drum's jump route legible from the approach.
  b.add('dark',box(0,.04,1.41,3.5,.10,.65,-.2));b.add('yellow',box(0,.11,1.59,3.5,.035,.10));
  const motorX=2.95;b.add('red',cylinder(motorX,1.05,0,.33,.68,'x'));for(let i=0;i<5;i++)b.add('dark',torus(motorX-.25+i*.12,1.05,0,.34,.022,'x'));
  b.finish();
  const rotor=new THREE.Group();rotor.position.y=1.13;root.add(rotor);const r=batch(rotor);
  r.add('dark',cylinder(0,0,0,.67,4.25,'x',28));r.add('steel',cylinder(0,0,0,.13,5.4,'x',16));
  for(const side of [-1,1]){r.add('rust',cylinder(side*2.04,0,0,.80,.12,'x',24));r.add('steel',torus(side*2.12,0,0,.56,.047,'x'));boltRing(r,side*2.15,0,0,.48,'x');}
  // Staggered rows of actual triangular cutting teeth, not a painted cylinder.
  for(let row=0;row<9;row++)for(let k=0;k<9;k++){
    const shape=new THREE.Shape();shape.moveTo(-.15,0);shape.lineTo(.12,.34);shape.lineTo(.24,0);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:.3,bevelEnabled:false});const p=g.attributes.position;
    for(let i=0;i<p.count;i++){const u=p.getX(i),v=p.getY(i),w=p.getZ(i);p.setXYZ(i,.15-w,v+.61,u);}g.computeVertexNormals();g.rotateX(k/9*TAU+row*.29);g.translate(-1.76+row*.44,0,0);r.add(row%3===0?'yellow':'steel',g);
  }r.finish();
  const proxies=[collider(0,1.13,0,2.08,.96,.96,'blades'),collider(0,.07,0,2.43,.14,.9,'deck'),collider(-2.55,.66,0,.36,.82,.8,'support'),collider(2.65,.68,0,.58,.85,.8,'motor')];
  const inspect={rotorAngle:0,bladeTipY:0,jumpClearance:2.3};
  return machineResult('grinder',root,proxies,t=>{rotor.rotation.x=t*5.4;inspect.rotorAngle=rotor.rotation.x;inspect.bladeTipY=1.13+.95*Math.cos(rotor.rotation.x);},inspect,{label:'MÁY NGHIỀN',radius:3.2,height:2.12,jumpClearance:2.3,routes:'Jump above 2.3 m, or pass x < -3.2 / x > 3.4 m. Teeth spin continuously.'});
}

function sawWheel(){
  const group=new THREE.Group(),b=batch(group);b.add('steel',cylinder(0,0,0,1.04,.14,'z',36));b.add('dark',cylinder(0,0,.09,.71,.065,'z',24));b.add('rust',cylinder(0,0,.13,.35,.10,'z',18));b.add('yellow',cylinder(0,0,.19,.13,.12,'z',12));
  for(let k=0;k<18;k++){
    const a=k/18*TAU,shape=new THREE.Shape();shape.moveTo(-.11,.97);shape.lineTo(.04,1.30);shape.lineTo(.19,1.04);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:.13,bevelEnabled:false});g.translate(0,0,-.065);g.rotateZ(a);b.add('steel',g);
  }
  for(let k=0;k<6;k++){const a=k/6*TAU;b.add('yellow',box(Math.sin(a)*.63,Math.cos(a)*.63,.14,.12,.38,.025,0,0,-a));}
  boltRing(b,0,0,.20,.28,'z',6);b.finish();return group;
}
function sawGate(){
  const root=new THREE.Group(),frame=new THREE.Group();root.add(frame);const b=batch(frame);
  for(const sign of [-1,1]){
    pontoon(b,sign*3.9,0,3.6);b.add('rust',box(sign*3.9,2.75,0,.34,5.46,.34));b.add('dark',box(sign*3.9,.32,0,.76,.25,1.5));
    b.add('dark',beam([sign*3.9,.15,.95],[sign*3.9,2.2,0],.075));hazardBar(b,sign*3.9,1.30,.20,.30,.76);
  }
  b.add('yellow',box(0,5.41,0,8.2,.30,.38));b.add('dark',box(0,5.17,0,7.7,.11,.16));
  b.add('steel',cylinder(0,5.20,0,.07,7.7,'x',12));hazardBar(b,0,5.40,.205,7.7,.24);b.finish();
  const carriages=[],wheels=[];
  for(const sign of [-1,1]){
    const carriage=new THREE.Group();root.add(carriage);carriages.push(carriage);const cb=batch(carriage);
    cb.add('dark',box(0,5.18,0,.62,.44,.5));cb.add('rust',box(0,3.28,-.2,.18,3.58,.16));cb.add('steel',cylinder(0,1.45,-.2,.12,.64,'z'));
    cb.add('red',cylinder(0,1.45,-.42,.28,.28,'z'));cb.add('yellow',box(0,5.12,.275,.48,.10,.05));cb.finish();
    const wheel=sawWheel();wheel.position.y=1.45;carriage.add(wheel);wheels.push(wheel);
  }
  const proxies=[collider(-2.5,1.45,0,1.30,1.30,.22,'saw'),collider(2.5,1.45,0,1.30,1.30,.22,'saw'),collider(-3.9,2.71,0,.24,2.78,.24,'pillar'),collider(3.9,2.71,0,.24,2.78,.24,'pillar'),collider(0,5.42,0,4.1,.18,.22,'rail')];
  const inspect={phase:0,gapWidth:0,sawLeftX:0,sawRightX:0,jumpClearance:2.96};
  return machineResult('sawGate',root,proxies,t=>{const phase=t/5.4*TAU,offset=2.26+.65*Math.sin(phase);for(let i=0;i<2;i++){const sign=i===0?-1:1;carriages[i].position.x=sign*offset;wheels[i].rotation.z=t*sign*7.8;proxies[i].x=sign*offset;}
    inspect.phase=phase%TAU;inspect.gapWidth=offset*2-2.6;inspect.sawLeftX=-offset;inspect.sawRightX=offset;
  },inspect,{label:'CỔNG CƯA',radius:4.25,height:5.6,jumpClearance:2.96,period:5.4,routes:'Middle gap varies 0.62–3.22 m; wait for the wide phase, jump above 2.96 m beneath the 5.2 m rail, or bypass beyond x=±4.4 m.'});
}

function piston(){
  const root=new THREE.Group(),frame=new THREE.Group();root.add(frame);const b=batch(frame);
  for(const sign of [-1,1]){pontoon(b,sign*2.8,0,3.9);b.add('dark',box(sign*2.8,.25,0,.68,.3,1.8));b.add('rust',box(sign*2.8,2.30,0,.40,4.55,.4));
    b.add('steel',cylinder(sign*2.78,2.31,.23,.035,4.25,'y',8));b.add('dark',beam([sign*2.8,.30,1.3],[sign*2.8,2.7,0],.08));hazardBar(b,sign*2.8,1.15,.23,.35,.88);}
  b.add('yellow',box(0,4.5,0,6.18,.42,.5));hazardBar(b,0,4.5,.265,5.8,.29);b.add('dark',box(0,4.64,0,1.13,.47,.92));
  b.add('rust',cylinder(0,4.11,0,.43,1.1,'y',20));b.add('steel',torus(0,3.58,0,.4,.05,'y'));b.add('dark',box(0,-.02,0,2.80,.16,2.2));ringMarker(b,0,0,1.35);b.finish();
  const hammer=new THREE.Group();root.add(hammer);const h=batch(hammer);
  h.add('dark',cylinder(0,0,0,1.05,.56,'y',24));h.add('steel',cylinder(0,-.25,0,1.12,.14,'y',24));h.add('yellow',cylinder(0,.16,0,1.08,.18,'y',24));h.add('rust',cylinder(0,.38,0,.63,.20,'y',20));
  for(let k=0;k<12;k++){const a=k/12*TAU;h.add('dark',box(Math.sin(a)*1.075,.16,Math.cos(a)*1.075,.20,.20,.055,0,a,0));}h.finish();
  // Telescoping steel ram stretches between fixed housing and animated hammer.
  const rod=addMesh(root,cylinder(0,0,0,.14,1,'y',12),'steel');
  const warningMat=mats().lens.clone(),warning=new THREE.Mesh(new THREE.SphereGeometry(.16,12,8),warningMat);warning.position.set(0,4.88,.30);root.add(warning);
  const proxies=[collider(0,3.1,0,1.12,.34,1.12,'hammer'),collider(0,-.02,0,1.4,.08,1.1,'anvil'),collider(-2.8,2.23,0,.28,2.3,.28,'pillar'),collider(2.8,2.23,0,.28,2.3,.28,'pillar'),collider(0,4.5,0,3.1,.24,.3,'beam')];
  const inspect={phase:0,hammerY:0,hammerBottom:0,warning:false,crushing:false,state:'raised',safeUnder:true};
  function movement(t){const phase=((t%4.8)+4.8)%4.8;let y=3.12,state='raised';
    if(phase>=1.55&&phase<2.10){const u=(phase-1.55)/.55;y=3.12+.35*Math.sin(u*Math.PI/2);state='warning';}
    else if(phase>=2.10&&phase<2.42){const u=(phase-2.10)/.32;y=3.47-2.91*u*u;state='falling';}
    else if(phase>=2.42&&phase<2.92){y=.56;state='crushing';}
    else if(phase>=2.92&&phase<3.85){const u=(phase-2.92)/.93;y=.56+2.56*u*u*(3-2*u);state='rising';}
    hammer.position.y=y;rod.position.y=(3.62+y+.44)/2;rod.scale.y=Math.max(.1,3.62-y-.44);proxies[0].y=y;
    const warn=phase>=1.55&&phase<2.92;warningMat.emissiveIntensity=warn?1.0+2.0*Math.pow(Math.sin(t*15),2):.25;warning.scale.setScalar(warn?1.18:1);
    inspect.phase=phase;inspect.hammerY=y;inspect.hammerBottom=y-.34;inspect.warning=warn;inspect.crushing=y<1.1;inspect.state=state;inspect.safeUnder=y>2.35;
  }
  return machineResult('piston',root,proxies,movement,inspect,{label:'BÚA DẬP',radius:3.25,height:5.04,jumpClearance:null,period:4.8,routes:'Pass below while raised (bottom 2.78 m), or circle the hammer at 1.4 < |x| < 2.45 m. Warning 1.55–2.10 s, drop 2.10–2.42 s, down until 2.92 s, raised again at 3.85 s.'});
}

/**
 * Types: grinder | sawGate (alias saw) | piston (alias hammer).
 * Call animate(elapsedSeconds) once per visible frame. Root transforms never change.
 * getColliders(t) ignores args and returns stable, reused last-frame ellipsoid proxies.
 * Root integration should pad proxies only by the actual swept board/player hull.
 * Narrow tooth spacing is represented by the rotor's outer envelope; do not add a
 * large overall machine sphere. Skip overhead parts only if testing board alone;
 * otherwise test head/torso capsules as well for truthful rail/hammer clearance.
 * Shared standard materials are cached. Piston warning lens material is per-instance.
 */
export function createMachine(type){switch(type){case 'grinder':return grinder();case 'saw':case 'sawGate':return sawGate();case 'hammer':case 'piston':return piston();default:throw new Error(`Unknown machine: ${type}`);}}
