# Kraken defensive ink

Build: kraken-ink-v6. This is the existing original octopod-like Kraken using
its real weighted mantle, head, eight articulated arms and modeled siphon.
No replacement creature asset or downloaded texture is needed.

## Encounter

A submerged player within 18 m for 0.25 s commits one defensive response:
0.45 s preparation, 0.5 s discharge, 3 s escape and 2 s recovery. The mantle
inflates then squeezes, the head recoils, gathered arms extend progressively
and the animal retreats. A second discharge requires both an 18 s cooldown
and separation to at least 28 m. These timings and giant scale are game design
choices, not measured animal constants. Surfacing prevents a new encounter but
does not freeze an already committed escape; pausing freezes the whole sequence.

The plume starts at the actual head-weighted aperture, transformed through the
skin inverse bind and current head pose. Its exported bind-space center is
(0, 1.915, -1.265). It initially follows the diagonal down/forward nozzle axis;
after 0.2 s its water-advection approximation bends gradually, with a capped
angle, toward the threat-facing direction. The plume stays in world space as
the creature leaves. No ink emerges from the mouth, arm tips or model origin.

Ink conceals; it causes no new poison, health or input penalty. Entering the
finite cloud reduces scene visibility, leaving HUD and controls available.
Swimming clear restores vision. The cloud thins and expires after 9.6–11.2 s.
New dives/menu return reset it, and disposal releases its resources once.

## Rendering budget

At most two pooled clouds, one instanced billboard draw, and 12/18/24 puffs per
cloud on Low/Medium/High: at most 48 quads/96 triangles. One shared procedural
material, no textures, downloads, render targets or additional lights. Opaque
scene depth clips billboard fragments. This uses bounded alpha blending and
analytic curling/dispersion, not a fluid solver or measured GPU optimization.
An inside-cloud HTML veil is driven only by local world density; it is cleared
outside the cloud and does not cover the HUD. No global persistent darkening.

The existing 90 Hz creature loop owns the state and event. LODs share the event,
phase and defensive envelopes. Bone overlays resample the authored channels
before applying a pose, preventing accumulation on pause and LOD switches.
Absent defensive inputs retain the previous bone poses exactly.

## Inspection

Open /ink-review.html on the local server. It loads both actual Kraken GLBs,
then offers fixed-time Prepare, Discharge, Escape, Disperse and Clear buttons.
Each replays the same production code at 90 Hz and pauses, so screenshots do
not require held keys or debugger access. The inside-cloud button places only
the review camera in the emitted volume. It does not teleport the gameplay
player. Saved WebGL PNGs exclude HTML overlays; use an ordinary browser
screenshot to include the review HUD and inside-cloud veil.

The automated suite covers trigger/range/hysteresis/timing, real deformed skin,
nozzle-to-aperture attachment, regional curl/extension, actual full/low GLB
agreement, no repeated emission during pause, world-space release, escape,
visibility recovery, exact reset/disposal and stable resource budgets.
Application tests use explicit DOM/renderer/bitmap/loader stand-ins. They are
not rendered-pixel, shader-compilation or FPS evidence.

The cloud browser inventory now exposes Chromium, but its documented tab API
blocked http://127.0.0.1:4186/ink-review.html with net::ERR_BLOCKED_BY_CLIENT.
No alternate UI route was used to bypass it. Actual ink visual QA remains open.
The previous v5 source passed 347 tests on Mac, and its named sonar return was
photographed. Those results are not new ink-pixel acceptance or a close-object
flashlight/rig-traversal acceptance.

## Research basis and limits

- Monterey Bay Aquarium describes mantle contraction, siphon jet propulsion
  and defensive ink as a temporary visual barrier:
  https://www.montereybayaquarium.org/animals-the-ocean/animals-a-to-z/giant-pacific-octopus
- Waikīkī Aquarium distinguishes the siphon and the mouth among the arms, and
  describes mucus-rich defensive ink as a distraction:
  https://www.waikikiaquarium.org/experience/animal-guide/invertebrates/molluscs/octopus/
- Flexible-funnel escape steering is also documented in squid research; this
  is cephalopod inspiration, not an exact octopus specification:
  https://journals.biologists.com/jeb/article/219/18/2870/15425/Multiple-sensory-modalities-used-by-squid-in
- MBARI documents varied deep-sea squid ink shapes and cautions that intentional
  mimicry is unknown:
  https://annualreport.mbari.org/2022/story/out-of-the-darkness-of-the-deep-inky-clouds-take-shape

No poison effect, perfect decoy animal, exact fluid physics or measured biological
cloud lifetime is claimed. No push, merge or deployment is included.
