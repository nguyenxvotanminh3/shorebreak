import * as THREE from './vendor/three.module.js';
import { createAbyssLife } from './abyss-life.js';
const $=id=>document.getElementById(id), canvas=$('view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b2531);
const camera=new THREE.PerspectiveCamera(48,1,.04,600);
scene.add(new THREE.HemisphereLight(0xbfe9f0,0x254855,2.3));
const key=new THREE.DirectionalLight(0xfff0db,3.2);key.position.set(-45,80,35);scene.add(key);
const rim=new THREE.DirectionalLight(0x49bce2,2);rim.position.set(60,30,-30);scene.add(rim);
const life=createAbyssLife(scene,{terrain:()=>-60,onAsset:event=>{if(event.status==='error')$('error').textContent=`${event.id}: ${event.message}`;}});
const jellyRoot=scene.children.find(o=>o.name.startsWith('Jellyfish colony'));
const observer={x:0,y:-10,z:0,flashlight:false}, focus=new THREE.Vector3(), offset=new THREE.Vector3();
let time=0,previous=performance.now(),paused=false,slow=false,react=false,statusAt=-1;
let recorder=null,recordUntil=0,recordCanvas=null,recordContext=null,recordChunks=[],recordStream=null;
function toggle(id,state){$(id).setAttribute('aria-pressed',String(state));}
$('pause').onclick=()=>{paused=!paused;toggle('pause',paused);};
$('slow').onclick=()=>{slow=!slow;toggle('slow',slow);};
$('react').onclick=()=>{react=!react;toggle('react',react);};
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
function subject(){return $('animal').value==='jellyfish'?jellyRoot.children[0]:life.creatures.find(c=>c.id===$('animal').value).root;}
function cameraAt(object){
 const id=$('animal').value;let size=id==='shark'?4.7:id==='kraken'?22:id==='warden'?39:4.8;
 const lift=id==='shark'?.35:id==='kraken'?2.2:id==='warden'?12:-.55;
 focus.copy(object.position);focus.y+=lift;
 if(id==='kraken'&&$('region').value==='arm'){const c=life.creatures.find(c=>c.id==='kraken'),node=c[c.lastAsset+'Object']?.getObjectByName('arm0104');if(node){node.getWorldPosition(focus);size=8;}}
 const angle=$('angle').value;
 if(angle==='side')offset.set(size,.16*size,0);
 else if(angle==='front')offset.set(0,.1*size,-size);
 else if(angle==='top')offset.set(.05*size,size,.12*size);
 else offset.set(size*.72,size*.29,-size*.72);
 offset.applyQuaternion(object.quaternion);camera.position.copy(focus).add(offset);camera.lookAt(focus);
}
function beginRecording(){
 if(recorder)return;
 if(!canvas.captureStream||!globalThis.MediaRecorder){$('error').textContent='Canvas WebM recording is unavailable in this browser';return;}
 const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
 if(!type){$('error').textContent='This browser does not support WebM recording';return;}
 try{
  recordCanvas=document.createElement('canvas');recordCanvas.width=1280;recordCanvas.height=720;recordContext=recordCanvas.getContext('2d');
  recordStream=recordCanvas.captureStream(30);recordChunks=[];recorder=new MediaRecorder(recordStream,{mimeType:type,videoBitsPerSecond:3500000});
  recorder.ondataavailable=e=>{if(e.data.size)recordChunks.push(e.data);};
  recorder.onstop=()=>{
   const blob=new Blob(recordChunks,{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download=`Vuc-Lang-${$('animal').value}-motion-${Date.now()}.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
   recordStream.getTracks().forEach(track=>track.stop());recorder=null;recordStream=recordCanvas=recordContext=null;recordChunks=[];$('record').textContent='Record 16s WebM';$('record').disabled=false;
  };
  recorder.start();recordUntil=performance.now()+16000;$('record').disabled=true;$('error').textContent='';
 }catch(error){$('error').textContent=error.message;recordStream?.getTracks().forEach(track=>track.stop());recorder=null;}
}
$('record').onclick=beginRecording;
const review={snapshot:()=>({time,paused,slow,react,animal:$('animal').value,quality:$('quality').value,camera:camera.position.toArray(),runtime:life.snapshot(),draws:renderer.info.render.calls,triangles:renderer.info.render.triangles})};
Object.defineProperty(window,'__motionReview',{value:review});
function frame(now){
 const wall=Math.min(.1,Math.max(0,(now-previous)/1000));previous=now;
 const dt=paused||document.hidden?0:wall*(slow?.5:1);time+=dt;
 const object=subject(),id=$('animal').value;
 const distance=react?(id==='jellyfish'?2.3:id==='warden'?14:8):(id==='shark'?27:id==='kraken'?34:id==='warden'?50:15);
 observer.x=object.position.x+distance;observer.y=object.position.y+(id==='warden'?12:0);observer.z=object.position.z;
 life.update(dt,time,observer,$('quality').value);
 for(const child of scene.children){
  if(child.isLight)continue;
  if(child===jellyRoot){child.visible=id==='jellyfish';for(let i=0;i<child.children.length;i++)child.children[i].visible=id==='jellyfish'&&i===0;}
  else child.visible=child===object;
 }
 cameraAt(object);renderer.render(scene,camera);
 if(now-statusAt>100){
  statusAt=now;const state=life.snapshot(),selected=id==='jellyfish'?state.jellyfish.creatures[0]:state.large.find(c=>c.id===id);
  $('status').textContent=`${id.toUpperCase()} · ${selected.mode||selected.stage}${selected.joints?.stroke?' / '+selected.joints.stroke:''} · ${paused?'PAUSED':slow?'0.5×':'1×'}\nTime ${time.toFixed(2)}s  |  Phase ${selected.phase.toFixed(3)}  |  ${id==='jellyfish'?`contraction ${selected.contraction.toFixed(3)}`:`speed ${selected.speed.toFixed(2)}m/s / ${selected.lod}`}\n${react?'Player-response stimulus':'Unalerted movement'} · ${$('quality').value} · ${renderer.info.render.calls} draws / ${renderer.info.render.triangles.toLocaleString()} triangles`;
 }
 if(recorder&&recordContext){
  const ctx=recordContext;ctx.fillStyle='#071b25';ctx.fillRect(0,0,1280,720);const ratio=Math.min(1280/canvas.width,720/canvas.height),w=canvas.width*ratio,h=canvas.height*ratio;ctx.drawImage(canvas,(1280-w)/2,(720-h)/2,w,h);
  ctx.fillStyle='#071b25d9';ctx.fillRect(16,570,790,134);ctx.fillStyle='#d7edf0';ctx.font='19px monospace';$('status').textContent.split('\n').forEach((line,i)=>ctx.fillText(line,30,600+i*27));ctx.font='13px sans-serif';ctx.fillText('ISOLATED MOTION REVIEW · Exact game runtime · Camera follows body · Not gameplay footage',30,687);
  $('record').textContent=`Recording ${Math.max(0,(recordUntil-now)/1000).toFixed(1)}s`;
  if(now>=recordUntil&&recorder.state==='recording')recorder.stop();
 }
 requestAnimationFrame(frame);
}
addEventListener('pagehide',()=>{if(recorder?.state==='recording')recorder.stop();life.dispose();renderer.dispose();});
requestAnimationFrame(frame);
