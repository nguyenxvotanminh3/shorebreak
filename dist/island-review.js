import * as THREE from './vendor/three.module.js';
import {createAbyssWorld,terrainHeight as baseTerrain} from './abyss-world.js';
import {createIslandWorld} from './abyss-island-world.js';
import {createIslandSky} from './abyss-island-sky.js';
import {sampleIslandTerrain,sampleIslandEnvironment,ISLAND_SAFE_PATH,ISLAND_BOUNDS} from './abyss-island-terrain.js';
import {createDive,stepDive,clearMotion,FIXED_STEP} from './abyss-sim.js';
import {createDiverArms} from './abyss-arms.js';
const $=id=>document.getElementById(id),renderer=new THREE.WebGLRenderer({canvas:$('view'),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.3));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.97;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(70,1,.08,330);camera.rotation.order='YXZ';scene.add(camera);
const terrain=(x,z)=>sampleIslandTerrain(x,z,baseTerrain),world=createAbyssWorld(scene),island=createIslandWorld(scene,{terrain,onAsset:e=>{if(e.status==='error')$('error').textContent=e.message;}}),sky=createIslandSky(scene),arms=createDiverArms(camera);
const physics={terrain,colliders:[...world.colliders,...island.colliders],bounds:ISLAND_BOUNDS,locations:[],threats:[],sampleEnvironment:p=>sampleIslandEnvironment(p,baseTerrain)},player=createDive();player.status='playing';
let view='wide',paused=false,route=false,index=0,time=0,last=performance.now(),accumulator=0;
function place(name){route=false;clearMotion(player);paused=false;view=name;const n=name==='forest'?95:name==='summit'?ISLAND_SAFE_PATH.length-1:name==='beach'?18:0,p=ISLAND_SAFE_PATH[n];Object.assign(player,{x:p.x,z:p.z,y:terrain(p.x,p.z)+(name==='water'?.8:1.65),eyeHeight:name==='water'?.65:1.65,movementMode:name==='water'?'swim':'walk',grounded:name!=='water',wading:false,pitch:-.13});const next=ISLAND_SAFE_PATH[Math.min(n+7,ISLAND_SAFE_PATH.length-1)];player.yaw=Math.atan2(-(next.x-p.x),-(next.z-p.z));if(name==='summit')player.yaw=.8;arms.reset();}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>place(b.dataset.view);
$('route').onclick=()=>{place('water');player.y=-.2;player.movementMode='swim';player.eyeHeight=.65;view='route';route=true;index=0;};$('pause').onclick=()=>{paused=!paused;};
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();place('wide');
function frame(now){
 const dt=paused||document.hidden?0:Math.min(.05,Math.max(0,(now-last)/1000));last=now;time+=dt;
 if(route&&!paused){accumulator+=dt;while(accumulator>=FIXED_STEP){const p=ISLAND_SAFE_PATH[index],dx=p.x-player.x,dz=p.z-player.z;if(Math.hypot(dx,dz)<.65){if(index===ISLAND_SAFE_PATH.length-1){paused=true;clearMotion(player);break;}index++;}const next=ISLAND_SAFE_PATH[index],x=next.x-player.x,z=next.z-player.z;player.yaw=Math.atan2(-x,-z);player.pitch=player.movementMode==='walk'?-.13:Math.atan2(Math.max(-.2,terrain(next.x,next.z)+1.65)-player.y,Math.hypot(x,z));stepDive(player,{forward:1},FIXED_STEP,physics);accumulator-=FIXED_STEP;}}
 const quality=$('quality').value;
 if(view==='wide'){camera.position.set(20,90,240);camera.lookAt(35,12,154);}else{camera.position.set(player.x,player.y,player.z);camera.rotation.set(player.pitch,player.yaw,0,'YXZ');}
 const renderObserver=view==='wide'?{x:camera.position.x,y:camera.position.y,z:camera.position.z,status:'playing',inAir:true}:player;world.update(dt,time,renderObserver,quality);island.update(dt,time,renderObserver,quality);
 arms.update(dt,{...player,status:view==='wide'?'menu':paused?'paused':'playing',terrain,colliders:physics.colliders,onLand:player.movementMode==='walk',groundSpeed:Math.hypot(player.vx,player.vz),vx:0,vy:0,vz:0});camera.updateMatrixWorld();sky.update(dt,time,camera);renderer.render(scene,camera);
 $('status').textContent=`${view.toUpperCase()} · ${paused?'PAUSED':'RUNNING'} · ${player.wading?'wading':player.movementMode} · altitude ${Math.max(0,player.y-player.eyeHeight).toFixed(2)}m\nIsland assets: ${island.stats.status} · visible ${island.stats.visible} / ${island.stats.totalLimit} · ${island.stats.drawCalls} island draws\nRoute ${index+1}/${ISLAND_SAFE_PATH.length} · ${quality} · exact terrain and rooted meshes`;
 requestAnimationFrame(frame);
}
addEventListener('pagehide',()=>{arms.dispose();island.dispose();sky.dispose();world.dispose();renderer.dispose();});requestAnimationFrame(frame);
