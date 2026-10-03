// Analytic island terrain shared by mesh generation, ecology and player contact.
// The original reef sampler remains the exact answer outside these two ellipses.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const freezePoint=p=>Object.freeze(p);

export const ISLAND_BOUNDS=Object.freeze({minX:-215,maxX:240,minZ:-420,maxZ:280});
export const ISLAND_MAX_SLOPE=.55;
export const ISLAND_LAYOUT=Object.freeze({
 main:Object.freeze({x:115,z:155,radiusX:95,radiusZ:100,peak:54}),
 islet:Object.freeze({x:-90,z:170,radiusX:45,radiusZ:45,peak:15})
});

function polar(island,r,angle){return{x:island.x+Math.cos(angle)*island.radiusX*r,z:island.z+Math.sin(angle)*island.radiusZ*r};}
function radial(island,x,z){return Math.hypot((x-island.x)/island.radiusX,(z-island.z)/island.radiusZ);}
function influenceAt(island,x,z){return 1-smooth(.92,1,radial(island,x,z));}
export function sampleIslandInfluence(x,z){return Math.max(influenceAt(ISLAND_LAYOUT.main,x,z),influenceAt(ISLAND_LAYOUT.islet,x,z));}

// Cubic Hermite knots specify real slopes, avoiding concentric staircase edges.
// Between r=.70 and .88, all eight approaches have gentle, walkable sand.
const profile=Object.freeze([
 [0,54,0],[.10,54,0],[.30,39,-105],[.50,18,-85],
 [.64,4,-40],[.72,2,-25],[.84,-1,-25],[.92,-4.5,-70],[1,-12,-70]
]);
// A six-metre sand shelf supports low coastal plants. The inner knoll and outer
// approach stay below .55 slope; the 15m summit and route are unchanged.
const isletProfile=Object.freeze([
 [0,15,0],[.04,14.51,-24.5],[.54,2.26,-24.5],[.60,1.39,-4.5],
 [.74,.76,-4.5],[.80,-.11,-24.5],[.92,-3.05,-24.5],[1,-5.01,-24.5]
]);
function sampleProfile(r,knots){
 if(r<=0)return knots[0][1];
 for(let i=1;i<knots.length;i++)if(r<=knots[i][0]){
  const [a,ha,ma]=knots[i-1],[b,hb,mb]=knots[i],span=b-a,t=(r-a)/span,t2=t*t,t3=t2*t;
  return(2*t3-3*t2+1)*ha+(t3-2*t2+t)*span*ma+(-2*t3+3*t2)*hb+(t3-t2)*span*mb;
 }
 return knots.at(-1)[1];
}
const mainProfile=r=>sampleProfile(r,profile);

// The coastal approach becomes a broad curling trail. Continuous curvature and
// shallow grade make a real route to the summit; surrounding crags stay steep.
const pathNodes=[];
for(let i=0;i<=12;i++){
 const r=mix(.90,.72,i/12),p=polar(ISLAND_LAYOUT.main,r,-2.1);
 pathNodes.push({...p,height:mainProfile(r)});
}
for(let i=1;i<=160;i++){
 const t=i/160,r=mix(.72,.08,t),angle=-2.1+5.3*smooth(0,1,t),p=polar(ISLAND_LAYOUT.main,r,angle);
 pathNodes.push({...p,height:mix(2,54,smooth(0,1,t))});
}
for(let i=1;i<=8;i++){
 const p=polar(ISLAND_LAYOUT.main,.08*(1-i/8),3.2);
 pathNodes.push({...p,height:54});
}
// Arc-length weighting keeps the smooth trail height independent of point density.
for(let i=0;i<pathNodes.length;i++){
 const p=pathNodes[i],a=pathNodes[Math.max(0,i-1)],b=pathNodes[Math.min(pathNodes.length-1,i+1)];
 p.weight=(Math.hypot(p.x-a.x,p.z-a.z)+Math.hypot(b.x-p.x,b.z-p.z))*.5;
 Object.freeze(p);
}
Object.freeze(pathNodes);
export const ISLAND_SAFE_PATH=Object.freeze(pathNodes.map(({x,z})=>freezePoint({x,z})));
export const ISLET_SAFE_PATH=Object.freeze(Array.from({length:33},(_,i)=>freezePoint(polar(ISLAND_LAYOUT.islet,.88*(1-i/32),-Math.PI/2))));
export const ISLAND_SEA_ENTRIES=Object.freeze(Array.from({length:8},(_,i)=>{
 const bearing=i*Math.PI/4;
 return Object.freeze({bearing,direction:freezePoint({x:Math.cos(bearing),z:Math.sin(bearing)}),
  water:freezePoint(polar(ISLAND_LAYOUT.main,.88,bearing)),beach:freezePoint(polar(ISLAND_LAYOUT.main,.70,bearing))});
}));

