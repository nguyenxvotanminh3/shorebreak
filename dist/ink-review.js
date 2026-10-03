import * as THREE from './vendor/three.module.js';
import {createAbyssLife} from './abyss-life.js';
import {CREATURE_STEP} from './abyss-locomotion.js';
const $=id=>document.getElementById(id),canvas=$('view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.3));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x143744);scene.fog=new THREE.FogExp2(0x143744,.009);
const camera=new THREE.PerspectiveCamera(55,1,.08,180);
scene.add(new THREE.HemisphereLight(0xb1dcdf,0x162d3d,1.9));const key=new THREE.DirectionalLight(0xd7edef,2.8);key.position.set(35,20,-30);scene.add(key);
const fixtures=new THREE.Group();scene.add(fixtures);const material=new THREE.MeshStandardMaterial({color:0x6b8485,roughness:.88});const geo=new THREE.BoxGeometry(4,4,4);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(110,110),material);floor.rotation.x=-Math.PI/2;floor.position.set(59,-60,-103);fixtures.add(floor);
for(const [x,y,z,s]of [[69,-49,-97,1],[47,-56,-110,2],[72,-57,-118,1.3]]){const rock=new THREE.Mesh(geo,material);rock.position.set(x,y,z);rock.scale.setScalar(s);rock.rotation.y=.4;fixtures.add(rock);}
const life=createAbyssLife(scene,{terrain:()=>-60,onAsset:e=>{if(e.status==='error')$('error').textContent=e.id+' / '+e.message;}}),creature=life.creatures.find(c=>c.id==='kraken');
const observer={x:71,y:-47,z:-103,playing:false,submerged:true},eye=new THREE.Vector3(),focus=new THREE.Vector3(59,-43,-103);
let time=0,accumulator=0,paused=true,ready=false,inside=false,last=performance.now();
function controls(){for(const b of document.querySelectorAll('button'))b.disabled=!ready;}
function hideOthers(){for(const child of scene.children)if(!child.isLight&&child!==fixtures)child.visible=child===creature.root||child===life.inkClouds.root;}
function reset(){life.reset();time=accumulator=0;observer.playing=true;paused=true;inside=false;life.update(0,0,observer,$('quality').value);}
function tick(){time+=CREATURE_STEP;life.update(CREATURE_STEP,time,observer,$('quality').value);}
function pose(at){reset();for(let i=0;i<Math.round(at/CREATURE_STEP);i++)tick();paused=true;}
$('play').onclick=()=>{reset();paused=false;};$('pause').onclick=()=>{paused=!paused;};$('reset').onclick=reset;
for(const b of document.querySelectorAll('[data-phase]'))b.onclick=()=>pose(Number(b.dataset.phase));
$('quality').onchange=()=>{const at=time,view=inside;pose(at);inside=view;};
$('inside').onclick=()=>{if(time<.8||time>10)pose(2.2);inside=true;};$('outside').onclick=()=>{inside=false;};
$('capture').onclick=()=>{renderer.render(scene,camera);canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Vuc-Lang-ink-${time.toFixed(2)}s-${$('quality').value}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});};
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();controls();
function frame(now){
 const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;
 if(!ready){life.update(0,0,observer,'high');ready=creature.lowState==='ready'&&creature.highState==='ready';if(ready){reset();controls();}}
 else if(!paused&&!document.hidden){accumulator+=dt;while(accumulator+1e-10>=CREATURE_STEP){tick();accumulator-=CREATURE_STEP;}if(time>=14)paused=true;}
 hideOthers();const ink=life.inkClouds.snapshot(),defense=creature.inkDefense.state;
 if(inside&&ink.clouds.length){const c=ink.clouds[0].center;eye.set(c.x,c.y,c.z);camera.position.copy(eye);camera.lookAt(creature.root.position.x,creature.root.position.y+2,creature.root.position.z);}
 else{camera.position.set(79,-32,-82);camera.lookAt(focus);}
 const density=life.inkDensity(camera.position);$('veil').style.opacity=String(density*.86);renderer.render(scene,camera);
 $('status').textContent=`${ready?'READY':'LOADING'} · ${paused?'PAUSED':'RUNNING'} · ${time.toFixed(3)}s · ${defense.stage.toUpperCase()}\nEvent ${defense.eventId} · cooldown ${defense.cooldown.toFixed(2)}s · speed ${creature.motion.speed.toFixed(2)}m/s · ${creature.lastAsset}\nMantle squeeze ${defense.contraction.toFixed(2)} · arm extension ${defense.extension.toFixed(2)} · clouds ${ink.activeClouds} / 2 · puffs ${ink.instances}\nLocal visibility density ${density.toFixed(2)} · ${inside?'inside cloud':'fixed exterior camera'} · ${$('quality').value}`;
 requestAnimationFrame(frame);
}
addEventListener('pagehide',()=>{life.dispose();geo.dispose();floor.geometry.dispose();material.dispose();renderer.dispose();});requestAnimationFrame(frame);
