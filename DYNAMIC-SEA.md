# Changing sea conditions

Build: dynamic-sea-v8. The previous ink and island milestone is preserved.

The sea follows a deterministic four-minute calm → moderate → rough → moderate
cycle. The transition is a smooth cosine curve; the wave clock integrates speed
analytically so changing conditions do not snap the wave phase. Fresh dives start
calm. Pause freezes game time, waves, sky, ink and creature motion.

Three existing low-frequency swell bands change their amplitude, wavelength and
speed together. Wind-aligned fine normals, bounded whitecaps, cloud cover, sun
brightness, shallow caustics and existing water/wind audio follow the same state.
Deep-water weather-light influence decays exponentially with depth (26 m scale);
audio influence decays at 12 m. No new weather particles, lights, reflection
targets, texture downloads or postprocessing passes are introduced.

Safety and simulation scope

- This is an art-directed visual sea, not a fluid or storm-surge simulation
- The absolute offshore swell bound rises from 0.18 m to 1.9 m; the actual sum
  normally remains below that bound. These are not measured significant wave heights
- The visual mean is sea level zero. Waves are damped around dry island profiles
  and the research buoy, including a full coarse surface-cell guard around shores
- Swimming, wading, oxygen refill and dry-room gravity continue to use the existing
  mean water level. There is no horizontal wind/current force on the diver
- The deep rig's enclosed local water plane and interlocked doors remain independent
- Underwater optics still use analytical light fields rather than scene refraction

The water retains 8,192 triangles, one material/pass and at most 3/4/5 analytic
normal octaves for Low/Medium/High. The sky remains one 960-triangle shell. Shared
uniform objects and geometry are updated in place. Existing resolution, creature,
vegetation, ink, torch-shadow and culling budgets remain in force.

Inspection

/sea-review.html has ordinary buttons for Calm (0 s), Moderate (60 s), Rough
(120 s), continuous playback, four fixed cameras and three quality levels. It
uses the actual production water, sky and rooted island assets. /ink-review.html
and /island-review.html remain available. Inspection controls do not teleport
players in the game. The production HUD shows the current sea label in Vietnamese.

Verification

Pure-state, shader-contract, shoreline, depth, resource lifetime and production
pause/reset/idle controls are covered by automated checks. Their exact final
aggregate result is recorded in TESTING.txt. Node renderer stand-ins do not
compile GPU shaders or prove appearance.

The existing public URL was reachable in the cloud browser on 2026-10-03, but
that browser reported GL_VENDOR=Disabled and failed to create a WebGL context
even on the unchanged surfing build. No browser security settings were changed.
The new sea, ink, island and rig still require actual WebGL visual/device review;
older Mac screenshots and frame-cadence samples do not establish this build's
appearance, phone compatibility or frame rate.
