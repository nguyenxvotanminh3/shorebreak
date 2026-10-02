// Application-level checks in Node with DOM/renderer stand-ins.
// These execute production handlers and frame loops, not actual browser input/GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import {GLTFLoader} from '../dist/vendor/GLTFLoader.js';

class Element extends EventTarget {
 constructor(id=''){super();this.id=id;this.hidden=false;this.open=false;this.style={};this.dataset={};this.value='';this.width=1280;this.height=720;const classes=new Set();this.classList={add(...a){a.forEach(x=>classes.add(x));},remove(...a){a.forEach(x=>classes.delete(x));},toggle(x,v){if(v??!classes.has(x))classes.add(x);else classes.delete(x);},contains:x=>classes.has(x)};}
 matches(selector){return ['quality','volume'].includes(this.id)&&selector==='input,select';}
 blur(){} setAttribute(){} setPointerCapture(){} getContext(){return null;}
 showModal(){this.open=true;} close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
async function loadRig(){
 const raw=await readFile(new URL('../dist/assets/surfer-athlete.glb',import.meta.url));
 const length=raw.readUInt32LE(12),json=JSON.parse(raw.subarray(20,20+length));
 const at=20+length,bytes=raw.readUInt32LE(at);
 json.buffers[0].uri='data:application/octet-stream;base64,'+raw.subarray(at+8,at+8+bytes).toString('base64');
 for(const m of json.materials??[])delete m.pbrMetallicRoughness?.baseColorTexture;
 delete json.images;delete json.textures;
 return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
class Renderer {
 constructor({canvas}){this.domElement=canvas;this.shadowMap={};this.info={render:{calls:0,triangles:0}};}
 setPixelRatio(v){this.ratio=v;} setSize(w,h){this.domElement.width=w*this.ratio;this.domElement.height=h*this.ratio;}
 compile(){} render(scene,camera){this.scene=scene;this.camera=camera;scene.updateMatrixWorld(true);}
}

test('production keyboard/pointer handlers, frame loop, pause/resume and blur stay coherent',async t=>{
 const doc=new EventTarget(),win=new EventTarget(),elements=new Map(),buttons=[],audioGains=[];
 const param=()=>({value:0,target:0,setTargetAtTime(v){this.target=v;},setValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.target=v;}});
 win.AudioContext=class{
  constructor(){this.sampleRate=100;this.currentTime=0;this.destination={};}
  createGain(){const node={gain:param(),connect(){}};audioGains.push(node);return node;}
  createBuffer(channels,length){const data=new Float32Array(length);return{getChannelData:()=>data};}
  createBufferSource(){return{connect(){},start(){},stop(){}};}
  createBiquadFilter(){return{frequency:param(),connect(){}};}
  resume(){} suspend(){}
 };
 const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 for(const action of ['left','right','pump','jump','aura']){const e=new Element(action);e.dataset.input=action;buttons.push(e);}
 doc.body=new Element('body');doc.hidden=false;doc.activeElement=new Element();doc.getElementById=get;
 doc.querySelectorAll=selector=>selector==='[data-input]'?buttons:selector==='dialog[open]'?[...elements.values()].filter(e=>e.open):[];
 doc.querySelector=selector=>selector==='.brand'?get('brand'):selector==='dialog[open]'?[...elements.values()].find(e=>e.open)??null:null;
 const values={window:win,document:doc,innerWidth:1280,innerHeight:720,devicePixelRatio:1,
  matchMedia:()=>({matches:false}),localStorage:{getItem(){return null;},setItem(){}},
  setTimeout:cb=>{cb();return 1;},
  ProgressEvent:class extends Event{constructor(name,data){super(name);Object.assign(this,data);}},
  __TEST_THREE__:{...THREE,WebGLRenderer:Renderer}};
 const original={};for(const [key,value]of Object.entries(values)){original[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 let nextFrame=null,now=performance.now();original.requestAnimationFrame=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');globalThis.requestAnimationFrame=cb=>{nextFrame=cb;return 1;};
 t.after(()=>{for(const key of [...Object.keys(values),'requestAnimationFrame']){if(original[key])Object.defineProperty(globalThis,key,original[key]);else delete globalThis[key];}});
 t.mock.method(GLTFLoader.prototype,'loadAsync',loadRig);
 let source=await readFile(new URL('../dist/game.js',import.meta.url),'utf8');
 source=source.replace("import * as THREE from './vendor/three.module.js';",'const THREE=globalThis.__TEST_THREE__;');
 source=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL('../dist/'+path.slice(2),import.meta.url).href}'`);
 await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const state=()=>win.__SURF__.getState(),frame=(n=1)=>{for(let i=0;i<n;i++){now+=1000/60;nextFrame(now);}};
 const key=(type,code,repeat=false)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{code,repeat});win.dispatchEvent(event);};
 get('start').onclick();now=performance.now();frame(3);assert.equal(state().status,'playing');
 key('keydown','KeyE');frame(25);assert.equal(state().auraHeld,true);assert.equal(state().character.phase,'aura-balance');assert.ok(state().character.aura>.9);
 key('keyup','KeyE');frame(35);assert.equal(state().auraHeld,false);assert.ok(state().character.aura<.01);
 for(let repeat=0;repeat<4;repeat++){key('keydown','KeyE');frame(8);key('keyup','KeyE');frame(8);}assert.equal(state().controls.aura,false);
 key('keydown','KeyE');key('keydown','Space');frame(44);assert.ok(state().charge>.9);key('keyup','Space');frame(25);assert.equal(state().air,true);assert.equal(state().auraActive,true);assert.ok(state().auraDwell>0);
 get('sound').onclick();frame(2);assert.ok(audioGains[1].gain.target>0);
 key('keydown','KeyP');const paused=state();frame(120);assert.equal(state().status,'paused');assert.equal(audioGains[1].gain.target,0,'paused wind audio must mute even when visual updates stop');assert.equal(state().time,paused.time);assert.deepEqual(state().character,paused.character);assert.equal(state().controls.aura,false);assert.equal(state().charge,0);
 key('keyup','KeyE');key('keydown','KeyP');now=performance.now();frame(2);assert.equal(state().status,'playing');assert.equal(state().auraHeld,false);
 key('keydown','KeyE');frame(2);win.dispatchEvent(new Event('blur'));frame(20);assert.equal(state().status,'paused');assert.equal(state().controls.aura,false);
 get('resume').onclick();now=performance.now();frame(2);key('keydown','KeyE',true);frame(2);assert.equal(state().auraHeld,false,'repeat events after blur must not latch a released input');
 key('keyup','KeyE');key('keydown','KeyE');frame(2);assert.equal(state().auraHeld,true);
 get('settings-open').onclick();const settings=state();frame(20);assert.equal(state().time,settings.time);get('settings-dialog').close();now=performance.now();frame(2);assert.equal(state().status,'playing');assert.equal(state().controls.aura,false);
 get('quality').value='high';get('quality').onchange({target:get('quality')});assert.equal(state().lighting.mapSize,2048);
 get('quality').value='low';get('quality').onchange({target:get('quality')});assert.equal(state().lighting.shadows,false);
 get('pause').onclick();get('restart').onclick();now=performance.now();frame(2);assert.equal(state().status,'playing');assert.equal(state().crashes,0);assert.equal(state().controls.aura,false);
 const touch=buttons.find(b=>b.dataset.input==='aura');const pointer=(type,id)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:id});touch.dispatchEvent(event);};
 key('keydown','KeyE');pointer('pointerdown',3);frame(2);pointer('pointercancel',3);frame(2);assert.equal(state().auraHeld,true);key('keyup','KeyE');frame(2);assert.equal(state().auraHeld,false);
 get('pause').onclick();get('home').onclick();frame(2);assert.equal(state().status,'menu');assert.equal(state().controls.aura,false);
});
