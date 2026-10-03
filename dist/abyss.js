import * as THREE from './vendor/three.module.js';
import { createAbyssWorld, terrainHeight as reefTerrainHeight } from './abyss-world.js';
import { createAbyssLife } from './abyss-life.js';
import { createDeepBasin, DEEP_BOUNDS } from './abyss-deep-zone.js';
import { createDeepRig } from './abyss-rig.js';
import { createDive, startDive, stepDive, clearMotion, triggerSonar, recoverDiver, makeLocations, distance, serializableProgress, restoreProgress, FIXED_STEP, LIMITS } from './abyss-sim.js';
import { createDiveInput } from './abyss-input.js';
import { createDiverArms } from './abyss-arms.js';
import { createAbyssFlashlight } from './abyss-flashlight.js';
import { createSonarController, SONAR } from './abyss-sonar.js';
import {sampleIslandTerrain,sampleIslandEnvironment,biomeAt,ISLAND_BOUNDS,ISLAND_SAFE_PATH} from './abyss-island-terrain.js';
import {createIslandWorld} from './abyss-island-world.js';
import {createIslandSky} from './abyss-island-sky.js';
import {sampleSeaHeight} from './abyss-water.js';
const terrainHeight=(x,z)=>sampleIslandTerrain(x,z,reefTerrainHeight);
const BUILD_ID='dynamic-sea-v8';
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const coarse=matchMedia('(pointer:coarse)').matches;document.body.classList.toggle('touch',coarse);
const state=createDive(),input=createDiveInput(),canvas=$('ocean'),locations=makeLocations(terrainHeight);
const saved={};try{Object.assign(saved,JSON.parse(localStorage.getItem('shorebreak-abyss-settings')||'{}'));}catch{}
let progress=null;try{progress=JSON.parse(localStorage.getItem('shorebreak-abyss-progress')||'null');}catch{}
if(progress?.banked?.length)$('continue').hidden=false;
let renderer;try{renderer=new THREE.WebGLRenderer({canvas,antialias:!coarse,powerPreference:'high-performance'});}catch(error){$('loading').hidden=true;$('error').hidden=false;throw error;}
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.97;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.08,330);camera.rotation.order='YXZ';scene.add(camera);
const world=createAbyssWorld(scene),deepBasin=createDeepBasin(scene,{terrain:terrainHeight}),assetStatus={};
const island=createIslandWorld(scene,{terrain:terrainHeight,baseTerrain:reefTerrainHeight,onAsset:r=>{assetStatus['island']=r.status;if(r.status==='error')console.warn('Island assets unavailable:',r.message);}}),islandSky=createIslandSky(scene);
const allColliders=[...world.colliders,...deepBasin.colliders,...island.colliders];const life=createAbyssLife(scene,{terrain:terrainHeight,colliders:allColliders,onAsset:r=>{assetStatus[r.id+':'+r.tier]=r.status;if(r.status==='error')console.warn('Creature asset unavailable:',r.id,r.tier,r.message);}});
const rig=createDeepRig(scene,{terrain:terrainHeight,onAsset:r=>{assetStatus[r.id+':'+r.tier]=r.status;if(r.status==='error')console.warn('Rig asset unavailable:',r.tier,r.message);}});
const flashlight=createAbyssFlashlight({scene,camera,renderer,roots:[world.root,deepBasin.root,rig.root,island.root,...life.creatures.map(c=>c.root)]}),sonar=createSonarController();
const diverArms=createDiverArms(camera,{materialDecorator:m=>flashlight.limitArmMaterial(m),onAsset:r=>{assetStatus['diver-arms']=r.status;if(r.status==='error')console.warn('Diver arms unavailable:',r.message);}});
const armsContext={status:'menu',terrain:terrainHeight,colliders:allColliders,scanHeld:false,reducedMotion:false},armsVelocity=new THREE.Vector3();
const airBell=world.airBell||{x:44,y:terrainHeight(44,-102)+8,z:-94,radius:5};
const simWorld={terrain:terrainHeight,colliders:allColliders,bounds:ISLAND_BOUNDS,boxColliders:rig.boxColliders,sampleEnvironment:p=>rig.sampleEnvironment(p)||sampleIslandEnvironment(p,reefTerrainHeight),locations,airBell,threats:life.threats};
// Physical reference: the surface research buoy, tether and recovery beacon.
const buoy=new THREE.Group();scene.add(buoy);buoy.position.set(0,0,18);
const orange=new THREE.MeshStandardMaterial({color:0xd27f42,roughness:.65,metalness:.12}),metal=new THREE.MeshStandardMaterial({color:0x9dbbb1,roughness:.35,metalness:.62});
const float=new THREE.Mesh(new THREE.TorusGeometry(2.2,.55,10,28),orange);float.rotation.x=Math.PI/2;float.position.y=.3;buoy.add(float);
const buoyMast=new THREE.Mesh(new THREE.CylinderGeometry(.15,.2,5,10),metal);buoyMast.position.y=1.8;buoy.add(buoyMast);
const beaconMat=new THREE.MeshStandardMaterial({color:0xffdc8e,emissive:0xffbb57,emissiveIntensity:3});const beacon=new THREE.Mesh(new THREE.SphereGeometry(.27,10,8),beaconMat);beacon.position.y=4.4;buoy.add(beacon);
const tether=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,22,5),metal);tether.position.y=-11;buoy.add(tether);
const buoyLight=new THREE.PointLight(0xffd291,8,18,1.4);buoyLight.position.set(0,-2,18);scene.add(buoyLight);
const signalObjects=[];const coreGeo=new THREE.OctahedronGeometry(.55,1),ringGeo=new THREE.TorusGeometry(.92,.06,7,32),signalMat=new THREE.MeshStandardMaterial({color:0x93f4ca,metalness:.65,roughness:.24,emissive:0x3ddebc,emissiveIntensity:2.2});
for(const p of locations){const g=new THREE.Group();g.position.set(p.x,p.y,p.z);const core=new THREE.Mesh(coreGeo,signalMat),ring=new THREE.Mesh(ringGeo,metal);ring.rotation.x=.4;g.add(core,ring);scene.add(g);const light=new THREE.PointLight(0x5bffd1,5,10,1.4);light.position.copy(g.position);scene.add(light);signalObjects.push({g,core,ring,light,id:p.id,base:p.y});}
// Sonar is a bounded sensor. Map pins appear only after a measured return;
// creatures remain at the saved emission position, never a live wall tracker.
const shore=ISLAND_SAFE_PATH.find(p=>terrainHeight(p.x,p.z)>.4)||ISLAND_SAFE_PATH[1],shorePoint={id:'island',kind:'landmark',known:true,name:'ĐẢO VÂN · BỜ CÁT',x:shore.x,y:terrainHeight(shore.x,shore.z)+1.2,z:shore.z};
const navigationPoints=[shorePoint,...locations.map(p=>({...p,kind:'objective'})),
 {id:'home',kind:'home',known:true,name:'PHAO NGHIÊN CỨU',x:0,y:-.5,z:18},
 {id:'air',kind:'air',name:'TÚI KHÍ',...airBell},
 {id:'rig',kind:'rig',name:'GIÀN KHOAN / 07',x:rig.entryPosition.x,y:rig.entryPosition.y,z:rig.entryPosition.z}];
