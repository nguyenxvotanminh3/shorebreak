import * as THREE from './vendor/three.module.js';
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

// Warden's actual rig has single-bone legs, with no knee/ankle chain. It stays
// planted while breathing, watching and warning; this does not fake a walk cycle.
export function createWardenMotion(model, clips) {
  const bones = new Map(); model.traverse(o => { if(o.isBone) bones.set(o.name.replace(/[^a-z0-9]/gi,'').toLowerCase(),o); });
  const touched = ['pelvis','chest','head','jaw','armL','armR','forearmL','forearmR','handL','handR','tail1','tail2','tail3','tail4','tail5','legL','legR'];
  const records = [], recordByName = new Map(), q = new THREE.Quaternion(), euler = new THREE.Euler(), inverse = new THREE.Quaternion();
  model.updateMatrixWorld(true);
  for (const name of touched) {
    const bone = bones.get(name.toLowerCase()); if(!bone)continue;
    const record = {name,bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone(),up:new THREE.Vector3(0,1,0).applyQuaternion(bone.getWorldQuaternion(inverse).invert()),tracks:[]};
    for(const track of clips[0]?.tracks || []){
      const split=track.name.lastIndexOf('.'), node=track.name.slice(0,split), property=track.name.slice(split+1);
      if(node===bone.name&&['position','quaternion','scale'].includes(property))record.tracks.push({property,interpolant:track.createInterpolant()});
    }
    records.push(record);recordByName.set(name,record);
  }
  let disposed=false,phase=0,alert=0;
  const rotate=(name,x,y,z)=>{const record=recordByName.get(name);if(!record)return;q.setFromEuler(euler.set(x,y,z,'XYZ'));record.bone.quaternion.multiply(q).normalize();};
  const yaw=(name,angle)=>{const record=recordByName.get(name);if(!record)return;q.setFromAxisAngle(record.up,angle);record.bone.quaternion.multiply(q).normalize();};
  function update(dt,motion){
    if(disposed)return;phase=motion.phase||0;alert=clamp(motion.alert||0,0,1);
    for(const record of records){const b=record.bone;b.position.copy(record.position);b.quaternion.copy(record.quaternion);b.scale.copy(record.scale);for(const track of record.tracks)b[track.property].fromArray(track.interpolant.evaluate(motion.clipTime||0));}
    const breath=Math.sin(phase),turn=clamp(motion.headTurn||motion.turnRate||0,-.5,.5);
    const chest=recordByName.get('chest');if(chest){chest.bone.scale.x*=1+breath*.025;chest.bone.scale.z*=1+breath*.033;}
    rotate('pelvis',Math.sin(phase*.5)*.012,turn*.08,Math.sin(phase*.5)*.012);
    rotate('chest',breath*.018-alert*.035,0,-turn*.055);yaw('chest',turn*.18);
    rotate('head',-.025+Math.sin(phase*.7)*.028+alert*.09,0,Math.sin(phase*.43)*.014);yaw('head',turn*.65);
    rotate('jaw',-.018-Math.max(0,Math.sin(phase*.65))*.025-alert*.07,0,0);
    for(const [side,sign]of [['L',1],['R',-1]]){
      rotate('arm'+side,-.025+Math.sin(phase*.63+sign)*.025-alert*.13,sign*alert*.035,sign*(.018+alert*.07));
      rotate('forearm'+side,Math.sin(phase*.63+sign-.3)*.025+alert*.14,0,sign*alert*.025);
      rotate('hand'+side,Math.sin(phase*.63+sign-.6)*.035-alert*.07,0,sign*.015);
      rotate('leg'+side,Math.sin(phase*.5+sign*Math.PI/2)*.006,0,sign*breath*.004);
    }
    for(let i=1;i<=5;i++)rotate('tail'+i,Math.sin(phase*.7-i*.65)*(.018+i*.01),0,Math.sin(phase*.7-i*.68)*(.025+i*.018)+turn*.035);
  }
  return {update,dispose(){disposed=true;records.length=0;recordByName.clear();bones.clear();},snapshot:()=>({mappedBones:records.length,phase,alert,stance:'planted sentinel; no knee/ankle rig'})};
}
