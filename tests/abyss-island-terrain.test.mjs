import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainHeight as base} from '../dist/abyss-world.js';
import {ISLAND_BOUNDS,ISLAND_LAYOUT,ISLAND_MAX_SLOPE,ISLAND_SAFE_PATH,ISLET_SAFE_PATH,ISLAND_SEA_ENTRIES,
 sampleIslandTerrain,sampleIslandNormal,sampleIslandEnvironment,sampleIslandInfluence,distanceToIslandPath,biomeAt} from '../dist/abyss-island-terrain.js';

const height=(x,z)=>sampleIslandTerrain(x,z,base);
const normal=(x,z)=>sampleIslandNormal(x,z,base);
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b} within ${e}`);
const pointAt=(island,r,angle)=>({x:island.x+island.radiusX*r*Math.cos(angle),z:island.z+island.radiusZ*r*Math.sin(angle)});
function along(a,b,fn,steps=25){for(let i=0;i<=steps;i++){const t=i/steps;fn({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},i);}}

test('island extension preserves every original reef/objective/rig sample exactly',()=>{
 assert.deepEqual(ISLAND_BOUNDS,{minX:-215,maxX:240,minZ:-420,maxZ:280});
 for(let x=-220;x<=240;x+=7)for(let z=-420;z<=55;z+=5){
  assert.equal(sampleIslandInfluence(x,z),0);assert.equal(height(x,z),base(x,z));assert.equal(sampleIslandEnvironment({x,z},base),null);
 }
 // Bit-for-bit preservation also applies to arbitrary caller-owned terrain.
 const foreign=(x,z)=>Math.sin(x*.17)*3+Math.cos(z*.23)*9-40;
 for(let x=-230;x<=250;x+=9)for(let z=55;z<=290;z+=7)if(sampleIslandInfluence(x,z)===0){
  assert.equal(sampleIslandTerrain(x,z,foreign),foreign(x,z));assert.equal(height(x,z),base(x,z));
 }
 for(const [x,z] of [[-25,-38],[44,-102],[-18,-180],[0,-345],[0,18]])assert.equal(height(x,z),base(x,z));
});

test('seabed joins, beach profile and trail shoulders have continuous finite heights and unit normals',()=>{
 for(const island of Object.values(ISLAND_LAYOUT))for(let i=0;i<64;i++){
  const angle=i*Math.PI/32;
  for(const r of [.10,.30,.50,.64,.72,.84,.92,1]){
   const a=pointAt(island,r-1e-6,angle),b=pointAt(island,r+1e-6,angle);
   assert.ok(Math.abs(height(a.x,a.z)-height(b.x,b.z))<.002,`continuous join at ${r}`);
  }
  const edge=pointAt(island,1,angle);near(height(edge.x,edge.z),base(edge.x,edge.z),1e-12);
 }
 for(let x=-140;x<=215;x+=6)for(let z=55;z<=260;z+=6){
  const n=normal(x,z),h=height(x,z);assert.ok(Number.isFinite(h)&&Object.values(n).every(Number.isFinite));
  near(Math.hypot(n.x,n.y,n.z),1,1e-12);assert.ok(n.y>0);near(n.slope,Math.hypot(n.x,n.z)/n.y,1e-10);
 }
});

test('all eight sea approaches are sandy, shallow and safely traversable both ways',()=>{
 assert.equal(ISLAND_SEA_ENTRIES.length,8);
 for(const entry of ISLAND_SEA_ENTRIES){
  assert.ok(height(entry.water.x,entry.water.z)<-2);assert.ok(height(entry.beach.x,entry.beach.z)>2);
  assert.equal(biomeAt(entry.beach.x,entry.beach.z),'shore');
  for(const [a,b] of [[entry.water,entry.beach],[entry.beach,entry.water]])along(a,b,p=>{
   const n=normal(p.x,p.z),environment=sampleIslandEnvironment(p,base);
   assert.ok(n.slope<ISLAND_MAX_SLOPE,`entry ${entry.bearing} has slope ${n.slope}`);
   assert.equal(environment.floorY,height(p.x,p.z));assert.equal(environment.waterLevel,0);assert.equal(environment.ceilingY,Infinity);
  },100);
 }
});

test('a continuous wide walking trail reaches the 54m summit without cliff climbing',()=>{
 let length=0,lastHeight=-Infinity,maxSlope=0;
 assert.ok(height(ISLAND_SAFE_PATH[0].x,ISLAND_SAFE_PATH[0].z)<-2);
 for(let i=1;i<ISLAND_SAFE_PATH.length;i++){
  const a=ISLAND_SAFE_PATH[i-1],b=ISLAND_SAFE_PATH[i],dx=b.x-a.x,dz=b.z-a.z,segment=Math.hypot(dx,dz);length+=segment;
  along(a,b,p=>{
   const h=height(p.x,p.z);assert.ok(h>=lastHeight-.025,`trail reverses unexpectedly at ${i}`);lastHeight=h;
   near(distanceToIslandPath(p.x,p.z),0,1e-10);
   // Four metres of clear usable width, wider than the diver's 1.3m body.
   for(const offset of [-2,-1,0,1,2]){
    const x=p.x-dz/segment*offset,z=p.z+dx/segment*offset,slope=normal(x,z).slope;maxSlope=Math.max(maxSlope,slope);
    assert.ok(slope<=ISLAND_MAX_SLOPE,`trail ${i} offset ${offset} slope ${slope}`);
   }
  },5);
 }
 assert.ok(length>230&&length<270);assert.ok(maxSlope>.3);
 const summit=ISLAND_SAFE_PATH.at(-1);near(summit.x,ISLAND_LAYOUT.main.x);near(summit.z,ISLAND_LAYOUT.main.z);near(height(summit.x,summit.z),54,1e-9);
 let cliffs=0;
 for(let x=55;x<=175;x+=5)for(let z=95;z<=220;z+=5)if(height(x,z)>5&&distanceToIslandPath(x,z)>8&&normal(x,z).slope>1)cliffs++;
 assert.ok(cliffs>15,'off-trail ridges must still form a mountainous island');
});

test('the separate low islet has an unobstructed gentle route from water to its 15m peak',()=>{
 assert.ok(height(ISLET_SAFE_PATH[0].x,ISLET_SAFE_PATH[0].z)<-2);
 for(let i=1;i<ISLET_SAFE_PATH.length;i++)along(ISLET_SAFE_PATH[i-1],ISLET_SAFE_PATH[i],p=>{
  assert.ok(normal(p.x,p.z).slope<ISLAND_MAX_SLOPE);near(distanceToIslandPath(p.x,p.z),0,1e-10);
 });
 near(height(ISLAND_LAYOUT.islet.x,ISLAND_LAYOUT.islet.z),15);
});

test('the islet sand shelf has enough gentle ground for coastal plants at every bearing',()=>{
 for(let i=0;i<32;i++)for(const radius of [.61,.64,.67,.70,.73]){
  const p=pointAt(ISLAND_LAYOUT.islet,radius,i*Math.PI/16),n=normal(p.x,p.z);
  assert.ok(height(p.x,p.z)>.7);assert.ok(Math.atan(n.slope)*180/Math.PI<12);
  assert.equal(biomeAt(p.x,p.z),'shore');
 }
});

test('environment gradients and ecology use the same final terrain as contact and rendering',()=>{
 const points=[{x:115,z:155},{x:173.9,z:155},{x:189.1,z:155},{x:-90,z:170},ISLAND_SAFE_PATH[80]];
 for(const p of points){
  const e=sampleIslandEnvironment(p,base),n=normal(p.x,p.z);
  assert.equal(e.outdoors,true);assert.equal(e.ground,true);assert.equal(e.floorY,height(p.x,p.z));assert.equal(e.maxSlope,.55);
  near(e.gradientX,-n.x/n.y);near(e.gradientZ,-n.z/n.y);assert.equal(e.biome,biomeAt(p.x,p.z));
 }
 assert.equal(biomeAt(115,155),'highland');assert.equal(biomeAt(189.1,155),'shore');assert.equal(biomeAt(0,-38),'ocean');
 const classifications=new Set();for(let x=25;x<210;x+=5)for(let z=60;z<250;z+=5)classifications.add(biomeAt(x,z));
 assert.deepEqual([...classifications].sort(),['coast','highland','ocean','shore','slope']);
 const snapshot=points.map(p=>[height(p.x,p.z),normal(p.x,p.z),biomeAt(p.x,p.z)]);
 assert.deepEqual(points.map(p=>[height(p.x,p.z),normal(p.x,p.z),biomeAt(p.x,p.z)]),snapshot);
});
