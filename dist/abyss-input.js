const bindings={KeyW:'forward',KeyS:'back',KeyA:'left',KeyD:'right',Space:'up',ControlLeft:'down',ControlRight:'down',KeyC:'down',ShiftLeft:'sprint',ShiftRight:'sprint',KeyE:'scan',ArrowLeft:'turnLeft',ArrowRight:'turnRight',ArrowUp:'lookUp',ArrowDown:'lookDown'};
const actions=new Set(Object.values(bindings));
export function createDiveInput() {
 const keys=new Set(),pointers=new Map();
 return {
  handles:code=>Object.hasOwn(bindings,code),
  pointerHeld:action=>Array.from(pointers.values()).includes(action),
  key(code,on){
   if(!Object.hasOwn(bindings,code))return false;
   on?keys.add(code):keys.delete(code);
   return true;
  },
  pointer(id,action,on){
   if(on){if(actions.has(action))pointers.set(id,action);}
   // An old button's lost-capture event must not release a newer owner.
   // Keyboard and other pointers retain independent ownership of the action.
   else if(pointers.get(id)===action)pointers.delete(id);
  },
  clear(){keys.clear();pointers.clear();},
  read(){
   const a={};
   for(const k of keys)a[bindings[k]]=1;
   for(const p of pointers.values())a[p]=1;
   a.turn=(a.turnLeft||0)-(a.turnRight||0);
   a.tilt=(a.lookUp||0)-(a.lookDown||0);
   return a;
  }
 };
}
