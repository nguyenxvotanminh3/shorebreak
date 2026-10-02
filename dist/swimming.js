// Deterministic world-space paths. Velocity is differentiated analytically so the
// nose follows the route, including turns; render and collision sample the same path.
import {sampleWater} from './water.js';
const surface={};
const patterns={
 shark:{speed:2.8,amplitude:6.1,frequency:.47,bob:.12},
 kraken:{speed:1.2,amplitude:3.7,frequency:.30,bob:.20},
 seaSerpent:{speed:2.2,amplitude:5.3,frequency:.40,bob:.15},
 jellyfish:{speed:.65,amplitude:2.8,frequency:.33,bob:.29},
};
export function sampleSwimPath(o,t,out){
 const p=patterns[o.type],age=t-o.born,phase=age*p.frequency+o.seed;
 // Drift with the travelling swell but actively swim across and along it.
 const z=o.spawnZ-p.speed*age+Math.sin(phase*.73)*1.4;
 const lateral=o.offset+Math.sin(phase)*p.amplitude;
 const vz=-p.speed+Math.cos(phase*.73)*1.4*p.frequency*.73;
 const swimX=Math.cos(phase)*p.amplitude*p.frequency;
 const currentX=(.72-vz*.035)/.23;
 out.x=(t*.72-z*.035+.4)/.23+lateral;out.z=z;
 out.vx=currentX+swimX;out.vz=vz;
 // Heading follows swimming relative to water, not the common ocean drift.
 out.heading=Math.atan2(-swimX,-vz);
 out.speed=Math.hypot(swimX,vz);
 out.turn=Math.max(-.18,Math.min(.18,-Math.sin(phase)*p.amplitude*p.frequency*p.frequency*.07));
 sampleWater(out.x,z,t,surface);
 out.y=surface.h-.06+Math.sin(age*1.45+o.seed)*p.bob;
 return out;
}
