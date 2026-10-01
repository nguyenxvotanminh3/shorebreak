import * as THREE from './vendor/three.module.js';
import {createOcean,sampleWater} from './water.js';
import {createSurfer} from './surfer.js';
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
const isTouch=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>1||innerWidth<700;
if(isTouch)document.body.classList.add('touch');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('ocean'),antialias:false,alpha:false,powerPreference:'high-performance'});}catch(e){$('loading').hidden=true;$('error').hidden=false;throw e;}
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x91b5b7,.0035);
const worldUp=new THREE.Vector3(0,1,0);
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.15,12000);
scene.add(new THREE.HemisphereLight(0xe3f6fc,0x356b69,2.5));const sun=new THREE.DirectionalLight(0xffdda6,3.4);sun.position.set(-40,55,-65);scene.add(sun);
const ocean=createOcean(scene),surfer=createSurfer(scene),sample={},normal=new THREE.Vector3(),forward=new THREE.Vector3(),right=new THREE.Vector3(),basis=new THREE.Matrix4(),orient=new THREE.Quaternion(),leanQ=new THREE.Quaternion(),zAxis=new THREE.Vector3(0,0,1),cameraTarget=new THREE.Vector3(),lookTarget=new THREE.Vector3(),lookNow=new THREE.Vector3();
// Distant volcanic headlands are actual low-poly geometry, kept to a few draw calls.
const islands=new THREE.Group();scene.add(islands);
const islandMat=new THREE.MeshStandardMaterial({color:0x365d5b,roughness:1,flatShading:true});
for(let i=0;i<7;i++){const g=new THREE.IcosahedronGeometry(1,2);const p=g.attributes.position;for(let j=0;j<p.count;j++){const y=p.getY(j);p.setY(j,Math.max(-.2,y)*(1+.12*Math.sin(p.getX(j)*12)));}g.computeVertexNormals();const m=new THREE.Mesh(g,islandMat);m.position.set(-230+i*29,-3,-290-i*16);m.scale.set(45+i*2,18+Math.sin(i*2)*12,25);islands.add(m);}
const farIsland=new THREE.Mesh(new THREE.ConeGeometry(70,34,15),islandMat);farIsland.position.set(260,-1,-420);farIsland.scale.z=.32;islands.add(farIsland);
const birdGeo=new THREE.BufferGeometry(),birdPos=new Float32Array(5*12);birdGeo.setAttribute('position',new THREE.BufferAttribute(birdPos,3));const birds=new THREE.LineSegments(birdGeo,new THREE.LineBasicMaterial({color:0x36535b,transparent:true,opacity:.65}));scene.add(birds);
// One pooled point cloud, no per-particle objects or allocations in the frame loop.
const particleCount=isTouch?150:260,positions=new Float32Array(particleCount*3),life=new Float32Array(particleCount),velocity=new Float32Array(particleCount*3);let particleCursor=0;
const particleGeo=new THREE.BufferGeometry();particleGeo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));particleGeo.setAttribute('aLife',new THREE.BufferAttribute(life,1).setUsage(THREE.DynamicDrawUsage));
const particleMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uScale:{value:1}},vertexShader:`attribute float aLife;varying float vLife;uniform float uScale;void main(){vLife=aLife;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(16.,(3.+aLife*12.)*uScale/max(1.,-mv.z)*10.);gl_Position=projectionMatrix*mv;}`,fragmentShader:`varying float vLife;void main(){float d=length(gl_PointCoord-.5);float a=(1.-smoothstep(.12,.5,d))*max(0.,vLife)*.55;gl_FragColor=vec4(.86,.97,.95,a);}`});
const spray=new THREE.Points(particleGeo,particleMat);spray.frustumCulled=false;scene.add(spray);
function emitSpray(x,y,z,count,power=1){for(let i=0;i<count;i++){const n=particleCursor++%particleCount,j=n*3;positions[j]=x+(Math.random()-.5)*.6;positions[j+1]=y+.12;positions[j+2]=z+(Math.random()-.5)*.7;velocity[j]=(Math.random()-.5)*5*power;velocity[j+1]=(1.1+Math.random()*2.7)*power;velocity[j+2]=3+Math.random()*4;life[n]=.55+Math.random()*.45;}}
const controls={left:false,right:false,pump:false,jump:false,brake:false};
const state={status:'menu',mode:'session',time:0,oceanTime:13,x:0,z:0,offset:0,speed:8,lean:0,steer:0,charge:0,air:false,airY:0,vy:0,airTime:0,wipe:0,score:0,combo:1,comboTime:0,maxCombo:1,maxSpeed:0,landings:0,carve:0,carveDirection:0,lastCarve:0,launchWasLip:false,edgeTime:0,trickTime:0,quality:'auto',tier:1,fps:60};
let wasJump=false,accumulator=0,lastTime=0,hudTime=0,measureTime=0,measureFrames=0,slowTime=0,fastTime=0,pausedByDialog=false,frameCount=0,renderScale=1;
let best=0;try{best=Number(localStorage.getItem('shorebreak-best')||0);const q=localStorage.getItem('shorebreak-quality');if(['auto','low','medium','high'].includes(q))state.quality=q;}catch{}
const tiers=[{name:'TIẾT KIỆM',pixels:750000,dpr:1,segments:90,detail:0},{name:'CÂN BẰNG',pixels:1400000,dpr:1.3,segments:130,detail:.6},{name:'CAO',pixels:2300000,dpr:1.6,segments:180,detail:1}];
function setQuality(q,initial=false){state.quality=q;$('quality').value=q;const tier=q==='high'?2:q==='medium'?1:q==='low'?0:(isTouch?0:1);applyTier(tier,initial);try{localStorage.setItem('shorebreak-quality',q);}catch{}}
function applyTier(tier,initial=false){state.tier=tier;const cfg=tiers[tier];ocean.quality(cfg.segments,cfg.detail);resize();$('quality-badge').innerHTML=(state.quality==='auto'?'AUTO':cfg.name)+' <span>◌</span>';slowTime=fastTime=0;}
function resize(){const cfg=tiers[state.tier];renderScale=Math.min(devicePixelRatio||1,cfg.dpr,Math.sqrt(cfg.pixels/(innerWidth*innerHeight)));renderer.setPixelRatio(renderScale);renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();particleMat.uniforms.uScale.value=renderScale;}
window.addEventListener('resize',resize);setQuality(state.quality,true);
let audioCtx,audioGain,windFilter,windGain,noiseBuffer,soundEnabled=false;
function initAudio(){if(audioCtx)return;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;audioCtx=new Ctx();audioGain=audioCtx.createGain();audioGain.gain.value=.45;audioGain.connect(audioCtx.destination);noiseBuffer=audioCtx.createBuffer(1,audioCtx.sampleRate*3,audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);let last=0;for(let i=0;i<data.length;i++){last=(last+.025*(Math.random()*2-1))/1.025;data[i]=last*5;}const source=audioCtx.createBufferSource();source.buffer=noiseBuffer;source.loop=true;windFilter=audioCtx.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=700;windGain=audioCtx.createGain();windGain.gain.value=0;source.connect(windFilter);windFilter.connect(windGain);windGain.connect(audioGain);source.start();}
function setSound(on){soundEnabled=on;initAudio();if(on)audioCtx?.resume();$('sound').classList.toggle('muted',!on);$('sound').setAttribute('aria-label',on?'Tắt âm thanh':'Bật âm thanh');$('sound-icon').textContent=on?'♫':'♪';}
$('sound').classList.add('muted');
function splashSound(){if(!soundEnabled||!audioCtx)return;const s=audioCtx.createBufferSource(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();s.buffer=noiseBuffer;f.type='highpass';f.frequency.value=650;s.connect(f);f.connect(g);g.connect(audioGain);g.gain.setValueAtTime(.9,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.01,audioCtx.currentTime+.6);s.start();s.stop(audioCtx.currentTime+.65);}
function clearInputs(){for(const k in controls)controls[k]=false;wasJump=false;state.charge=0;document.querySelectorAll('[data-input]').forEach(b=>b.classList.remove('held'));}
function showTrick(title,sub){$('trick').innerHTML=title+'<small>'+sub+'</small>';$('trick').classList.add('active');state.trickTime=2.2;}
function reward(base,title,sub){state.combo=Math.min(8,state.combo+1);state.maxCombo=Math.max(state.maxCombo,state.combo);state.comboTime=6;const amount=Math.round(base*state.combo);state.score+=amount;showTrick(title,`+${amount} · ${sub}`);}
function startGame(){document.activeElement?.blur();document.querySelectorAll('dialog[open]').forEach(d=>d.close());clearInputs();Object.assign(state,{status:'playing',time:0,z:0,offset:0,speed:8,lean:0,steer:0,air:false,airY:0,vy:0,airTime:0,wipe:0,score:0,combo:1,comboTime:0,maxCombo:1,maxSpeed:0,landings:0,carve:0,carveDirection:0,lastCarve:0,launchWasLip:false,edgeTime:0,trickTime:0});life.fill(0);$('welcome').hidden=true;$('welcome-footer').hidden=true;$('wave-note').hidden=true;$('hud').hidden=false;$('touch-controls').hidden=!isTouch;document.body.classList.add('playing');$('mode-label').textContent=state.mode==='free'?'LƯỚT TỰ DO':'PHIÊN LƯỚT';$('trick').classList.remove('active');showTrick('Tìm nhịp của sóng','NGHIÊNG VÁN · XUỐNG SÓNG ĐỂ LẤY ĐÀ');initAudio();if(soundEnabled)audioCtx?.resume();updateHUD();}
function goHome(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.status='menu';clearInputs();$('welcome').hidden=false;$('welcome-footer').hidden=false;$('wave-note').hidden=false;$('hud').hidden=true;$('touch-controls').hidden=true;document.body.classList.remove('playing');}
function pause(){if(state.status!=='playing')return;state.status='paused';clearInputs();$('pause-dialog').showModal();}
function resume(){if(state.status!=='paused')return;state.status='playing';$('pause-dialog').close();document.activeElement?.blur();clearInputs();lastTime=performance.now();accumulator=0;}
function finish(){state.status='finished';clearInputs();best=Math.max(best,Math.round(state.score));try{localStorage.setItem('shorebreak-best',String(best));}catch{}$('result-score').textContent=Math.round(state.score).toLocaleString('vi-VN');$('result-speed').textContent=Math.round(state.maxSpeed*3.6);$('result-air').textContent=state.landings;$('result-combo').textContent='×'+state.maxCombo;$('best-score').textContent='Kỷ lục trên thiết bị này: '+best.toLocaleString('vi-VN');$('result-title').textContent=state.score>6000?'Bạn và sóng, cùng một nhịp.':'Mỗi con sóng, một khởi đầu.';$('result-dialog').showModal();}
function openDialog(id){if(state.status==='playing'){state.status='paused';clearInputs();pausedByDialog=true;}$(id).showModal();}
$('start').onclick=startGame;$('again').onclick=startGame;$('restart').onclick=startGame;$('resume').onclick=resume;$('home').onclick=goHome;$('result-home').onclick=goHome;
document.querySelector('.brand').onclick=e=>{e.preventDefault();if(state.status==='playing')pause();else if(state.status!=='menu')goHome();};
$('pause').onclick=pause;$('how-open').onclick=()=>openDialog('help-dialog');$('settings-open').onclick=()=>openDialog('settings-dialog');$('quality-badge').onclick=()=>openDialog('settings-dialog');$('sound').onclick=()=>setSound(!soundEnabled);$('quality').onchange=e=>setQuality(e.target.value);$('volume').oninput=e=>{initAudio();if(!soundEnabled)setSound(true);if(audioGain)audioGain.gain.value=Number(e.target.value)/100;};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
for(const id of ['help-dialog','settings-dialog'])$(id).addEventListener('close',()=>{if(pausedByDialog){pausedByDialog=false;state.status='playing';clearInputs();}});
$('pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});$('result-dialog').addEventListener('cancel',e=>{e.preventDefault();goHome();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(m=>{m.classList.toggle('active',m===b);m.setAttribute('aria-pressed',m===b?'true':'false');});});
const keyMap={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyW:'pump',ArrowUp:'pump',Space:'jump',KeyS:'brake',ArrowDown:'brake'};
window.addEventListener('keydown',e=>{if(e.target.matches?.('input,select')&&e.code!=='Escape')return;if((e.code==='Escape'||e.code==='KeyP')&&!e.repeat){if(document.querySelector('dialog[open]')&& !$('pause-dialog').open)return;e.preventDefault();if(state.status==='playing')pause();else if(state.status==='paused'&&$('pause-dialog').open)resume();return;}if(state.status==='playing'&&keyMap[e.code]){controls[keyMap[e.code]]=true;e.preventDefault();}});
window.addEventListener('keyup',e=>{if(keyMap[e.code]){controls[keyMap[e.code]]=false;if(state.status==='playing')e.preventDefault();}});
for(const button of document.querySelectorAll('[data-input]')){button.addEventListener('pointerdown',e=>{e.preventDefault();if(state.status!=='playing')return;button.setPointerCapture(e.pointerId);controls[button.dataset.input]=true;button.classList.add('held');});const release=()=>{controls[button.dataset.input]=false;button.classList.remove('held');};button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);}
window.addEventListener('blur',()=>{if(state.status==='playing')pause();clearInputs();});document.addEventListener('visibilitychange',()=>{if(document.hidden){if(state.status==='playing')pause();clearInputs();audioCtx?.suspend();}else{lastTime=performance.now();accumulator=0;if(soundEnabled)audioCtx?.resume();}});
function wipeout(){state.wipe=1.8;state.air=false;state.speed=4;state.combo=1;state.comboTime=0;state.edgeTime=0;state.charge=0;state.carve=0;state.carveDirection=0;state.lastCarve=0;emitSpray(state.x,sample.h,state.z,55,2);splashSound();showTrick('Lại một con sóng','THẢ HƯỚNG TRƯỚC KHI TIẾP NƯỚC');}
function step(dt){
 if(state.status==='paused'||state.status==='finished')return;
 state.oceanTime+=dt;
 if(state.status==='menu'){state.z-=dt*2.8;state.offset=Math.sin(state.oceanTime*.18)*1.1;state.speed=6;state.steer=Math.sin(state.oceanTime*.4)*.17;state.lean=lerp(state.lean,state.steer,.05);}
 else {
  state.time+=dt;if(state.mode==='session'&&state.time>=90){finish();return;}
  if(state.trickTime>0){state.trickTime-=dt;if(state.trickTime<=0)$('trick').classList.remove('active');}
  if(state.comboTime>0){state.comboTime-=dt;if(state.comboTime<=0)state.combo=1;}
  const input=(controls.right?1:0)-(controls.left?1:0);state.steer=lerp(state.steer,input,1-Math.exp(-7*dt));state.lean=lerp(state.lean,state.steer,1-Math.exp(-6*dt));
  if(state.wipe>0){state.wipe-=dt;state.offset=lerp(state.offset,0,dt*2.5);state.lean*=.97;state.z-=state.speed*dt;if(state.wipe<=0){state.speed=7;showTrick('Trở lại đường lướt','HÃY CARVE THÀNH ĐƯỜNG CHỮ S');}}
  else {
   const phase=.4+state.offset*.23,gradient=.23*(2.05*Math.cos(phase)+.88*Math.cos(2*phase));
   const lateral=state.steer*state.speed*.55;state.offset+=lateral*dt;state.offset=clamp(state.offset,-15,15);
   const downhill=-gradient*lateral;const pocket=Math.exp(-Math.pow((phase-.55)/1.4,2));
   let acceleration=1.6+pocket*1.2-state.speed*state.speed*.032+downhill*.34-Math.abs(state.steer)*.14;
   if(controls.pump&&!state.air&&downhill>.35)acceleration+=Math.min(2.8,downhill*.9)*( .7+.3*Math.sin(state.time*7));
   if(controls.brake)acceleration-=3.5;
   if(!state.air)state.speed=clamp(state.speed+acceleration*dt,4.1,16.5);state.z-=state.speed*dt;
   if(Math.abs(state.offset)>12.5)state.edgeTime+=dt;else state.edgeTime=Math.max(0,state.edgeTime-dt*2);
   if(state.edgeTime>2.8)wipeout();
   if(!state.air){state.score+=(8+state.speed*1.2)*pocket*state.combo*dt;
    if(Math.abs(state.steer)>.4&&pocket>.25){const sign=Math.sign(state.steer);if(sign!==state.carveDirection){state.carve=0;state.carveDirection=sign;}state.carve+=Math.abs(lateral)*dt;if(state.carve>4.7&&sign!==state.lastCarve){reward(90,state.lastCarve===0?'Carving':'Cutback','ĐƯỜNG LƯỚT MƯỢT');state.carve=0;state.lastCarve=sign;}}
   }
   if(controls.jump&&!state.air)state.charge=Math.min(1,state.charge+dt*1.15);
   if(!controls.jump&&wasJump&&!state.air&&state.charge>.12){const lip=Math.sin(phase)>.65&&state.speed>6.2;state.launchWasLip=lip;state.air=true;state.airTime=0;state.airY=sample.h+.17;state.vy=lip?4.7+state.charge*2.5:2.1+state.charge*1.6;state.charge=0;if(lip)showTrick('Rời mặt sóng','THẢ HƯỚNG · CĂN VÁN KHI TIẾP NƯỚC');emitSpray(state.x,sample.h,state.z,18,1.3);}
   if(!controls.jump&&!wasJump)state.charge=Math.max(0,state.charge-dt*3);
   wasJump=controls.jump;
  }
  state.maxSpeed=Math.max(state.maxSpeed,state.speed);
 }
 state.x=(state.oceanTime*.72-state.z*.035+.4)/.23+state.offset;
 sampleWater(state.x,state.z,state.oceanTime,sample);
 if(state.air){state.airTime+=dt;state.vy-=9.81*dt;state.airY+=state.vy*dt;if(state.airY<=sample.h+.17&&state.airTime>.1){state.air=false;emitSpray(state.x,sample.h,state.z,35,1.2);splashSound();if(Math.abs(state.lean)>.8&&state.airTime>.5)wipeout();else{const clean=Math.abs(state.lean)<.34;state.speed*=clean?1:.8;if(state.launchWasLip&&state.airTime>.55){state.landings++;reward(clean?260:100,clean?'Tiếp nước hoàn hảo':'Đã tiếp nước',clean?'GIỮ TRỌN TỐC ĐỘ':'HÃY GIỮ VÁN THẲNG HƠN');}else showTrick('Bật nhẹ','LÊN CAO TRÊN MẶT SÓNG ĐỂ BAY XA HƠN');}}}
 if(state.status==='playing'&&!state.air&&state.wipe<=0&&Math.random()<.78)emitSpray(state.x-state.lean*.35,sample.h,state.z+.9,2, .6+Math.abs(state.lean)*.7);
 for(let i=0;i<particleCount;i++){if(life[i]<=0)continue;const j=i*3;life[i]-=dt*.85;positions[j]+=velocity[j]*dt;positions[j+1]+=velocity[j+1]*dt;positions[j+2]+=velocity[j+2]*dt;velocity[j+1]-=5.5*dt;}
 particleGeo.attributes.position.needsUpdate=true;particleGeo.attributes.aLife.needsUpdate=true;
}
function updateVisual(dt){
 ocean.update(state.oceanTime,state.x,state.z,state.wipe>0?0:state.speed);
 surfer.rig.position.set(state.x,state.air?state.airY:sample.h+.15,state.z);
 const yaw=-state.steer*.55;normal.set(-sample.dx,1,-sample.dz).normalize();if(state.air)normal.lerp(worldUp,.75).normalize();
 forward.set(Math.sin(yaw),0,Math.cos(yaw));right.crossVectors(normal,forward).normalize();forward.crossVectors(right,normal).normalize();basis.makeBasis(right,normal,forward);orient.setFromRotationMatrix(basis);leanQ.setFromAxisAngle(zAxis,-state.lean*.38);orient.multiply(leanQ);surfer.rig.quaternion.slerp(orient,1-Math.exp(-dt*11));
 if(state.wipe>0){surfer.rig.position.y-=.6;surfer.rig.rotateZ(Math.sin(state.wipe*5)*1.2);}
 surfer.pose(state.lean,state.charge+(controls.pump?.15:0),state.air?1:0,state.oceanTime);
 const menu=state.status==='menu',mobile=innerWidth<600;
 if(menu){cameraTarget.set(state.x+(mobile?8:12),8.8,state.z+17);lookTarget.set(state.x-(mobile?3:5),1.4,state.z-10);}
 else {cameraTarget.set(state.x+state.lean*.65,7.1+state.speed*.04,state.z+12+state.speed*.1);lookTarget.set(state.x+state.steer*1.6,1.2,state.z-10);}
 camera.position.lerp(cameraTarget,1-Math.exp(-dt*(menu?1.8:3.8)));lookNow.lerp(lookTarget,1-Math.exp(-dt*4));camera.lookAt(lookNow);
 camera.fov=lerp(camera.fov,menu?52:52+(state.speed-7)*.75,dt*2);camera.updateProjectionMatrix();
 islands.position.set(state.x*.88,0,state.z*.93);
 for(let i=0;i<5;i++){const x=state.x-55+i*9+Math.sin(state.oceanTime*.15+i)*6,y=20+i*1.9,z=state.z-90-i*9,wing=Math.sin(state.oceanTime*3.5+i)*.55;const j=i*12;birdPos[j]=x-1.1;birdPos[j+1]=y+wing;birdPos[j+2]=z;birdPos[j+3]=x;birdPos[j+4]=y;birdPos[j+5]=z+.3;birdPos[j+6]=x;birdPos[j+7]=y;birdPos[j+8]=z+.3;birdPos[j+9]=x+1.1;birdPos[j+10]=y+wing;birdPos[j+11]=z;}birdGeo.attributes.position.needsUpdate=true;
 if(audioCtx&&windGain){const active=soundEnabled&&!document.hidden&&state.status!=='paused';windGain.gain.setTargetAtTime(active?.22+state.speed*.025:0,audioCtx.currentTime,.4);windFilter.frequency.setTargetAtTime(450+state.speed*55,audioCtx.currentTime,.3);}
}
function updateHUD(){
 $('score').textContent=String(Math.floor(state.score)).padStart(4,'0');$('combo').innerHTML='×'+state.combo+' <span>NHỊP SÓNG</span>';
 const sec=Math.max(0,Math.ceil(90-state.time));$('timer').textContent=state.mode==='free'?'∞':Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');$('speed').innerHTML=Math.round(state.speed*3.6)+'<small>km/h</small>';$('speed-bar').style.width=clamp(state.speed/16.5*100,0,100)+'%';
 const p=.4+state.offset*.23;const height=(Math.sin(p)+1)*.5;$('wave-marker').style.left=clamp(height*100,2,98)+'%';$('zone-label').textContent=state.air?'TRÊN KHÔNG':state.edgeTime>0?'TRỞ VỀ MẶT SÓNG':Math.sin(p)>.65?'GẦN ĐỈNH · BẬT SÓNG':'VÙNG LẤY ĐÀ';
 $('charge').classList.toggle('active',state.charge>.02);$('charge-bar').style.width=state.charge*100+'%';$('perf-info').textContent=Math.round(state.fps)+' FPS · '+tiers[state.tier].name+' · '+renderer.domElement.width+' × '+renderer.domElement.height;
}
function frame(now){requestAnimationFrame(frame);if(document.hidden){lastTime=now;return;}const rawDt=lastTime?(now-lastTime)/1000:1/60;lastTime=now;const dt=Math.min(rawDt,.08);accumulator+=dt;let steps=0;while(accumulator>=1/60&&steps<5){step(1/60);accumulator-=1/60;steps++;}if(steps===5)accumulator=0;updateVisual(dt);renderer.render(scene,camera);frameCount++;hudTime+=dt;if(hudTime>.1){updateHUD();hudTime=0;}
 measureTime+=rawDt;measureFrames++;if(measureTime>=2){state.fps=measureFrames/measureTime;if(state.quality==='auto'&&state.status==='playing'){if(state.fps<43){slowTime+=measureTime;fastTime=0;}else if(state.fps>57){fastTime+=measureTime;slowTime=0;}else{slowTime=fastTime=0;}if(slowTime>=4&&state.tier>0)applyTier(state.tier-1);else if(fastTime>=14&&state.tier<(isTouch?1:2))applyTier(state.tier+1);}measureTime=0;measureFrames=0;}
}
// Small read-only instrumentation allows reproducible performance and state checks.
window.__SURF__={getState:()=>({...state,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,renderWidth:renderer.domElement.width,renderHeight:renderer.domElement.height,frames:frameCount}),sampleWater:(x,z,t)=>sampleWater(x,z,t),version:'1.0.0'};
try{const context=document.modelContext;if(context?.registerTool){const lifeCycle=new AbortController();const register=tool=>Promise.resolve(context.registerTool(tool,{signal:lifeCycle.signal})).catch(()=>{});register({name:'read_surf_session',description:'Read the current surfing session score, speed and status.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(input&&Object.keys(input).length)throw new Error('No parameters accepted.');return {status:state.status,mode:state.mode,score:Math.floor(state.score),speedKmh:Math.round(state.speed*3.6),remainingSeconds:state.mode==='session'?Math.max(0,90-state.time):null};}});register({name:'start_surf_session',description:'Start a new surfing session. Replaces the current run.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['session','free']}},required:['mode'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!['session','free'].includes(input.mode)||Object.keys(input).some(k=>k!=='mode'))throw new Error('mode must be session or free');state.mode=input.mode;startGame();return {status:state.status,mode:state.mode};}});window.addEventListener('pagehide',()=>lifeCycle.abort(),{once:true});}}catch{}
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();$('error-text').textContent='Trình duyệt vừa ngắt đồ họa. Tải lại để trở về biển; kỷ lục của bạn vẫn được giữ.';$('error').hidden=false;});
step(1/60);camera.position.set(state.x+12,8.8,state.z+17);lookNow.set(state.x-5,1.4,state.z-10);updateVisual(1);renderer.compile(scene,camera);renderer.render(scene,camera);$('loading').style.opacity='0';setTimeout(()=>$('loading').hidden=true,500);requestAnimationFrame(frame);
