# Actual Mac motion review

Reviewed on 2 October 2026 using Apple M2, macOS27, Chrome154 and WebGL2 ANGLE
Metal. These results refer to motion commit229ad9d and its then-current creature
GLBs, before the subsequent Blender art replacement. The inspection page is an
isolated view of the actual production motion controllers and assets. It uses
flat terrain, custom lights, a synthetic observer and a body-following camera;
it does not replace a gameplay-route or performance test.

## Verified

- All178 supplied tests passed on Mac, with exact transfer hashes verified.
- Matching Side / Whole-body / High screenshots show long extended Kraken arms
  at wrapped phase2.018, then broad curled loops at phase5.755. This passes the
  requested large curl-versus-extension amplitude gate that the first candidate
  failed. Intermediate closeups show rounded curves without an obvious sharp
  joint hinge. Small hooks remain at the tips, but no longer define every pose.
- Paused phase/time stayed exactly constant across High→Medium. The lower-detail
  textured GLB rendered with18,000 rather than55,873 triangles; both use4 draws.
  Low was also displayed. This is tier switching, not world-distance traversal.
- Resumed player-response stimulus produced an articulated jet/evade state.
- Jellyfish in the recovered glide had normalized phase0.873, contraction0 and
  a fully reopened bell with laterally bent trails. The earlier actual game
  pass also captured changing bell and trail shapes from a stationary player.
- Earlier first-candidate actual-game probes confirmed exact stable idle world
  and camera coordinates, and zero release velocity by about0.31simulation
  seconds in rendered swim/sprint samples. Fixed90Hz source probes measure
  0.289s/0.258m swim coast and0.311s/0.410m sprint coast.

## Still unverified

No uninterrupted motion video is delivered. One bounded16-second WebM attempt
completed its visible UI cycle but produced no confirmed download event within
23seconds. Actual stills establish articulated poses; they do not prove that
all continuous transitions are free of rubbery motion. Jellyfish regional wake
reversal has numerical coverage but not yet a complete temporal pixel review.

Browser transport then disconnected. A final console check and additional
paired jelly squeeze image were not obtained. No new performance sample was
made. The user's original game tab was not operated during this isolated pass.

Further device checks remain: continuous closeup cycles, in-world encounters
and distance LOD, new art materials/vegetation, native held keys, pointer-lock
acceptance, physical touch, audio, and sustained frame pacing. Prior base-game
Mac results remain in MAC-QA.md; arms and water results have their own reports.
Blender source-art renders and numerical skin checks are separate evidence from
actual browser rendering of the newer art candidate.
