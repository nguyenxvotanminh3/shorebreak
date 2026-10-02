const bindings={KeyW:'forward',KeyS:'back',KeyA:'left',KeyD:'right',Space:'up',ControlLeft:'down',ControlRight:'down',KeyC:'down',ShiftLeft:'sprint',ShiftRight:'sprint',KeyE:'scan',ArrowLeft:'turnLeft',ArrowRight:'turnRight',ArrowUp:'lookUp',ArrowDown:'lookDown'};
export function createDiveInput() {
 const keys=new Set(),pointers=new Map();
 return {handles:code=>!!bindings[code],pointerHeld:action=>Array.from(pointers.values()).includes(action),key(code,on){if(bindings[code]){on?keys.add(code):keys.delete(code);return true;}return false;},pointer(id,action,on){on?pointers.set(id,action):pointers.delete(id);},clear(){keys.clear();pointers.clear();},read(){const a={};for(const k of keys)a[bindings[k]]=1;for(const p of pointers.values())a[p]=1;a.turn=(a.turnLeft||0)-(a.turnRight||0);a.tilt=(a.lookUp||0)-(a.lookDown||0);return a;}};
}
