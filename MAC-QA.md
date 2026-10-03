# Vực Lặng — actual Mac browser QA

Date: 2026-10-02. Original game tree: `9b7aeb621024a97fc7ea096e03a486acaf71d817`, published as `18ee6d6628191bcd4795ef3d8e80d804d98beeb1` before this fix. This report summarizes the local Mac QA evidence and patch; no personal filesystem path or task-session identifier is needed to reproduce the checks.

## Environment and method

- Local loopback server: `node server.cjs` at `http://127.0.0.1:4173/`
- Node 26.4.0 arm64, Chrome 154, macOS 27.0, Apple M2
- Real WebGL2: ANGLE Metal Renderer / Apple M2
- CSS viewport 1470 × 745, devicePixelRatio 2
- Drawing buffer: High 2352 × 1192; Medium 1764 × 894; Low 1176 × 596
- No deployment, app/package installation, credential or system-setting change was required

Native browser clicks, native drag and single F/Q key presses were exercised. The automation API did not support a held native key event. Sustained movement and scanning therefore used DOM KeyboardEvents directed at the actual canvas handlers, while the ordinary real-time simulation, collisions and real WebGL renderer continued running. There was no teleport, direct simulation-state mutation or substitute renderer in that route.

## Verified outcomes

The original Node suite passed 59/59. After the Continue fix, affected tests passed 24/24 and the Mac full suite passed 60/60 with no failures/skips. The same 60 tests were subsequently rerun in the source checkout.

- Title screen, underwater terrain, sea, caustics, vegetation, fish, instruments and HUD rendered
- All six creature asset variants reached ready; textured/skinned shark, kraken and kaiju rendered without observed shader, WebGL or GLB-loading errors
- Native drag changed orientation; F toggled the torch and Q started sonar and exposed distant markers
- Held-event W route moved 13.3 m in about 2.5 seconds with normal inertial slowdown after release
- Oxygen decreased underwater; ascent refilled the tank to 150
- All three locations were reached through the actual terrain and scanned using held E events
- Bãi Kính was banked first; all three samples were subsequently brought to the buoy and the UI displayed completed exploration
- The air bell was entered from below and restored oxygen from 142.18 to 150 at about (44.93, −36.74, −99.95), still 36 m underwater
- Pause froze simulation time and oxygen; resume, Home and fresh Start worked
- Reload + Continue restored banked data; after the fix it immediately displayed the completed/free-exploration objective
- Quality changes adjusted drawing-buffer sizes, geometry workload and LOD without observed missing models

## Fix included here

`restoreProgress` now derives completion from the validated banked sample IDs. Previously a completed saved dive restored its samples but initially showed an unfinished objective until reaching the buoy again. The application regression checks completed-save Continue, no repeated completion notification, and fresh-start reset. README wording now accurately describes scan progress decaying on release rather than requiring one uninterrupted hold.

## Short frame-cadence samples

Seven-second `requestAnimationFrame` samples at the same stationary viewpoint near Khe Thở/Warden, with the visible browser and gameplay running. No screenshot or UI action occurred within each sample; creature animation advanced naturally between samples.

| Tier | Frames | Mean interval | Approx. FPS | Median | p95 | Maximum | End draw calls / triangles |
|---|---:|---:|---:|---:|---:|---:|---:|
| High | 388 | 18.04 ms | 55.44 | 16.70 ms | 32.50 ms | 84.0 ms | 74 / 153,952 |
| Medium | 399 | 17.54 ms | 57.01 | 16.70 ms | 17.60 ms | 184.0 ms | 68 / 95,290 |
| Low | 405 | 17.28 ms | 57.86 | 16.70 ms | 17.70 ms | 50.0 ms | 51 / 55,628 |

These are frame-cadence measurements, not GPU timer-query results, CPU render-duration samples or a whole-map benchmark. Short samples and other desktop activity can cause outliers. An earlier moving Medium reef sample averaged 20.83 ms, about 48 FPS, over 2.5 seconds. No steady 60 FPS guarantee follows from these results.

## Remaining limits

Pointer lock remained false after Start and the explicit lock button in this automation session; successful pointer-lock acceptance still needs manual verification. Drag fallback worked. No physical-phone/touch, physical held-key, audio-output or long-session whole-map performance QA was performed. Node tests separately cover additional blur, rescue, cancellation, storage and context-loss edges; those are not presented as new physical-device checks.

An early test harness probe incorrectly sent a KeyboardEvent to `window`, causing `event.target.matches` to be absent. The probe was corrected to target the canvas, and no further application-origin errors appeared during the complete route. The report does not claim a completely empty console.

The temporary route helper was removed by reload. QA-created progress was cleared, quality returned to Auto and the title screen was left ready for a fresh dive.
