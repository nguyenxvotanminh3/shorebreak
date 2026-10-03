# Rig07: enterable deep-sea facility

An original fictional seafloor drilling/maintenance habitat, approximately
140×100×70m. Its foundation is at(45,−128.77,−335); the entry is about109m deep.
The new southern basin starts beyond the old reef boundary. Original terrain,
seeded habitat, objectives and collider fingerprints inside that reef remain
unchanged. The three-scan expedition is preserved; the facility is an optional
explorable destination marked by sonar/proximity and completion.

## Play

Swim south toward “GIÀN KHOAN /07”. Enter the open flooded intake. Look at the
left chamber panel and pressE to request the dry side. The outer leaves close,
the water visibly falls, and the inner leaves open. Walk through the vestibule,
corridor and control room into the machinery gallery. Return to the lock and
use the right panel to flood it and open the sea side. The vestibule/exterior
panels can call the chamber from their own side. R reverses toward the last
fully opened safe side. Move clear of a doorway if its obstruction warning shows.

The prototype uses a fictional pressure-protected suit and a short game cycle.
It does not simulate real decompression or describe a safe real diving procedure.

## Actual mechanics

- Four named sliding leaves and independent world-space collision boxes
- One serialized close→transfer→equalize→open state machine, about7.8s per cycle
- Never both doors open; fill/drain only while both are fully sealed
- Occupied closing thresholds reopen; repeatedE cannot restart or stack actions
- A real local water plane moves between18.05 and22.8m above the foundation
- Head-relative water sensing, smooth standing height, gravity and walking
- Oxygen refills only with the head in actual air; flooding restores swimming
- Real room/furniture barriers and an unobstructed0.65m-radius route
- Pausing freezes the cycle; rescue/new dive reset the appropriate state safely
- Normal entry and exit use physical movement, without teleporting
- The separate emergency tether rescue still returns the diver to the buoy

The main floor contains the traversable chain. Upper industrial decks and
auxiliary pods are exterior/scenic structure, not additional advertised rooms.
Fine decorative pipes/rails do not all have mesh-exact collision. There is no
contact IK for the diver's arms. The local water surface is a lightweight visual
approximation without captured-scene refraction or a full fluid simulation.

## Concrete rendering budgets

Far:2,476triangles/12primitives/133,960bytes. Medium:47,000/44/1,254,256bytes.
Full:136,036/47/3,839,176bytes. Static detail is consolidated by shared material
and interior/exterior category. These exports use original modeled detail and
PBR material values, without additional texture downloads or transmission passes.

Far loads within370m, Medium within190m, Full only on High within110m. LODs are
cached after loading; all share the same door fractions. Low/Medium do not force
Full inside. The fallback uses pooled collision-shell geometry. Four local
lights are distance-limited indoors, and at most32 droplets occupy one draw.
The southern extension adds32 distance-culled terrain tiles/25,600triangles.
These are measured asset/code budgets, not measured browser frame times.

## Verification

270 complete source tests pass. New coverage includes22 lock-state checks,
21 indoor-physics checks,18 rig integration checks,2 basin checks, one complete
production-entrypoint route and one nested-asset integrity check.

The numerical diver completes repeated intake→lock→control→machinery→lock→sea
trips, including one with actual GLTF-loaded exports. Two repeated trips covered
18,053fixed steps; maximum camera movement per tick was0.064422m, vertical
0.035556m. Both doorway obstruction directions, closed doors, console collisions,
refill, pause, recovery, loading/disposal and30/60/120Hz agreement are covered.

A separate application test starts at the research buoy and uses the real
keyboard/drag handlers for the whole approach, E drainage, pause/resume, walking,
R reversal and exit. Its renderer, bitmap and GLB fixtures are explicitly mocked;
it is not a browser-pixel claim. Actual GLBs are separately structurally parsed.
Local HTTP smoke checks served the entrypoint, modules and all new assets with
correct MIME types. Blender exterior, approach, dry/flooded lock, control and
machinery renders were inspected, including a clean EEVEE doorway view.

The later exact-v4 Mac run passed267/270 tests; three brittle cross-environment
numeric fixtures were diagnosed and repaired (MAC-V4-NUMERIC-QA.md). Its browser
Start/read operation stalled for2228s, so no rig pixels or real traversal were
verified. A new Mac terminal run of the repaired suite remains pending.
Actual integrated lighting, water-plane appearance, held native inputs, continuous
creature motion video and sustained performance remain open device checks.
Earlier actual Mac creature-pose evidence is recorded separately and must not
be represented as validation of the new facility. No push, merge or deployment.

## Research basis

The structure combines original industrial rig and subsea equipment cues from
[Transocean's fleet](https://www.deepwater.com/our-fleet/rig-types),
[SLB's subsea field overview](https://www.slb.com/-/media/files/oilfield-review/defining-subsea-infrastructure.ashx)
and[OneSubsea manifolds](https://www.onesubsea.slb.com/products-and-services/subsea-field-development/subsea-production-systems/subsea-manifolds).
The occupied submerged megastructure is fictional. Real ambient-pressure
moonpool habitats such as[Aquarius](https://sanctuaries.noaa.gov/missions/2010aquarius/meet_aquarius.html)
are not the same mechanism as this game's sealed drainable lock. Source photos
were references only; no operator photographs or another game's geometry are
embedded in the assets.
