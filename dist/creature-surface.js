import * as THREE from './vendor/three.module.js';

// Small, deterministic textures, shared for the lifetime of the obstacle pool.
// No canvas, downloads, per-frame texture work, or custom shader variants.
const SIZE=128,TAU=Math.PI*2,cache=new Map();
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>v*v*(3-2*v);
const hash=(x,y)=>{const n=Math.sin(x*127.1+y*311.7+19.19)*43758.5453123;return n-Math.floor(n);};
function noise(x,y,period){
 const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy);
 const h=(a,b)=>hash((a%period+period)%period,(b%period+period)%period);
 const a=h(ix,iy)*(1-fx)+h(ix+1,iy)*fx,b=h(ix,iy+1)*(1-fx)+h(ix+1,iy+1)*fx;
 return a*(1-fy)+b*fy;
}
function texture(data,color=false){
 const t=new THREE.DataTexture(data,SIZE,SIZE,THREE.RGBAFormat);
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;
 t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=2;
 if(color)t.colorSpace=THREE.SRGBColorSpace;
 t.needsUpdate=true;return t;
}
function maps(kind){
 const h=new Float32Array(SIZE*SIZE),albedo=new Uint8Array(SIZE*SIZE*4),rough=new Uint8Array(albedo.length),normal=new Uint8Array(albedo.length);
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
  const u=x/SIZE,v=y/SIZE,broad=noise(u*8,v*8,8),grain=noise(u*64,v*64,64);
  let height,pigment;
  if(kind==='reptile'){
   // Offset rows of overlapping, rounded scutes. Grooves break the highlight.
   const row=Math.floor(v*12),cx=((u*12+(row%2)*.5)%1-.5)*2,cy=(v*12%1-.5)*2;
   const scale=Math.pow(clamp(1-cx*cx-Math.pow(cy*.91,2)),.5);
   height=.68*scale+.20*broad+.12*grain;pigment=.77+.19*scale+.04*broad;
  }else if(kind==='mantle'){
   const cell=Math.pow(clamp((grain-.39)*2.5),2);
   height=.2*broad+.24*grain+.24*cell;pigment=.79+.14*broad+.07*grain;
  }else{
   // Fine dermal denticles, deliberately subtler than reptile scales.
   height=.28*grain+.12*broad+.055*Math.sin(u*TAU*32+Math.sin(v*TAU*8));
   pigment=.86+.09*broad+.05*grain;
  }
  const i=y*SIZE+x,o=i*4;h[i]=height;
  albedo[o]=Math.round(255*pigment);albedo[o+1]=Math.round(255*clamp(pigment+(broad-.5)*.026));albedo[o+2]=Math.round(255*clamp(pigment-(broad-.5)*.035));albedo[o+3]=255;
  const r=Math.round(255*(.79+.18*grain));rough[o]=rough[o+1]=rough[o+2]=r;rough[o+3]=255;
 }
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
  const o=(y*SIZE+x)*4,at=(a,b)=>h[((b+SIZE)%SIZE)*SIZE+(a+SIZE)%SIZE];
  let nx=(at(x-1,y)-at(x+1,y))*2.2,ny=(at(x,y-1)-at(x,y+1))*2.2;
  const inv=1/Math.hypot(nx,ny,1);nx*=inv;ny*=inv;
  normal[o]=Math.round((nx*.5+.5)*255);normal[o+1]=Math.round((ny*.5+.5)*255);normal[o+2]=Math.round((inv*.5+.5)*255);normal[o+3]=255;
 }
 return{map:texture(albedo,true),roughnessMap:texture(rough),normalMap:texture(normal)};
}
export function organicMaterial(kind='reptile'){
 if(!cache.has(kind)){
  const strength=kind==='reptile'?.58:kind==='mantle'?.35:.22;
  const material=new THREE.MeshStandardMaterial({vertexColors:true,metalness:0,
   roughness:kind==='denticle'?.74:.91,normalScale:new THREE.Vector2(strength,strength),...maps(kind)});
  material.name=`Organic ${kind}`;material.userData.sharedCreatureMaterial=true;cache.set(kind,material);
 }
 return cache.get(kind);
}
// Broad pigmentation is baked in bind space, so it follows flexing anatomy.
export function organicTint(geometry,upper,lower=upper,yMin=-1,yMax=1,amount=.13){
 const p=geometry.attributes.position,a=new THREE.Color(lower),b=new THREE.Color(upper),data=new Float32Array(p.count*3);
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=smooth(clamp((y-yMin)/(yMax-yMin||1)));
  const mottling=Math.sin(x*7.1+Math.sin(z*3.2)+y*2.4)*Math.sin(z*5.3-y*3.9+x*.7);
  const fleck=Math.sin(x*27.4+y*18.3)*Math.sin(z*24.7-x*6.4);
  const shade=1+amount*(mottling+.22*fleck)-amount*.18;
  data[i*3]=clamp((a.r+(b.r-a.r)*f)*shade);
  data[i*3+1]=clamp((a.g+(b.g-a.g)*f)*(shade+amount*mottling*.07));
  data[i*3+2]=clamp((a.b+(b.b-a.b)*f)*(shade-amount*mottling*.08));
 }
 geometry.setAttribute('color',new THREE.BufferAttribute(data,3));
 if(!geometry.attributes.uv){
  const uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)*.8;uv[i*2+1]=(p.getY(i)+p.getZ(i))*.8;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 }
 return geometry;
}
// Static irregularity is tiny relative to gameplay proxies, but catches grazing light.
export function sculptSurface(g,amount=.015){
 const p=g.attributes.position,n=g.attributes.normal;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),d=amount*Math.sin(x*12.3+y*5.7+z*4.1)*Math.sin(y*14.2-z*8.9+x*2.7);
  p.setXYZ(i,x+n.getX(i)*d,y+n.getY(i)*d,z+n.getZ(i)*d);
 }
 g.computeVertexNormals();return g;
}

// Duplicated UV seam vertices must share a lighting normal on closed loft rings.
export function smoothRingSeam(g,sides){
 const n=g.attributes.normal;
 for(let first=0;first<n.count;first+=sides+1){const last=first+sides;
  const x=n.getX(first)+n.getX(last),y=n.getY(first)+n.getY(last),z=n.getZ(first)+n.getZ(last),inv=1/(Math.hypot(x,y,z)||1);
  n.setXYZ(first,x*inv,y*inv,z*inv);n.setXYZ(last,x*inv,y*inv,z*inv);
 }
 return g;
}
