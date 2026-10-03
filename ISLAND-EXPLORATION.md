# Đảo Vân: shore, forest and mountain

Build: island-ecosystem-v7, continuing the committed Kraken ink milestone.
The main island lies southeast of the research buoy, centered at world(115,155).
Follow its known ĐẢO VÂN / BỜ CÁT marker and compass distance, surface, swim to
sand, then follow the broad rising trail. The player can walk to the54m summit
and return to swimming. A separate15m islet lies around(-90,170).

The islands are original terrain and Blender art. Existing reef objectives,
diving bell and deep rig remain intact. Their terrain samples, and every sample
outside the two island influence regions, stay exactly unchanged.

## Continuous movement

A single terrain sampler provides physics height, gradients, terrain geometry,
plant roots and ecology. Eight main-island shore bearings support swimming,
shallow-water wading, grounded walking and the reverse transition. The main
trail is about246m long, with a4m usable corridor. The allowed walking slope
is.55 rise/run (about28.8 degrees); steeper cliffs reject the uphill component
while preserving tangent movement. Space does not fly or climb arbitrary walls.

Gravity applies on dry ledges and across island boundaries until water entry.
Standing height changes continuously, rather than teleporting the camera onto
land. Grounded movement settles exactly after release. Full feet-to-head overlap
catches low shrubs and rocks, and their pushout cannot bypass a steep cliff.
The existing indoor airlock and ocean movement retain their prior contracts.

On land the first-person hands remain visible, lower into a carrying pose and
use small speed-linked walking motion rather than swimming strokes. Above-water
views gain a daylight sky and lighter distance haze; underwater lighting stays
on the existing water path. The HUD changes depth to elevation and identifies
sand, coastal forest, slope or summit. Oxygen refills in air as before.

Collision uses terrain plus simple solid trunk/rock proxies, not leaf-level
mesh collision or hand contact IK. Physics uses mean sea level, not individual
visual wave crests. Some render interpolation remains: the measured triangle
surface must stay within7.5cm of the analytic floor along the tested4m routes.

## Original ecosystem and budgets

The3,511,260-byte Blender pack contains15 plant/rock variants with full and low
meshes: three palms, two pandanus, coastal broadleaf, two canopy trees, two
shrubs, fern, dune grass and three rocks. All share one opaque512px atlas.
UV1 stores rooted wind flexibility and leaf phase; it does not tint the atlas.
The combined pack contains23,388 full-detail and3,538 low-detail triangles.
It loads once on proximity, then named prototypes are instanced and cached.
Terrain and low-cost silhouettes remain usable while the asset is loading or
if loading fails.

The final seeded layout has794 sites:515 on the main island and279 on the islet,
with555 solid proxies. A gentle6.3m islet sand shelf supports coastal planting.
Shore, coast, slope and highland bands use different vegetation, with slope and
walking-path clearance checks. The renderer selects only a nearby subset:

- High: at most500 visible instances,80 full-detail
- Medium: at most320 visible instances,40 full-detail
- Low: at most180 visible instances, all low-detail
- At most30 island draw calls including five terrain tiles (37,646 triangles)
- One additional960-triangle daylight sky draw above water

LOD hysteresis, distance culling, shared materials and reusable buffers avoid
recreating the ecosystem each frame. Rooted wind includes a normal correction.
No alpha-card sorting, new sunlight shadow map, reflection target or downloaded
sky texture is added. These are concrete budgets, not measured FPS results.

## Verification and review

Automated checks traverse all eight coasts, the complete summit route and
return, and the smaller islet. They cover cliffs, gravity, low obstacles,
release/free-look stability, camera continuity and30/60/120Hz schedules. One
application test starts at the buoy and uses production keyboard/drag handlers
for beach→summit→ocean, with renderer/DOM/loader stand-ins explicitly identified.
Actual GLB parsing independently checks all30 prototypes, rooted geometry,
UV1 data, opaque shared atlas, resource disposal, tier budgets and stable updates.

/island-review.html offers ordinary buttons for water, beach, forest, summit
and overview camera inspection, plus a continuous physics-driven shore route.
It uses the same terrain, prototype renderer, arms and movement code. Inspection
view changes are review-only; the gameplay route never teleports onto the island.

Two separate Blender previews use the exported runtime terrain and all placed
prototypes. They show the full layout, whereas the game uses the bounded nearest
subset above. They are not browser screenshots, shader compilation evidence,
native-input validation or performance measurements.

Actual ink/island browser visual QA remains pending: cloud Chromium local-page
navigation returned net::ERR_BLOCKED_BY_CLIENT, and that route was not bypassed.
Earlier Mac v5 tests and sonar screenshots do not validate this newer island.
No push, merge or deployment is included.

Final validation:435/435 tests pass in the cloud source checkout. Syntax and
relative imports for all runtime modules, exact-byte HTTP assets/MIME, and
git diff --check also pass. Actual browser ink/island review is still pending.
