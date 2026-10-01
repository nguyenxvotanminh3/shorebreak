import * as THREE from './vendor/three.module.js';
// A shaped travelling swell plus directional wind waves. Collision and rendering
// deliberately use the same heightfield (no un-inverted Gerstner displacement).
export function sampleWater(x,z,t,out={}){
 const p=x*.23+z*.035-t*.72, a=x*.105+z*.18-t*1.18, b=x*.42-z*.31-t*1.83, c=x*.75+z*.64-t*2.5;
 out.h=2.05*Math.sin(p)+.44*Math.sin(2*p)+.26*Math.sin(a)+.12*Math.sin(b)+.055*Math.sin(c);
 const d=2.05*Math.cos(p)+.88*Math.cos(2*p);
 out.dx=.23*d+.0273*Math.cos(a)+.0504*Math.cos(b)+.04125*Math.cos(c);
 out.dz=.035*d+.0468*Math.cos(a)-.0372*Math.cos(b)+.0352*Math.cos(c);
 out.dt=-.72*d-.3068*Math.cos(a)-.2196*Math.cos(b)-.1375*Math.cos(c);
 out.phase=p;return out;
}
export function createOcean(scene){
 const uniforms={uTime:{value:0},uOrigin:{value:new THREE.Vector2()},uSun:{value:new THREE.Vector3(-.45,.085,-.87).normalize()},uRider:{value:new THREE.Vector3()},uSpeed:{value:0},uDetail:{value:1}};
 const vert=`uniform float uTime; uniform vec2 uOrigin; varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
 void main(){vec3 p=position; p.xz+=uOrigin;
 float w=p.x*.23+p.z*.035-uTime*.72;float a=p.x*.105+p.z*.18-uTime*1.18;float b=p.x*.42-p.z*.31-uTime*1.83;float c=p.x*.75+p.z*.64-uTime*2.5;
 p.y=2.05*sin(w)+.44*sin(2.*w)+.26*sin(a)+.12*sin(b)+.055*sin(c);
 float d=2.05*cos(w)+.88*cos(2.*w);
 float dx=.23*d+.0273*cos(a)+.0504*cos(b)+.04125*cos(c);
 float dz=.035*d+.0468*cos(a)-.0372*cos(b)+.0352*cos(c);
 vNormal=normalize(vec3(-dx,1.,-dz));vCrest=sin(w);vWorld=p;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`;
 const frag=`uniform float uTime;uniform vec3 uSun;uniform vec3 uRider;uniform float uSpeed;uniform float uDetail;varying vec3 vWorld;varying vec3 vNormal;varying float vCrest;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 vec3 sky(vec3 r){float h=max(0.,r.y);vec3 c=mix(vec3(.61,.76,.73),vec3(.17,.39,.52),pow(h,.48));float s=max(dot(r,uSun),0.);return c+vec3(1.,.7,.37)*pow(s,60.)*.45;}
 void main(){vec3 v=normalize(cameraPosition-vWorld);float dist=length(cameraPosition-vWorld);float fade=1.-smoothstep(25.,160.,dist);vec3 n=vNormal;
 vec2 q=vWorld.xz;float t=uTime;
 float flow=noise(q*.7+vec2(t*.13,-t*.17))*6.28;
 n.x+=fade*(sin(q.x*2.4+q.y*1.7-t*2.1+flow)*.035+sin(q.x*5.3-q.y*3.8+t*1.7+flow)*.017*uDetail);
 n.z+=fade*(cos(q.x*1.9-q.y*2.8-t*1.8+flow)*.038+cos(q.x*4.7+q.y*3.2-t*2.4+flow)*.015*uDetail);n=normalize(n);
 float facing=clamp(dot(n,v),0.,1.);float fresnel=.02+.98*pow(1.-facing,5.);vec3 reflected=reflect(-v,n);
 float shallow=smoothstep(-1.8,2.6,vWorld.y);vec3 water=mix(vec3(.005,.065,.09),vec3(.012,.24,.185),shallow);
 float sss=pow(max(dot(v,-uSun),0.),4.)*shallow;water+=vec3(.005,.15,.085)*sss;
 vec3 col=mix(water,sky(reflected),fresnel*.72+.045);
 vec3 halfDir=normalize(uSun+v);float spec=max(dot(n,halfDir),0.);col+=vec3(1.,.79,.47)*(pow(spec,190.)*2.8+pow(spec,24.)*.12);
 float crest=smoothstep(.88,.99,vCrest);float f=noise(q*2.2+vec2(t*.25,-t*.16));float cells=noise(q*7.7-t*.2);
 float foam=crest*smoothstep(.49,.78,f)*smoothstep(.25,.64,cells)*.62;
 vec2 wake=q-uRider.xz;float trail=smoothstep(0.,1.,wake.y)*(1.-smoothstep(1.,22.,wake.y));float width=.22+wake.y*.14;float ribbon=exp(-pow(abs(wake.x)/max(width,.1),2.));
 foam=max(foam,trail*ribbon*smoothstep(.34,.7,f+cells*.18)*clamp(uSpeed*.045,0.,.62));
 col=mix(col,vec3(.81,.94,.88),foam);
 float fog=1.-exp(-dist*.0028);col=mix(col,vec3(.53,.71,.71),fog);
 gl_FragColor=vec4(col,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`;
 const mat=new THREE.ShaderMaterial({uniforms,vertexShader:vert,fragmentShader:frag,side:THREE.FrontSide});
 const makeGeometry=n=>{const g=new THREE.PlaneGeometry(2,2,n,n);g.rotateX(-Math.PI/2);const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setXYZ(i,Math.sign(x)*Math.pow(Math.abs(x),1.6)*220,0,Math.sign(z)*Math.pow(Math.abs(z),1.6)*220);}g.computeBoundingSphere();return g;};
 const ocean=new THREE.Mesh(makeGeometry(150),mat);ocean.frustumCulled=false;scene.add(ocean);
 const far=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000),new THREE.MeshBasicMaterial({color:0xd0dedb,fog:false,toneMapped:false}));far.rotation.x=-Math.PI/2;far.position.y=-3;scene.add(far);
 const skyMesh=new THREE.Mesh(new THREE.SphereGeometry(8000,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uSun:uniforms.uSun},vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform vec3 uSun;varying vec3 vDir;void main(){vec3 r=normalize(vDir);float h=max(r.y,0.);vec3 c=mix(vec3(.63,.77,.76),vec3(.20,.43,.60),pow(h,.42));float s=max(dot(r,uSun),0.);c+=vec3(.60,.37,.13)*pow(s,12.)*.45;c+=vec3(1.,.72,.37)*pow(s,180.)*.65;c+=vec3(2.,1.6,1.)*smoothstep(.99965,.99988,s);float cloud=sin(r.x*21.+r.z*5.)*.4+sin(r.x*47.-r.z*23.)*.2;float band=exp(-pow((r.y-.19)*16.,2.));c=mix(c,vec3(.92,.86,.71),smoothstep(.2,.65,cloud)*band*.23);gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`}));skyMesh.renderOrder=-10;scene.add(skyMesh);
 return {uniforms,update(t,x,z,speed){uniforms.uTime.value=t;uniforms.uOrigin.value.set(Math.round(x/2)*2,Math.round(z/2)*2);uniforms.uRider.value.set(x,0,z);uniforms.uSpeed.value=speed;far.position.set(x,-3,z);skyMesh.position.set(x,0,z);},quality(n,detail){const old=ocean.geometry;ocean.geometry=makeGeometry(n);old.dispose();uniforms.uDetail.value=detail;}};
}
