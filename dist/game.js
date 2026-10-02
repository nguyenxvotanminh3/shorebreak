import * as THREE from './vendor/three.module.js';
import {createOcean,sampleWater} from './water.js';
import {createSurfer} from './surfer.js?v=4';
import {FIXED_DT,resetPhysics,advancePhysics,beginWipeout} from './physics.js?v=4';
import {createGauntlet} from './gauntlet.js?v=4';
import {createCrashFX} from './crash-fx.js?v=4';
import {createAura} from './aura.js?v=4';
import {createSeascape} from './seascape.js?v=4';
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
const isTouch=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>1||innerWidth<700;
if(isTouch)document.body.classList.add('touch');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('ocean'),antialias:!isTouch,alpha:false,powerPreference:'high-performance'});}catch(e){$('loading').hidden=true;$('error').hidden=false;throw e;}
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x91b5b7,.0035);
const worldUp=new THREE.Vector3(0,1,0);
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.15,12000);
scene.add(new THREE.HemisphereLight(0xe3f6fc,0x356b69,2.5));const sun=new THREE.DirectionalLight(0xffdda6,3.4);sun.position.set(-40,55,-65);scene.add(sun);
const ocean=createOcean(scene),seascape=createSeascape(scene,{sampleWater});
let surfer;try{surfer=await createSurfer(scene);}catch(error){$('loading').hidden=true;$('error').hidden=false;$('error-text').textContent='Không tải được nhân vật 3D. Hãy tải lại trang để trở về biển.';throw error;}
const hazards=createGauntlet(scene),crashFX=createCrashFX(scene,surfer),auraFX=createAura(scene),sample={},normal=new THREE.Vector3(),forward=new THREE.Vector3(),right=new THREE.Vector3(),basis=new THREE.Matrix4(),orient=new THREE.Quaternion(),leanQ=new THREE.Quaternion(),zAxis=new THREE.Vector3(0,0,1),cameraTarget=new THREE.Vector3(),lookTarget=new THREE.Vector3(),lookNow=new THREE.Vector3();
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
const controls={left:false,right:false,pump:false,jump:false,brake:false,aura:false};
const state={status:'menu',mode:'free',time:0,oceanTime:13,x:0,z:0,offset:0,speed:8,lean:0,steer:0,charge:0,air:false,airY:0,vy:0,airTime:0,wipe:0,score:0,combo:1,comboTime:0,maxCombo:1,maxSpeed:0,landings:0,carve:0,carveDirection:0,lastCarve:0,launchWasLip:false,edgeTime:0,trickTime:0,quality:'auto',tier:1,fps:60};
resetPhysics(state);
const renderKeys=['x','y','z','oceanTime','speed','latVel','lean','steer','charge','airTime','airProgress','spinAngle','landingTime','landingImpact','nx','ny','nz','wipe'];
const previous={},renderState={};function capturePrevious(){for(const key of renderKeys)previous[key]=state[key];}capturePrevious();
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
function clearInputs(){for(const k in controls)controls[k]=false;wasJump=false;state.wasJump=false;state.charge=0;document.querySelectorAll('[data-input]').forEach(b=>b.classList.remove('held'));}
function showTrick(title,sub){$('trick').innerHTML=title+'<small>'+sub+'</small>';$('trick').classList.add('active');state.trickTime=2.2;}
function reward(base,title,sub){state.combo=Math.min(8,state.combo+1);state.maxCombo=Math.max(state.maxCombo,state.combo);state.comboTime=6;const amount=Math.round(base*state.combo);state.score+=amount;showTrick(title,`+${amount} · ${sub}`);}
function startGame(){document.activeElement?.blur();document.querySelectorAll('dialog[open]').forEach(d=>d.close());clearInputs();Object.assign(state,{status:'playing',time:0,z:0,offset:0,speed:8,lean:0,steer:0,air:false,airY:0,vy:0,airTime:0,wipe:0,score:0,combo:1,comboTime:0,maxCombo:1,maxSpeed:0,landings:0,carve:0,carveDirection:0,lastCarve:0,launchWasLip:false,edgeTime:0,trickTime:0});resetPhysics(state);crashFX.clear();auraFX.clear();surfer.rig.visible=true;document.body.classList.remove('crashed');capturePrevious();hazards.reset(state);camera.position.set(state.x+1,5.4,state.z+9);lookNow.set(state.x,1.6,state.z-5);life.fill(0);$('welcome').hidden=true;$('welcome-footer').hidden=true;$('wave-note').hidden=true;$('hud').hidden=false;$('touch-controls').hidden=!isTouch;document.body.classList.add('playing');$('mode-label').textContent='ĐƯỜNG ĐUA VÔ TẬN';$('trick').classList.remove('active');showTrick('SURF. DODGE. SPLAT.',isTouch?'NÉ TRÁI / PHẢI · BẬT SÓNG · GIỮ AURA KHI BAY':'A / D: NÉ · SPACE: NHẢY · GIỮ E TRÊN KHÔNG: AURA');initAudio();if(soundEnabled)audioCtx?.resume();updateHUD();}
function goHome(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.status='menu';crashFX.clear();auraFX.clear();surfer.rig.visible=true;document.body.classList.remove('crashed');clearInputs();$('welcome').hidden=false;$('welcome-footer').hidden=false;$('wave-note').hidden=false;$('hud').hidden=true;$('touch-controls').hidden=true;document.body.classList.remove('playing');}
function pause(){if(state.status!=='playing')return;state.status='paused';clearInputs();$('pause-dialog').showModal();}
function resume(){if(state.status!=='paused')return;state.status='playing';$('pause-dialog').close();document.activeElement?.blur();clearInputs();lastTime=performance.now();accumulator=0;}
function finish(){state.status='finished';clearInputs();best=Math.max(best,Math.round(state.score));try{localStorage.setItem('shorebreak-best',String(best));}catch{}$('result-score').textContent=Math.round(state.score).toLocaleString('vi-VN');$('result-speed').textContent=Math.round(state.maxSpeed*3.6);$('result-air').textContent=state.landings;$('result-combo').textContent='×'+state.maxCombo;$('result-dodged').textContent=state.obstaclesDodged;$('result-height').textContent=state.maxAir.toFixed(1)+' m';$('best-score').textContent='Kỷ lục trên thiết bị này: '+best.toLocaleString('vi-VN');$('result-title').textContent='Đi được '+Math.round(-state.z)+' m. Vẫn còn sóng!';$('result-crashes').textContent=state.crashes;$('result-aura').textContent=state.auraClears;$('result-dialog').showModal();}
function openDialog(id){if(state.status==='playing'){state.status='paused';clearInputs();pausedByDialog=true;}$(id).showModal();}
$('end-run').onclick=()=>{$('pause-dialog').close();finish();};$('start').onclick=startGame;$('again').onclick=startGame;$('restart').onclick=startGame;$('resume').onclick=resume;$('home').onclick=goHome;$('result-home').onclick=goHome;
document.querySelector('.brand').onclick=e=>{e.preventDefault();if(state.status==='playing')pause();else if(state.status!=='menu')goHome();};
$('pause').onclick=pause;$('how-open').onclick=()=>openDialog('help-dialog');$('settings-open').onclick=()=>openDialog('settings-dialog');$('quality-badge').onclick=()=>openDialog('settings-dialog');$('sound').onclick=()=>setSound(!soundEnabled);$('quality').onchange=e=>setQuality(e.target.value);$('volume').oninput=e=>{initAudio();if(!soundEnabled)setSound(true);if(audioGain)audioGain.gain.value=Number(e.target.value)/100;};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
for(const id of ['help-dialog','settings-dialog'])$(id).addEventListener('close',()=>{if(pausedByDialog){pausedByDialog=false;state.status='playing';clearInputs();}});
$('pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});$('result-dialog').addEventListener('cancel',e=>{e.preventDefault();goHome();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(m=>{m.classList.toggle('active',m===b);m.setAttribute('aria-pressed',m===b?'true':'false');});});
const keyMap={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyW:'pump',ArrowUp:'pump',Space:'jump',KeyE:'aura',KeyS:'brake',ArrowDown:'brake'};
window.addEventListener('keydown',e=>{if(e.target.matches?.('input,select')&&e.code!=='Escape')return;if((e.code==='Escape'||e.code==='KeyP')&&!e.repeat){if(document.querySelector('dialog[open]')&& !$('pause-dialog').open)return;e.preventDefault();if(state.status==='playing')pause();else if(state.status==='paused'&&$('pause-dialog').open)resume();return;}if(state.status==='playing'&&keyMap[e.code]){controls[keyMap[e.code]]=true;e.preventDefault();}});
window.addEventListener('keyup',e=>{if(keyMap[e.code]){controls[keyMap[e.code]]=false;if(state.status==='playing')e.preventDefault();}});
for(const button of document.querySelectorAll('[data-input]')){button.addEventListener('pointerdown',e=>{e.preventDefault();if(state.status!=='playing')return;button.setPointerCapture(e.pointerId);controls[button.dataset.input]=true;button.classList.add('held');});const release=()=>{controls[button.dataset.input]=false;button.classList.remove('held');};button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);}
window.addEventListener('blur',()=>{if(state.status==='playing')pause();clearInputs();});document.addEventListener('visibilitychange',()=>{if(document.hidden){if(state.status==='playing')pause();clearInputs();audioCtx?.suspend();}else{lastTime=performance.now();accumulator=0;if(soundEnabled)audioCtx?.resume();}});
function handlePhysicsEvent(type,data={}){
 if(type==='launch'){emitSpray(state.x,state.y-.15,state.z,24,1.5);showTrick(data.spin?'Air reverse 360°':'Frontside air',data.lip?'KÉO GỐI · GIỮ RAIL · THẢ HƯỚNG ĐỂ ĐÁP':'LẤY THÊM ĐÀ Ở ĐỈNH SÓNG ĐỂ BAY CAO');}
 if(type==='landing'){emitSpray(state.x,state.y-.15,state.z,42,1.2+data.impact*.03);splashSound();if(data.lip){state.landings++;reward(data.spin?420:data.clean?280:120,data.clean?(data.spin?'360° hoàn hảo':'Tiếp nước hoàn hảo'):'Đã tiếp nước',data.height.toFixed(1)+' m · '+(data.clean?'HẤP THỤ LỰC BẰNG GỐI':'GIỮ THẲNG VÁN KHI ĐÁP'));}else showTrick('Bật sóng',data.height.toFixed(1)+' m · LÊN MẶT SÓNG ĐỂ THÊM ĐỘ CAO');}
 if(type==='carve')reward(data.cutback?120:90,data.cutback?'Cutback':'Bottom turn','ĐỔI HƯỚNG · GIỮ ĐÀ');
 if(type==='wipeout'||type==='obstacle-hit'){
  const vx=(.72+.035*state.speed)/.23+state.latVel,vz=-state.speed;
  if(type==='obstacle-hit')beginWipeout(state,crashFX.duration);state.crashes++;
  crashFX.burst({x:state.x,y:state.y,z:state.z,vx,vz,force:type==='obstacle-hit'?1.25:.85,type:data.type,time:state.oceanTime});surfer.rig.visible=false;state.auraActive=false;document.body.classList.add('crashed');
  emitSpray(state.x,state.y,state.z,65,2);splashSound();showTrick(['ỐI GIỜI ƠI!','XAY NHUYỄN!','BAY MÀU!'][state.crashes%3],(data.name||'MẤT THĂNG BẰNG')+' · HỒI SINH TRONG 2 GIÂY');
 }
 if(type==='recover'){crashFX.clear();document.body.classList.remove('crashed');showTrick('Còn thở là còn lướt!','BẤT TỬ TẠM THỜI · CHUẨN BỊ NÉ TIẾP');}
 if(type==='obstacle-clear'){const points=data.air?240:data.near?160:100;state.score+=points*state.combo;if(data.aura>.15){const bonus=Math.round(250+data.aura*350)*state.combo;state.score+=bonus;state.auraClears++;showTrick('AURA FARMED ✦','+'+bonus+' AURA · BAY QUA '+data.name);}else if(data.air||data.near)showTrick(data.air?'Bay qua chướng ngại':'Né sát mép','+'+(points*state.combo)+' · '+data.name);}
}
function step(dt){
 if(state.status==='paused'||state.status==='finished')return;
 state.oceanTime+=dt;
 if(state.status==='menu'){
  state.z-=dt*3.4;state.offset=Math.sin(state.oceanTime*.2)*1.2;state.speed=7;state.steer=Math.sin(state.oceanTime*.4)*.16;state.lean=lerp(state.lean,state.steer,1-Math.exp(-5*dt));state.x=(state.oceanTime*.72-state.z*.035+.4)/.23+state.offset;sampleWater(state.x,state.z,state.oceanTime,sample);state.y=sample.h+.14;const n=1/Math.hypot(sample.dx,1,sample.dz);state.nx=-sample.dx*n;state.ny=n;state.nz=-sample.dz*n;
 }else{
  state.time+=dt;
  if(state.trickTime>0){state.trickTime-=dt;if(state.trickTime<=0)$('trick').classList.remove('active');}
  if(state.comboTime>0){state.comboTime-=dt;if(state.comboTime<=0)state.combo=1;}
  advancePhysics(state,controls,dt,handlePhysicsEvent);hazards.step(state,dt,handlePhysicsEvent);crashFX.update(dt,sampleWater,state.oceanTime);
  if(!state.air&&state.wipe<=0&&Math.random()<.38)emitSpray(state.x-state.lean*.3,state.y-.12,state.z+.65,2,.65+Math.abs(state.lean)*.7);
 }
 for(let i=0;i<particleCount;i++){if(life[i]<=0)continue;const j=i*3;life[i]-=dt*.85;positions[j]+=velocity[j]*dt;positions[j+1]+=velocity[j+1]*dt;positions[j+2]+=velocity[j+2]*dt;velocity[j+1]-=5.5*dt;}
 particleGeo.attributes.position.needsUpdate=true;particleGeo.attributes.aLife.needsUpdate=true;
}
function updateVisual(dt,alpha=1){
 const v=renderState;for(const key of renderKeys)v[key]=lerp(previous[key]??state[key],state[key],alpha);
 const spinDelta=Math.atan2(Math.sin(state.spinAngle-previous.spinAngle),Math.cos(state.spinAngle-previous.spinAngle));v.spinAngle=previous.spinAngle+spinDelta*alpha;
 v.air=state.air;v.auraActive=state.auraActive;v.auraStyle=state.auraStyle;v.status=state.status;v.pump=controls.pump;v.landingImpact=state.landingImpact;v.acceleration=(state.speed-previous.speed)/FIXED_DT;
 ocean.update(v.oceanTime,v.x,v.z,state.wipe>0?0:v.speed);sampleWater(v.x,v.z,v.oceanTime,sample);
 surfer.rig.position.set(v.x,v.y,v.z);
 normal.set(v.nx,v.ny,v.nz).normalize();if(state.air)normal.lerp(worldUp,.96).normalize();
 const yaw=-Math.atan2(v.latVel,v.speed)+v.spinAngle;forward.set(Math.sin(yaw),0,Math.cos(yaw));right.crossVectors(normal,forward).normalize();forward.crossVectors(right,normal).normalize();basis.makeBasis(right,normal,forward);orient.setFromRotationMatrix(basis);
 const bank=state.air?Math.sin(Math.PI*v.airProgress)*.32:-v.lean*.3;leanQ.setFromAxisAngle(zAxis,bank);orient.multiply(leanQ);
 if(state.air){leanQ.setFromAxisAngle(right.set(1,0,0),Math.cos(Math.PI*v.airProgress)*.32*Math.min(1,v.airTime*8));orient.multiply(leanQ);}
 surfer.rig.quaternion.slerp(orient,1-Math.exp(-dt*16));
 if(state.wipe>0){surfer.rig.position.y-=.35;surfer.rig.rotateZ(Math.sin(state.wipe*5)*.7);}
 surfer.rig.visible=!crashFX.active&&(state.invulnerable<.1||state.wipe>0||Math.sin(v.oceanTime*21)>-.25);surfer.rig.updateMatrixWorld(true);if(!crashFX.active)surfer.pose(v,dt);auraFX.update(v,state.status==='paused'?0:dt);
 const menu=state.status==='menu',mobile=innerWidth<600,airHeight=Math.max(0,v.y-sample.h-.14);
 if(menu){cameraTarget.set(v.x+(mobile?5.5:8),5.8,v.z+10.2);lookTarget.set(v.x-(mobile?1.9:3),1.6,v.z-5);}
 else{cameraTarget.set(v.x+1.1+v.lean*.35,5.4+airHeight*.35,v.z+8.2+v.speed*.04);lookTarget.set(v.x+2.1+v.steer*.55,1.5+airHeight*.60,v.z-9);}
 if(crashFX.active){const c=crashFX.inspect().center;cameraTarget.set(c.x+3.2,c.y+4.2,c.z+9);lookTarget.set(c.x,c.y+.3,c.z);}
 camera.position.lerp(cameraTarget,1-Math.exp(-dt*(menu?2:4.5)));lookNow.lerp(lookTarget,1-Math.exp(-dt*5));camera.lookAt(lookNow);camera.fov=lerp(camera.fov,menu?49:(mobile?61:52)+(v.speed-8)*.40,1-Math.exp(-dt*2.5));camera.updateProjectionMatrix();
 islands.position.set(v.x*.88,0,v.z*.93);seascape.update({x:v.x,z:v.z,time:v.oceanTime},dt);hazards.render(v);
 for(let i=0;i<5;i++){const x=v.x-55+i*9+Math.sin(v.oceanTime*.15+i)*6,y=20+i*1.9,z=v.z-90-i*9,wing=Math.sin(v.oceanTime*3.5+i)*.55;const j=i*12;birdPos[j]=x-1.1;birdPos[j+1]=y+wing;birdPos[j+2]=z;birdPos[j+3]=x;birdPos[j+4]=y;birdPos[j+5]=z+.3;birdPos[j+6]=x;birdPos[j+7]=y;birdPos[j+8]=z+.3;birdPos[j+9]=x+1.1;birdPos[j+10]=y+wing;birdPos[j+11]=z;}birdGeo.attributes.position.needsUpdate=true;
 if(audioCtx&&windGain){const active=soundEnabled&&!document.hidden&&state.status!=='paused';windGain.gain.setTargetAtTime(active?.22+state.speed*.025:0,audioCtx.currentTime,.4);windFilter.frequency.setTargetAtTime(450+state.speed*55,audioCtx.currentTime,.3);}
}
function updateHUD(){
 $('score').textContent=String(Math.floor(state.score)).padStart(4,'0');$('combo').innerHTML='×'+state.combo+' <span>NHỊP SÓNG</span>';
 $('timer').textContent=Math.round(Math.max(0,-state.z)).toLocaleString('vi-VN')+' m';$('run-stats').textContent='✦ '+state.auraClears+' AURA  ·  '+state.crashes+' LẦN TOANG';$('speed').innerHTML=Math.round(state.speed*3.6)+'<small>km/h</small>';$('speed-bar').style.width=clamp(state.speed/16.5*100,0,100)+'%';
 const p=.4+state.offset*.23;const height=(Math.sin(p)+1)*.5;$('wave-marker').style.left=clamp(height*100,2,98)+'%';$('zone-label').textContent=state.air?'TRÊN KHÔNG':state.edgeTime>0?'TRỞ VỀ MẶT SÓNG':Math.sin(p)>.65?'GẦN ĐỈNH · BẬT SÓNG':'VÙNG LẤY ĐÀ';
 const threat=hazards.threat(state);$('danger').hidden=!threat||state.status!=='playing';if(threat){$('danger-name').textContent=threat.name;$('danger-distance').textContent=threat.distance+' m · '+(state.air?'GIỮ '+(isTouch?'AURA':'E')+' · BIỂU DIỄN KHI BAY QUA':isTouch?threat.hint.replaceAll('SPACE','BẬT SÓNG'):threat.hint);$('danger').classList.toggle('urgent',threat.urgent);}
 $('air-info').hidden=!state.air;$('air-info').textContent=state.air?Math.max(0,state.y-sampleWater(state.x,state.z,state.oceanTime,{}).h-.14).toFixed(1)+' m':'';
 document.body.classList.toggle('aura-on',state.auraActive);$('aura-status').hidden=!state.auraActive;$('aura-status').textContent='✦ '+['CHÀO SÓNG','SKY KING','CHIẾN THẮNG'][state.auraStyle]+' · '+state.auraDwell.toFixed(1)+'s';$('charge').classList.toggle('active',state.charge>.02);$('charge-bar').style.width=state.charge*100+'%';$('perf-info').textContent=Math.round(state.fps)+' FPS · '+tiers[state.tier].name+' · '+renderer.domElement.width+' × '+renderer.domElement.height;
}
function frame(now){requestAnimationFrame(frame);if(document.hidden){lastTime=now;return;}const rawDt=lastTime?(now-lastTime)/1000:1/60;lastTime=now;const dt=Math.min(rawDt,.08);accumulator+=dt;let steps=0;while(accumulator>=FIXED_DT&&steps<12){capturePrevious();step(FIXED_DT);accumulator-=FIXED_DT;steps++;}if(steps===12)accumulator=0;updateVisual(dt,accumulator/FIXED_DT);renderer.render(scene,camera);frameCount++;hudTime+=dt;if(hudTime>.1){updateHUD();hudTime=0;}
 measureTime+=rawDt;measureFrames++;if(measureTime>=2){state.fps=measureFrames/measureTime;if(state.quality==='auto'&&state.status==='playing'){if(state.fps<43){slowTime+=measureTime;fastTime=0;}else if(state.fps>57){fastTime+=measureTime;slowTime=0;}else{slowTime=fastTime=0;}if(slowTime>=4&&state.tier>0)applyTier(state.tier-1);else if(fastTime>=14&&state.tier<(isTouch?1:2))applyTier(state.tier+1);}measureTime=0;measureFrames=0;}
}
// Small read-only instrumentation allows reproducible performance and state checks.
window.__SURF__={getState:()=>({...state,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,renderWidth:renderer.domElement.width,renderHeight:renderer.domElement.height,frames:frameCount,character:surfer.inspect(),obstacles:hazards.inspect(),crash:crashFX.inspect(),seascape:seascape.inspect}),sampleWater:(x,z,t)=>sampleWater(x,z,t),version:'4.1.0'};
try{const context=document.modelContext;if(context?.registerTool){const lifeCycle=new AbortController();const register=tool=>Promise.resolve(context.registerTool(tool,{signal:lifeCycle.signal})).catch(()=>{});register({name:'read_surf_session',description:'Read the current surfing session score, speed and status.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(input&&Object.keys(input).length)throw new Error('No parameters accepted.');return {status:state.status,mode:state.mode,score:Math.floor(state.score),speedKmh:Math.round(state.speed*3.6),remainingSeconds:null,distance:Math.round(-state.z),crashes:state.crashes,auraClears:state.auraClears};}});register({name:'start_surf_session',description:'Start a new surfing session. Replaces the current run.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['session','free']}},required:['mode'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!['session','free'].includes(input.mode)||Object.keys(input).some(k=>k!=='mode'))throw new Error('mode must be session or free');state.mode='free';startGame();return {status:state.status,mode:state.mode};}});window.addEventListener('pagehide',()=>lifeCycle.abort(),{once:true});}}catch{}
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();$('error-text').textContent='Trình duyệt vừa ngắt đồ họa. Tải lại để trở về biển; kỷ lục của bạn vẫn được giữ.';$('error').hidden=false;});
step(FIXED_DT);capturePrevious();camera.position.set(state.x+8,5.8,state.z+10.2);lookNow.set(state.x-3,1.6,state.z-5);updateVisual(1);renderer.compile(scene,camera);renderer.render(scene,camera);$('loading').style.opacity='0';setTimeout(()=>$('loading').hidden=true,500);requestAnimationFrame(frame);
