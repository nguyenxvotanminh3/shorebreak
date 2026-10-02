// Swept sphere against an ellipsoid. Used after transforming into animal space.
// The inflated radii model a forgiving board/limb thickness, never a whole-animal circle.
export function sweptEllipsoid(ax,ay,az,bx,by,bz,e,radius){
 const rx=e.rx+radius,ry=e.ry+radius,rz=e.rz+radius;
 const x=(ax-e.x)/rx,y=(ay-e.y)/ry,z=(az-e.z)/rz;
 const dx=(bx-ax)/rx,dy=(by-ay)/ry,dz=(bz-az)/rz;
 const length=dx*dx+dy*dy+dz*dz;
 const t=length>1e-12?Math.max(0,Math.min(1,-(x*dx+y*dy+z*dz)/length)):0;
 return (x+dx*t)**2+(y+dy*t)**2+(z+dz*t)**2<=1;
}
// Five samples follow the shortboard and two follow the surfer's torso. The board
// capsule is narrow; a nearby fin or tail can pass beside it without phantom hits.
const hull=[[-.72,.02,.19],[-.36,.02,.19],[0,.02,.19],[.36,.02,.19],[.72,.02,.19],[0,.42,.23],[0,.88,.22]];
export function intersectsCreature(a,b,old,newer,colliders){
 const ca=Math.cos(old.heading),sa=Math.sin(old.heading),cb=Math.cos(newer.heading),sb=Math.sin(newer.heading);
 const cta=Math.cos(old.turn||0),sta=Math.sin(old.turn||0),ctb=Math.cos(newer.turn||0),stb=Math.sin(newer.turn||0);
 const ya=a.yaw||0,yb=b.yaw||0,sya=Math.sin(ya),cya=Math.cos(ya),syb=Math.sin(yb),cyb=Math.cos(yb);
 for(let i=0;i<hull.length;i++){
  const h=hull[i],z=h[0],height=h[1],r=h[2];
  const ax=a.x+sya*z-old.x,az=a.z+cya*z-old.z;
  const bx=b.x+syb*z-newer.x,bz=b.z+cyb*z-newer.z;
  const lx0=ca*ax-sa*az,lz0=sa*ax+ca*az,ly0=a.y+height-old.y;
  const lx1=cb*bx-sb*bz,lz1=sb*bx+cb*bz,ly1=b.y+height-newer.y;
  for(let j=0;j<colliders.length;j++)if(sweptEllipsoid(cta*lx0+sta*ly0,-sta*lx0+cta*ly0,lz0,ctb*lx1+stb*ly1,-stb*lx1+ctb*ly1,lz1,colliders[j],r))return true;
 }
 return false;
}
