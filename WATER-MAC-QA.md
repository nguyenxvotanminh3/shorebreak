# Water surface — actual Mac findings

Date: 2026-10-02. Chrome 154 / macOS 27.0 / Apple M2 ANGLE Metal WebGL2, 1470 × 745 viewport. The two-file optical preview and both supplied references were inspected. Gameplay, portrait arms and Continue fixes were preserved.

## Verified and corrected

The new surface compiled and rendered at all quality levels without captured shader/console warnings or errors. Actual views included upward at 9.67 m, near-vertical and grazing/horizon angles, time-separated waves, upward/nearby structure at 38.98 m, horizon near 49–54 m, and downward from above the surface.

The original top face incorrectly used water-to-air refraction and therefore selected total internal reflection when viewed from air. The verified patch identifies the geometric side, uses the reciprocal air-to-water ratio, and renders reflected procedural sky above the surface. Reloaded browser pixels showed the correction. Water tests passed 9/9 and that Mac build's complete suite passed 88/88. The later creature/drift changes are a separate candidate and are not included in those Mac conclusions.

## Visual limitations

Irregular dark wave streaks and an overhead light window are visible; nearby geometry and blue distance are readable. Shallow overhead light still looks paler/whiter than the stronger cyan in the supplied underwater reference, with relatively broad hard-edged streaks. The result is approximate single-pass water, not photographic optics.

The surface remains opaque. Its refraction/reflection field is procedural; it does not transmit actual submerged objects or hands when seen from above, nor perform a fully physical waterline crossing. This limitation is not hidden by the air-side fix.

## Frame-cadence observations

Seven-second visible-page rAF samples initially averaged about 54.86 FPS for shallow upward Medium, 54.14 FPS for deeper upward Medium, and 57.14 FPS near the diving bell. Later second-tab samples varied from about 24.74 High to 37.20 Medium and 57.00 Low, with large scheduling stalls.

Those later rows were contaminated by another live game tab and interactive desktop activity. They are not a valid patch A/B or reliable tier comparison and do not prove a shader regression. None of these numbers are GPU timer-query measurements or a sustained 60 FPS guarantee. Future checks use a dedicated QA tab/handle, avoid operating the user's gameplay tab, and distinguish concurrent-tab load.

## Original drift/motion observations

Before the new locomotion work, clean-tab no-input position was exactly stable. Neutral pause/resume and blur/resume did not reproduce stuck controls. Release did show the old long exponential glide and the camera had idle bob. Earlier shared-tab route automation also moved the view, so those shared interactions cannot be attributed wholly to a game defect. The helpers were stopped and all keys released before the new fixes were tested.

Shark tail/fin animation was present, but only one cruise loop. Kraken motion was a subtle idle and Warden used a standing threat clip on a moving orbit. No jellyfish were instantiated in the first-person scene. These findings motivate the separate species articulation and finite-stop candidate; see CREATURE-MOTION.txt.

No merge, deployment or new feature push accompanied this QA.
