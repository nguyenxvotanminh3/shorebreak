# First-person diver arms — actual Mac verification

Date: 2026-10-02. The tested preview contained the same rig/controller/entrypoint as local candidate `3dc8ad132a1f4aedee3a8bf79728a68c10077fa5`, before the portrait correction below. Its three runtime hashes were verified before overlaying the existing Continue-fixed game. The final portrait patch was reloaded and checked in the real browser, then integrated into this source.

## Environment and input method

Chrome 154, macOS 27.0, Apple M2 / ANGLE Metal / actual WebGL2. Landscape viewport 1470 × 745, DPR 2, Medium drawing buffer 1764 × 894. Portrait checks used a desktop viewport override, not a physical phone.

Native clicks and flashlight presses were exercised. Sustained movement and scan used DOM KeyboardEvents on the real canvas handlers because the browser automation API could not hold native keys. Real-time simulation, collision and WebGL rendering continued normally; no teleport or direct state mutation was used.

## Observed actions

- Both hands render; final asset reports 16,794 triangles, 37 bones, one material/geometry and one added draw call
- Idle, swim, sprint and scan were inspected at several animation times, including distinct stroke phases
- Swim weight reached 0.988 after 0.8 s of forward movement; sprint reached 0.999 after acceleration
- Release blended through swim and reached idle 0.997 after another 1.2 s
- Held E near Bãi Kính reached scan 0.998 and nearly 1.0; release returned to idle 0.999 after 0.9 s
- Pause kept the entire arm snapshot unchanged; Home hid the rig; Start reset it to idle near animation time zero
- Held descent against the actual seabed produced resolved speed below 1e-9 and idle arms
- A separate actual-simulation/controller probe confirmed stationary wall stopping; the browser's oblique pedestal attempt slid around the object and is not represented as a stationary wall-stop pass
- At 64 m depth both hands remained visible with the torch off
- No browser warnings/errors appeared in this arm-specific session

## Portrait correction

The original small forward offset clipped most palms at 390 × 844. The fix derives extra depth translation from the measured animated palm envelope and camera aspect, blends in below square, and caps adaptation at 320 × 844. It does not scale/distort the anatomy or change landscape placement. Collision probes extend to the extra reach and withdraw that added offset near solids.

Reloaded real screenshots confirmed both palms fit at 390 × 844 in idle and sprint, and at 320 × 844 in idle. Returning to landscape restored the original composition. Portrait hands are smaller because they are farther from the camera.

Source regressions additionally project actual skinned palm vertices across all four clips at 30 Hz and all nine extreme/neutral sway combinations. Sampled palms stay within 90% horizontal/vertical bounds at 390 × 844, 320 × 844 and 9:16. Landscape offsets remain unchanged, and wall/floor checks remove the added extension. These are numerical projection tests, separate from the actual screenshot checks.

## Performance observations

Independent visible-page `requestAnimationFrame` samples, seven seconds each:

| Scene | Mean interval | Approx. FPS | Median | p95 | Maximum | Frames |
|---|---:|---:|---:|---:|---:|---:|
| Medium, 64 m, initial arms candidate | 17.28 ms | 57.86 | 16.70 ms | 18.70 ms | 100.10 ms | 405 |
| Medium, 5 m reef, portrait-corrected build | 18.52 ms | 54.00 | 16.70 ms | 33.30 ms | 116.90 ms | 378 |

The final reef sample ended at 194 draw calls, 164,581 triangles and 850 particles. The arm mesh adds one draw call and 16,794 triangles. These different scenes are not a controlled A/B test. The measurements include browser/desktop scheduling, are not GPU timer queries, and do not guarantee 60 FPS or whole-map performance.

## Automated coverage

The Mac preview intentionally contained runtime files only. The existing Mac suite passed 60/60 and separately ran actual-GLB/controller and portrait projection probes; its old app fixtures omit arm clips, so it did not independently reproduce the newer source suite. The full source checkout now passes 79/79, including the loaded-arm app fixtures, 17 controller/real-asset/portrait tests and collision-blocked input regressions.

## Remaining visual limits

At a near-vertical downward view while resting on the seabed, ordinary depth testing can hide most of the hands and leave a forearm edge visible. Retraction is approximate and is not full contact IK. The portrait patch avoids extending farther into the obstacle but does not solve this extreme contact pose. Do not describe the rig as universally clipping-free.

The existing right-mounted torch strongly brightens the right hand. This is an observed lighting imbalance, not a shader/asset load failure. No unverified lighting or contact-pose tweak was added after the Mac checks.

Successful pointer-lock acceptance, physical held-key input, physical phone/touch, audio output and prolonged multi-device play remain separate follow-up checks. The local server was left on loopback and Chrome returned to the title screen with normal viewport. No push, merge or deployment accompanied this arm work.