const waypointNodes=[];
for(const p of [...navigationPoints,...life.creatures.map(c=>({id:'life-'+c.id,kind:'creature',name:'SINH VẬT LỚN',x:0,y:0,z:0}))]){
 const el=document.createElement('div');el.className='waypoint'+(p.id==='home'?' home':p.id==='rig'?' rig':p.kind==='creature'?' creature':'');
 const label=document.createElement('b'),sub=document.createElement('span');label.textContent=p.name;el.hidden=true;el.append(label,sub);$('waypoints').append(el);waypointNodes.push({p,el,sub});
}
const echoRows=Array.from({length:3},()=>{const row=document.createElement('div'),name=document.createElement('b'),reading=document.createElement('span');row.className='sonar-echo';row.hidden=true;row.append(name,reading);$('sonar-echoes').append(row);return {row,name,reading};});
for(const p of locations){const row=document.createElement('div');row.className='signal-line';row.id='signal-'+p.id;const span=document.createElement('span'),mark=document.createElement('i');span.textContent=p.name;mark.textContent='○';row.append(span,mark);$('signal-list').append(row);}
let qualityChoice=['auto','high','medium','low'].includes(saved.quality)?saved.quality:'auto',quality=qualityChoice==='auto'?(coarse?'low':'medium'):qualityChoice;
let sensitivity=clamp(Number(saved.sensitivity)||65,25,150),reducedMotion=saved.reducedMotion??matchMedia('(prefers-reduced-motion:reduce)').matches;
let volume=clamp(Number(saved.volume??40),0,100),sound=false,audio=null,audioGain=null,noiseGain=null,lowOsc=null,lowGain=null,lastBreath=-99;
let rigInteractHeld=false,inkOpacity=0,lastInkEvent=0;
let prev=performance.now(),accumulator=0,menuTime=0,hudTime=0,noticeTime=0,frameTime=16.7,slowTime=0,perfTime=0,lastSaved='',drag=null,ignoreDialogClose=false,dialogReturn='menu';
$('quality').value=qualityChoice;$('sensitivity').value=sensitivity;$('volume').value=volume;$('reduced-motion').checked=reducedMotion;
function saveSettings(){try{localStorage.setItem('shorebreak-abyss-settings',JSON.stringify({quality:qualityChoice,sensitivity,volume,reducedMotion}));}catch{}}
function setQuality(tier){quality=tier;world.setQuality?.(tier);const ratio=Math.min(devicePixelRatio||1,tier==='high'?1.6:tier==='medium'?1.2:.8);renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight,false);flashlight.setQuality(tier);}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();setQuality(quality);}
window.addEventListener('resize',resize);resize();
function initAudio(){if(audio)return;const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;audio=new Context();audioGain=audio.createGain();audioGain.gain.value=0;audioGain.connect(audio.destination);const buffer=audio.createBuffer(1,audio.sampleRate*3,audio.sampleRate);const data=buffer.getChannelData(0);let noise=0;for(let i=0;i<data.length;i++){noise=(noise+(Math.random()*2-1)*.035)/1.025;data[i]=noise;}const source=audio.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=420;noiseGain=audio.createGain();noiseGain.gain.value=.32;source.connect(filter);filter.connect(noiseGain);noiseGain.connect(audioGain);source.start();lowOsc=audio.createOscillator();lowOsc.type='sine';lowOsc.frequency.value=43;lowGain=audio.createGain();lowGain.gain.value=.035;lowOsc.connect(lowGain);lowGain.connect(audioGain);lowOsc.start();}
function tone(freq,duration=.4,gain=.07){if(!sound||!audio)return;const osc=audio.createOscillator(),g=audio.createGain();osc.frequency.value=freq;osc.connect(g);g.connect(audioGain);g.gain.setValueAtTime(gain,audio.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration);osc.start();osc.stop(audio.currentTime+duration);}
function soundToggle(){initAudio();sound=!sound;if(sound)audio?.resume();$('sound').textContent='ÂM THANH: '+(sound?'BẬT':'TẮT');$('sound').setAttribute('aria-label',sound?'Tắt âm thanh':'Bật âm thanh');}
function audioUpdate(){if(!audio)return;const active=sound&&state.status==='playing';audioGain.gain.setTargetAtTime(active?volume/100*.65:0,audio.currentTime,.14);if(!active)return;lowGain.gain.setTargetAtTime(.025+state.threat*.075,audio.currentTime,.6);lowOsc.frequency.setTargetAtTime(39+state.threat*12,audio.currentTime,.6);noiseGain.gain.setTargetAtTime((state.inAir?.13:.28)+world.seaState.wind*.09*Math.exp(-Math.max(0,-state.y)/12),audio.currentTime,.6);if(state.time-lastBreath>(state.oxygen<35?1.6:3.7)){lastBreath=state.time;tone(state.inAir?140:95,.8,.025);}}
function clearInputs(){input.clear();rigInteractHeld=false;armsVelocity.set(0,0,0);drag=null;document.querySelectorAll('[data-input]').forEach(b=>b.classList.remove('held'));}
function unlock(){if(document.pointerLockElement===canvas)document.exitPointerLock?.();}
function capture(){if(coarse||state.status!=='playing')return;try{const result=canvas.requestPointerLock?.();if(result?.catch)result.catch(()=>{$('look-hint').hidden=false;});if(!canvas.requestPointerLock)$('look-hint').hidden=false;}catch{$('look-hint').hidden=false;}}
function closeAll(){ignoreDialogClose=true;document.querySelectorAll('dialog[open]').forEach(d=>d.close());ignoreDialogClose=false;}
function start(useSave=false){closeAll();startDive(state);world.update(0,0,state,quality);life.reset();inkOpacity=0;lastInkEvent=0;$('ink-veil').style.opacity='0';rig.reset();diverArms.reset();sonar.reset();lastBreath=-99;$('flashlight').classList.add('active');if(useSave)restoreProgress(state,progress);clearInputs();accumulator=0;prev=performance.now();$('welcome').hidden=true;$('menu-coordinate').hidden=true;$('hud').hidden=false;$('pause').hidden=false;$('touch-controls').hidden=!coarse;$('look-hint').hidden=coarse;document.body.classList.add('playing');capture();canvas.focus({preventScroll:true});notify('DÂY NỐI ĐÃ SẴN SÀNG','Thu ba mẫu dưới biển, khám phá giàn khoan, hoặc nổi lên và bơi về bờ cát Đảo Vân để đi bộ lên núi.');updateHUD();}
function pause(){if(state.status!=='playing')return;state.status='paused';clearInputs();clearMotion(state);unlock();closeAll();$('pause-dialog').showModal();}
function resume(withCapture=true){closeAll();state.status='playing';clearInputs();prev=performance.now();accumulator=0;if(withCapture)capture();canvas.focus({preventScroll:true});}
function goHome(){closeAll();state.status='menu';life.reset();inkOpacity=0;lastInkEvent=0;$('ink-veil').style.opacity='0';clearMotion(state);clearInputs();unlock();$('welcome').hidden=false;$('menu-coordinate').hidden=false;$('hud').hidden=true;$('pause').hidden=true;$('touch-controls').hidden=true;document.body.classList.remove('playing');$('continue').hidden=!progress?.banked?.length;}
function openDialog(id){dialogReturn=state.status;if(state.status==='playing'){state.status='paused';clearInputs();clearMotion(state);unlock();}$(id).showModal();}
function notify(title,detail){$('notice').querySelector('b').textContent=title;$('notice').querySelector('span').textContent=detail;$('notice').classList.add('visible');noticeTime=7;}
function scanSonar(){
 if(state.status!=='playing'||state.sonarCooldown>0)return;
 const contacts=navigationPoints.filter(p=>p.kind!=='objective'||!state.scans.includes(p.id)).concat(life.creatures.map(c=>({id:'life-'+c.id,kind:'creature',name:'SINH VẬT LỚN',mobile:true,x:c.motion.x,y:c.motion.y+(c.id==='warden'?12:0),z:c.motion.z})));
 if(sonar.emit(state,state.time,contacts)){triggerSonar(state);tone(460,.45,.065);}
 else if(sonar.blockedReason==='dry')notify('SONAR CẦN MÔI TRƯỜNG NƯỚC','Lặn ngập đầu để nhận hồi âm.');
 updateSonarHUD();
}
function toggleTorch(){state.flashlight=!state.flashlight;$('flashlight').classList.toggle('active',state.flashlight);}
$('start').addEventListener('click',()=>start(false));$('continue').addEventListener('click',()=>start(true));$('pause').addEventListener('click',pause);$('resume').addEventListener('click',()=>resume());$('rescue').addEventListener('click',()=>{recoverDiver(state);diverArms.reset();resume();});$('home').addEventListener('click',goHome);$('sound').addEventListener('click',soundToggle);$('settings-open').addEventListener('click',()=>openDialog('settings-dialog'));$('help-open').addEventListener('click',()=>openDialog('help-dialog'));$('capture-mouse').addEventListener('click',capture);$('flashlight').addEventListener('click',toggleTorch);$('sonar').addEventListener('click',scanSonar);
$('quality').addEventListener('change',()=>{qualityChoice=$('quality').value;setQuality(qualityChoice==='auto'?(coarse?'low':'medium'):qualityChoice);slowTime=0;saveSettings();});$('sensitivity').addEventListener('input',()=>{sensitivity=Number($('sensitivity').value);saveSettings();});$('volume').addEventListener('input',()=>{volume=Number($('volume').value);saveSettings();});$('reduced-motion').addEventListener('change',()=>{reducedMotion=$('reduced-motion').checked;saveSettings();});
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>b.closest('dialog').close());
for(const d of document.querySelectorAll('dialog')){d.addEventListener('cancel',e=>{e.preventDefault();if(d.id==='pause-dialog')resume(false);else d.close();});if(d.id!=='pause-dialog')d.addEventListener('close',()=>{if(ignoreDialogClose)return;if(dialogReturn==='playing')resume(false);});}
window.addEventListener('keydown',e=>{if(e.target?.matches?.('input,select'))return;if(e.code==='Escape'||e.code==='KeyP'){if(document.querySelector('dialog[open]')&&e.code==='Escape')return;e.preventDefault();if(e.repeat)return;if(state.status==='playing')pause();else if(state.status==='paused'&&$('pause-dialog').open)resume();return;}if(state.status!=='playing')return;if(input.handles(e.code))e.preventDefault();if(!e.repeat)input.key(e.code,true);if(!e.repeat&&e.code==='KeyF')toggleTorch();if(!e.repeat&&e.code==='KeyQ')scanSonar();if(!e.repeat&&e.code==='KeyR'&&rig.stats.inside){rig.recover(state);notify('KHOANG ĐANG TRỞ VỀ PHÍA AN TOÀN','Rời khỏi ngưỡng cửa để chu trình tiếp tục.');}});
window.addEventListener('keyup',e=>input.key(e.code,false));window.addEventListener('blur',()=>{clearInputs();if(state.status==='playing')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.status==='playing')pause();});
document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===canvas;$('look-hint').hidden=locked||coarse;if(!locked&&state.status==='playing'&&!drag)pause();});document.addEventListener('pointerlockerror',()=>{$('look-hint').hidden=false;});
function look(dx,dy){if(state.status!=='playing')return;const factor=sensitivity*.000035;state.yaw-=dx*factor;state.pitch=clamp(state.pitch-dy*factor,-1.48,1.48);}
document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)look(e.movementX,e.movementY);});
canvas.addEventListener('pointerdown',e=>{if(state.status!=='playing'||document.pointerLockElement===canvas)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);e.preventDefault();});canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;look(e.clientX-drag.x,e.clientY-drag.y);drag.x=e.clientX;drag.y=e.clientY;});const stopDrag=e=>{if(drag?.id===e.pointerId)drag=null;};canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);canvas.addEventListener('lostpointercapture',stopDrag);
for(const b of document.querySelectorAll('[data-input]')){b.addEventListener('pointerdown',e=>{if(state.status!=='playing')return;e.preventDefault();b.setPointerCapture?.(e.pointerId);input.pointer(e.pointerId,b.dataset.input,true);b.classList.add('held');});const release=e=>{input.pointer(e.pointerId,b.dataset.input,false);b.classList.toggle('held',input.pointerHeld(b.dataset.input));};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(state.status==='playing')pause();$('error-text').textContent='Trình điều khiển đồ họa đã ngắt kết nối. Dữ liệu đã gửi vẫn được lưu. Hãy tải lại trang.';$('error').hidden=false;});
function updateHUD(){const land=biomeAt(state.x,state.z)!=='ocean'&&state.y>0,biome=biomeAt(state.x,state.z),depth=land?Math.max(0,state.y-state.eyeHeight):Math.max(0,-state.y);$('depth-label').textContent=land?'CAO ĐỘ':'ĐỘ SÂU';$('depth').innerHTML=Math.floor(depth).toString().padStart(2,'0')+'<small>m</small>';$('temperature').textContent=land?(state.wading?'28°C · BỜ NƯỚC':biome==='highland'?'24°C · ĐỈNH NÚI':'28°C · ĐẢO VÂN'):state.movementMode==='walk'?'18°C · KHOANG KHÔ':(26-depth*.12).toFixed(0)+'°C · ÁP SUẤT '+(1+depth/10).toFixed(1)+' BAR';const bearing=(((-state.yaw*180/Math.PI)%360)+360)%360;const cardinal=['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8];$('heading').textContent=cardinal+' '+Math.round(bearing).toString().padStart(3,'0')+'°';$('biome').textContent=land?'ĐẢO VÂN / '+({shore:'BỜ CÁT',coast:'RỪNG VEN BIỂN',slope:'SƯỜN NÚI',highland:'ĐỈNH NÚI'}[biome]||'VEN ĐẢO'):rig.stats.inside?'GIÀN KHOAN / 07':depth>100?'LÒNG CHẢO SÂU':depth>56?'VỰC XANH':depth>33?'TÀN TÍCH CHUÔNG':'RÌA SAN HÔ';$('oxygen').textContent=Math.ceil(state.oxygen);$('oxygen-ring').style.strokeDashoffset=String(276.46*(1-state.oxygen/LIMITS.oxygen));$('oxygen-ring').style.stroke=state.oxygen<30?'#f18c6a':state.inAir?'#7bf3d7':'#f2c87b';$('air-status').textContent=state.inAir?'ĐANG NẠP KHÍ':state.oxygen<30?'CẦN NỔI LÊN NGAY':'BÌNH KHÍ ỔN ĐỊNH';$('integrity').textContent='THỂ TRẠNG '+Math.ceil(state.health)+'%';const homeBearing=(Math.atan2(-state.x,state.z-18)*180/Math.PI+360)%360;$('return-distance').textContent='PHAO '+Math.round(distance(state,{x:0,y:0,z:18}))+' m · '+Math.round(homeBearing).toString().padStart(3,'0')+'°';const islandBearing=(Math.atan2(shorePoint.x-state.x,state.z-shorePoint.z)*180/Math.PI+360)%360;$('shore-distance').textContent='ĐẢO VÂN '+Math.round(distance(state,shorePoint))+' m · '+Math.round(islandBearing).toString().padStart(3,'0')+'°';$('mission-count').textContent=String(state.scans.length).padStart(2,'0')+' / 03';$('objective').textContent=state.completed?'Khảo sát hoàn tất · Tự do khám phá':state.scans.length===3?'Trở về phao để gửi cả ba mẫu':state.scans.length>state.banked.length?'Mẫu chưa gửi · Quay về phao để lưu':'Thu ba mẫu dữ liệu và trở về phao';for(const p of locations){const row=$('signal-'+p.id),done=state.scans.includes(p.id);row.classList.toggle('done',done);row.querySelector('i').textContent=state.banked.includes(p.id)?'✓':done?'●':'○';}
 $('sea-state').textContent=({Calm:'BIỂN ÊM',Moderate:'SÓNG VỪA',Rough:'BIỂN ĐỘNG'}[world.seaState.label]||'BIỂN ÊM');
 const nearby=locations.find(p=>p.id===state.nearTarget),panel=rig.getInteraction(state),lockState=rig.lock.state;const lockVisible=rig.stats.inside&&lockState.busy;$('interaction').hidden=!nearby&&!panel&&!lockVisible;$('interaction-text').textContent=panel?'E · '+panel.label+' / '+rig.statusText():lockVisible?rig.statusText()+' · R ĐỂ TRỞ LẠI':nearby?'GIỮ E · THU MẪU '+nearby.name:'';$('scan-progress').style.width=(panel||lockVisible?100*(lockState.target==='habitat'?1-lockState.water01:lockState.water01):Math.min(100,state.scanProgress*100))+'%';$('controls-hint').textContent=land?(state.wading?'WASD lội nước · Lên bờ cát để đi bộ':'WASD đi bộ · Shift đi nhanh · Theo lối cát lên núi'):state.movementMode==='walk'?'WASD đi bộ · E bảng điều khiển · R huỷ chu trình · Esc dừng':'WASD bơi · Space lên · Ctrl/C xuống · E quét / dùng · Esc dừng';for(const b of document.querySelectorAll('[data-input]'))if(b.dataset.input==='scan')b.textContent=panel?'DÙNG':'QUÉT';updateSonarHUD();$('warning').hidden=state.oxygen>35&&state.threat<.7;$('warning').textContent=state.oxygen<=35?'OXY THẤP · SPACE ĐỂ NỔI LÊN':'PHÁT HIỆN CHUYỂN ĐỘNG LỚN';$('danger-wash').style.opacity=String(Math.max((1-state.health/100)*.75,state.oxygen<25?.35:0));
 const save=JSON.stringify(serializableProgress(state));if(save!==lastSaved&&state.banked.length){try{localStorage.setItem('shorebreak-abyss-progress',save);progress=JSON.parse(save);lastSaved=save;}catch{}}
}
function updateSonarHUD(){
 const dry=state.inAir||state.movementMode==='walk'||state.y>=0,pulse=sonar.pulse;
 $('sonar-label').textContent=state.sonarCooldown>0?'SONAR '+Math.ceil(state.sonarCooldown)+'s':'SONAR';
 $('sonar').disabled=state.sonarCooldown>0||dry;
 $('sonar-status').textContent=dry?'SONAR · CẦN NGẬP NƯỚC':pulse.active?'HỒI ÂM '+Math.round(pulse.returnRadius)+' / '+SONAR.range+' m':'SONAR · BÁN KÍNH '+SONAR.range+' m';
 $('sonar-progress').style.width=(dry?0:pulse.progress*100)+'%';
 const contacts=sonar.echoes.filter(e=>!(e.id==='home'&&e.currentRange<15)).sort((a,b)=>(state.oxygen<45?(a.kind==='air'?-1:0)-(b.kind==='air'?-1:0):0)||a.currentRange-b.currentRange);
 for(let i=0;i<echoRows.length;i++){
  const {row,name,reading}=echoRows[i],echo=contacts[i];row.hidden=!echo;if(!echo)continue;
  name.textContent=echo.name+(echo.mobile?' · DẤU CŨ':'');row.style.opacity=String(.4+.6*echo.strength);
  const bearing=echo.currentBearing===null?'thẳng đứng':Math.round(echo.currentBearing).toString().padStart(3,'0')+'°';
  reading.textContent=Math.round(echo.currentRange)+' m · '+bearing+' · sâu '+Math.round(echo.depth)+' m'+(echo.mobile?' · '+Math.floor(state.time-echo.emittedAt)+'s':'');
 }
 $('sonar-help').textContent=dry?'Thiết bị hoạt động khi lặn':contacts.length?'Khoảng cách đến vị trí đã quét · hồi âm phai sau 5s':pulse.active?'Đang chờ hồi âm · thời gian hiển thị giãn chậm':pulse.emittedAt!==null?'Không còn hồi âm trong 140 m · Q để quét lại':'Q quét mẫu, túi khí, giàn khoan và sinh vật';
}
const projected=new THREE.Vector3(),direction=new THREE.Vector3(),inverseCamera=new THREE.Quaternion();
function updateWaypoints(){
 inverseCamera.copy(camera.quaternion).invert();
 for(const w of waypointNodes){
  const echo=sonar.getEcho(w.p.id),home=w.p.id==='home',air=w.p.id==='air',facility=w.p.id==='rig',islandMark=w.p.id==='island',mobile=w.p.kind==='creature';
  const point=mobile?echo:w.p,d=point?distance(state,point):Infinity,unscanned=!state.scans.includes(w.p.id);
  const passive=islandMark?d<350:home?(state.scans.length>state.banked.length||state.oxygen<60||d<22):air?d<20:facility?d<55:!mobile&&unscanned&&d<20;
  const visible=passive||!!echo&&(w.p.kind!=='objective'||unscanned);if(!visible||!point){w.el.hidden=true;continue;}
  projected.set(point.x,point.y,point.z);direction.copy(projected).sub(camera.position).applyQuaternion(inverseCamera);
  if(direction.z>0){w.el.hidden=true;continue;}projected.project(camera);
  w.el.hidden=Math.abs(projected.x)>1.05||Math.abs(projected.y)>1.08;if(w.el.hidden)continue;
  w.el.style.left=((projected.x*.5+.5)*innerWidth)+'px';w.el.style.top=((-projected.y*.5+.5)*innerHeight)+'px';
  w.el.style.opacity=String(echo?.strength??.7);w.sub.textContent=Math.round(d)+' m'+(!home?' · sâu '+Math.round(-point.y)+' m':'')+(mobile?' · dấu '+Math.floor(state.time-echo.emittedAt)+'s':echo?' · hồi âm':'');
 }
}
function frame(now){requestAnimationFrame(frame);const raw=(now-prev)/1000;prev=now;const dt=Math.min(Math.max(raw,0),.06);frameTime+=(Math.min(raw*1000,120)-frameTime)*.035;let t=state.time;
 if(state.status==='playing'){accumulator+=dt;const controls=input.read(),panel=rig.getInteraction(state);if(controls.scan&&!rigInteractHeld&&panel){const result=rig.interact(state);if(result?.changed)notify('KHOANG ÁP SUẤT',result.status);else if(!result?.accepted)notify('CHU TRÌNH ĐANG CHẠY','Chờ cửa và mức nước hoàn tất. R để quay lại phía an toàn.');}rigInteractHeld=!!controls.scan;if(panel)controls.scan=0;let steps=0;while(accumulator>=FIXED_STEP&&steps<6){const px=state.x,py=state.y,pz=state.z,rescues=state.rescues;rig.step(FIXED_STEP,state);stepDive(state,controls,FIXED_STEP,simWorld);if(state.rescues!==rescues){rig.recover(state);armsVelocity.set(0,0,0);diverArms.reset();}else armsVelocity.set((state.x-px)/FIXED_STEP,(state.y-py)/FIXED_STEP,(state.z-pz)/FIXED_STEP);accumulator-=FIXED_STEP;steps++;}if(steps===6)accumulator=0;t=state.time;if(state.message){notify(state.message.text,state.message.detail);if(state.message.kind==='scan')tone(720,.45);if(state.message.kind==='complete')tone(920,1.2);state.message=null;}noticeTime-=dt;if(noticeTime<=0)$('notice').classList.remove('visible');}
 else if(state.status==='menu'){menuTime+=dt;t=menuTime;}
 const activeDt=state.status==='paused'?0:dt;const renderPlayer=state.status==='menu'?{x:0,y:-4.4,z:18,status:'menu'}:state;
 island.update(activeDt,t,renderPlayer,quality);world.update(activeDt,t,{...renderPlayer,indoors:!!rig.sampleEnvironment(renderPlayer)?.indoors},quality);deepBasin.update(activeDt,t,renderPlayer,quality);life.update(activeDt,t,renderPlayer,quality);
 const inkState=life.creatures.find(c=>c.id==='kraken')?.inkDefense?.state;
 if(state.status==='playing'&&inkState?.eventId>lastInkEvent){lastInkEvent=inkState.eventId;notify('MỰC PHÒNG VỆ','Sinh vật đang rút lui. Bơi tránh đám mực để nhìn rõ.');}
 const inkTarget=state.status==='menu'||state.inAir?0:life.inkDensity(renderPlayer)*.86;inkOpacity+=(inkTarget-inkOpacity)*(1-Math.exp(-activeDt*5));if(inkOpacity<.0001)inkOpacity=0;$('ink-veil').style.opacity=String(inkOpacity);
 rig.update(activeDt,t,renderPlayer,quality);
 if(state.status==='menu'){camera.position.set(0,-4.4,18);camera.rotation.set(-.24,.20,0,'YXZ');}
 else{const bob=!reducedMotion&&state.status==='playing'?Math.sin(t*1.8)*.025*clamp(armsVelocity.length()/LIMITS.swim,0,1):0;camera.position.set(state.x,state.y+bob,state.z);camera.rotation.set(state.pitch,state.yaw,0,'YXZ');}
 Object.assign(armsContext,{status:state.status,x:state.x,y:state.y,z:state.z,yaw:state.yaw,pitch:state.pitch,vx:state.movementMode==='walk'?0:armsVelocity.x,vy:state.movementMode==='walk'?0:armsVelocity.y,vz:state.movementMode==='walk'?0:armsVelocity.z,sprinting:state.sprinting,nearTarget:state.nearTarget,onLand:state.movementMode==='walk'&&!rig.stats.inside,groundSpeed:armsVelocity.length(),scanHeld:!!input.read().scan,reducedMotion});diverArms.update(state.status==='playing'?dt:0,armsContext);
 camera.updateMatrixWorld();islandSky.update(activeDt,t,camera,{indoors:!!rig.sampleEnvironment(renderPlayer)?.indoors,seaState:world.seaState});flashlight.update(activeDt,{status:state.status,enabled:state.flashlight,inAir:state.inAir,dynamicOccluders:rig.lock.state.busy});sonar.update(state.time,state);if(state.status==='playing'&&sonar.newEchoes.length)tone(760,.18,.035);for(const o of signalObjects){const done=state.scans.includes(o.id);o.core.visible=!done;o.light.visible=!done&&quality==='high'&&Math.hypot(camera.position.x-o.g.position.x,camera.position.y-o.g.position.y,camera.position.z-o.g.position.z)<20;o.g.position.y=o.base+Math.sin(t*1.2)*.22;o.core.rotation.y=t*.32;o.ring.rotation.z=t*.25;}
 buoy.position.y=sampleSeaHeight(0,18,world.seaState);buoy.rotation.z=Math.sin(t*.7)*(.025+.035*world.seaState.severity);beaconMat.emissiveIntensity=1.5+Math.pow(Math.max(0,Math.sin(t*2)),6)*2;
 if(state.status==='playing'){updateWaypoints();hudTime+=dt;if(hudTime>.1){updateHUD();hudTime=0;}}
 audioUpdate();renderer.render(scene,camera);perfTime+=dt;if(perfTime>1.5){$('performance').textContent=`${Math.round(1000/frameTime)} FPS đo tại máy này · ${renderer.info.render.calls} lượt vẽ · ${Math.round(renderer.info.render.triangles/1000)}k tam giác · ${quality.toUpperCase()}`;perfTime=0;}
 if(qualityChoice==='auto'&&state.status==='playing'){slowTime=frameTime>32?slowTime+dt:Math.max(0,slowTime-dt);if(slowTime>5&&quality!=='low'){setQuality(quality==='high'?'medium':'low');slowTime=0;}}
}
// Read-only instrumentation for local verification. No network telemetry.
window.__ABYSS_DEBUG={snapshot:()=>({build:BUILD_ID,sea:{...world.seaState},inkVisibility:inkOpacity,torch:flashlight.snapshot(),sonar:sonar.snapshot(),lateralSpeed:state.vx*Math.cos(state.yaw)-state.vz*Math.sin(state.yaw),resolvedLateralSpeed:armsVelocity.x*Math.cos(state.yaw)-armsVelocity.z*Math.sin(state.yaw),status:state.status,position:{x:state.x,y:state.y,z:state.z},velocity:{x:state.vx,y:state.vy,z:state.vz},resolvedVelocity:{x:armsVelocity.x,y:armsVelocity.y,z:armsVelocity.z},input:{...input.read()},cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},yaw:state.yaw,pitch:state.pitch,oxygen:state.oxygen,health:state.health,injuryCooldown:state.injuryCooldown,rescues:state.rescues,scans:[...state.scans],banked:[...state.banked],time:state.time,quality,flashlight:state.flashlight,sonarCooldown:state.sonarCooldown,pointerLocked:document.pointerLockElement===canvas,render:{...renderer.info.render},assets:{...assetStatus},airBell,world:world.stats,island:island.stats,islandSky:islandSky.snapshot(),wading:!!state.wading,deepBasin:deepBasin.stats,rig:rig.snapshot(),movementMode:state.movementMode,eyeHeight:state.eyeHeight,grounded:state.grounded,creatures:life.snapshot(),arms:diverArms.snapshot()})};
$('build-id').textContent=BUILD_ID;$('loading').hidden=true;requestAnimationFrame(frame);