function distanceToPath(x,z,points){
 let distanceSquared=Infinity;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
  const t=l2?clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1):0;
  const qx=x-a.x-dx*t,qz=z-a.z-dz*t;
  distanceSquared=Math.min(distanceSquared,qx*qx+qz*qz);
 }
 return Math.sqrt(distanceSquared);
}
export function distanceToIslandPath(x,z){return Math.min(distanceToPath(x,z,pathNodes),distanceToPath(x,z,ISLET_SAFE_PATH));}
function pathHeight(x,z){
 let weightedHeight=0,weight=0;
 // A compact C3 kernel yields a smooth local regression along the curved path.
 for(const p of pathNodes){
  const d2=(x-p.x)**2+(z-p.z)**2;
  if(d2>=64)continue;
  const w=(1-d2/64)**4*p.weight;weightedHeight+=p.height*w;weight+=w;
 }
 return weight>0?weightedHeight/weight:null;
}

function islandHeight(island,x,z){
 const r=radial(island,x,z),angle=Math.atan2(z-island.z,x-island.x);
 if(island===ISLAND_LAYOUT.islet){
  // Broad low island, with a sandy skirt and a small vegetated central knoll.
  return sampleProfile(r,isletProfile);
 }
 const ridgeBand=smooth(.12,.25,r)*(1-smooth(.48,.65,r));
 const ridges=(Math.sin(angle*3+r*12)*2.8+Math.cos(angle*5-r*8)*1.2)*ridgeBand;
 let height=Math.min(island.peak,mainProfile(r)+ridges);
 const distance=distanceToPath(x,z,pathNodes);
 if(distance<7.5){
  const trail=pathHeight(x,z);
  if(trail!==null)height=mix(height,trail,1-smooth(3.5,7.5,distance));
 }
 return height;
}

/** Base sampler is required; no renderer dependency or second seabed formula. */
export function sampleIslandTerrain(x,z,baseHeightFn){
 const base=baseHeightFn(x,z);
 for(const island of Object.values(ISLAND_LAYOUT)){
  const influence=influenceAt(island,x,z);
  if(influence>0){const height=islandHeight(island,x,z);return influence===1?height:mix(base,height,influence);}
 }
 return base;
}

/** Upward unit normal and rise/run slope from the same analytic terrain. */
export function sampleIslandNormal(x,z,baseHeightFn){
 const e=.04,gx=(sampleIslandTerrain(x+e,z,baseHeightFn)-sampleIslandTerrain(x-e,z,baseHeightFn))/(2*e);
 const gz=(sampleIslandTerrain(x,z+e,baseHeightFn)-sampleIslandTerrain(x,z-e,baseHeightFn))/(2*e),length=Math.hypot(gx,1,gz);
 return{x:-gx/length,y:1/length,z:-gz/length,slope:Math.hypot(gx,gz)};
}

export function biomeAt(x,z){
 let island=null;
 for(const candidate of Object.values(ISLAND_LAYOUT))if(radial(candidate,x,z)<1){island=candidate;break;}
 if(!island)return'ocean';
 const r=radial(island,x,z),height=islandHeight(island,x,z);
 if(r>.9)return'ocean';
 if(height<=2.8)return'shore';
 if(height<=10)return'coast';
 return height<34?'slope':'highland';
}

export function sampleIslandEnvironment(player,baseHeightFn){
 const {x,z}=player;
 if(sampleIslandInfluence(x,z)<=0)return null;
 const floorY=sampleIslandTerrain(x,z,baseHeightFn),normal=sampleIslandNormal(x,z,baseHeightFn);
 return{outdoors:true,ground:true,floorY,ceilingY:Infinity,waterLevel:0,maxSlope:ISLAND_MAX_SLOPE,
  gradientX:-normal.x/normal.y,gradientZ:-normal.z/normal.y,normal:{x:normal.x,y:normal.y,z:normal.z},biome:biomeAt(x,z)};
}
