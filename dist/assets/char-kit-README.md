# char-kit

16 rigged MakeHuman characters, each shipping **66 animation clips** on a shared
22-bone UE5-named rig. One `.glb` per character — drop it in, you have the body and
every animation. 1056 working character × clip combinations.

Built from [npcforge](https://github.com/MMWilliams/npcforge), which generates the
MakeHuman bodies and retargets the motion capture.

![kick_roundhouse landing on hit_head_02 at the measured contact time](viewer/preview.jpg)

*`viewer/index.html` — `kick_roundhouse` → `hit_head_02` held at contact (t = 0.833 s).*

```
characters/*.glb    16 characters, each = mesh + rig + all 66 clips
manifest.json       every character, clip, and fight-sync timing, machine-readable
viewer/index.html   browse any character × clip; preview synced fights
tools/              reproducible build + verification
AGENTS.md           integration guide written for an AI coding agent
```

## Quick start

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltf  = await new GLTFLoader().loadAsync('characters/mh_3183.glb');
const mixer = new THREE.AnimationMixer(gltf.scene);

const clip = gltf.animations.find(c => c.name === 'punch_hook_right');
mixer.clipAction(clip).play();
scene.add(gltf.scene);
```

That's the whole integration. The clips are inside the character file, so there is no
cross-file binding and no retargeting step.

**If you are an AI agent implementing this, read [AGENTS.md](AGENTS.md)** — it has the
clip table, a gameplay-state → clip map, the fight-sync protocol, and the mistakes that
silently break this kit.

## The rig

22 bones, UE5 Mannequin names, identical on every character:

```
root → pelvis → spine_01 → spine_03 → neck_01 → head
                         → clavicle_l/r → upperarm_l/r → lowerarm_l/r → hand_l/r
       pelvis  → thigh_l/r → calf_l/r → foot_l/r → ball_l/r
```

Metres, Y-up, characters face **+Z**, 30 fps. Because the names match the UE5 Mannequin,
Unreal's IK Retargeter drives them from Manny with no hand mapping.

## Why each character carries its own clips

The obvious design is one shared clip library plus N character meshes. It does not work
here, and the failure is silent.

These clips animate `pelvis` with an **absolute translation in metres**, and the bodies
range from a 0.71 m hip height to 1.06 m — a 48% spread. Playing a clip baked for the
tall body on the short one plants its hips 35 cm in the air; the character moonwalks
above the floor with the pose otherwise intact, so it reads as a physics bug rather than
an asset one. Per-body clips are correct by construction.

The cost is ~1.3 MB of duplicated animation per character. `tools/verify.py` checks the
`idle` pelvis track against each body's own rest hip height, so this can't regress.

## Clips

66 per character, grouped by `manifest.json → packs`:

| pack | n | contents |
|---|---|---|
| `locomotion` | 12 | idle, walk, run, jump, 4 strafes, 4 turns |
| `generic` | 12 | sprint, crouch-sneak, low crawl, slide, roll, stairs, climb, fall-to-land |
| `fight` | 28 | 9 attacks, 7 hit reactions, block + 4 dodges, fight idle, defeat, get-ups, death, stealth-kill pair |
| `shooter` | 14 | rifle aim/fire/reload/run/jump/walk/strafes, grenade, hit reaction, death, pistol |

Each clip in `manifest.json` carries `duration`, `loop`, `root_motion`, and a measured
**`speed_mps`** — drive locomotion at that speed with `timeScale = 1` and the feet do not
slide.

## Synced hit / get-hit

`manifest.json → sync_pairs` pairs every attack with a reaction and says **when to start
the second clip so the reaction lands on the blow** — measured from the animation data,
not guessed. Contact = peak extension of the striking limb; onset = when the victim's
head actually starts moving.

```json
{
  "attacker": "kick_roundhouse",
  "victim":   "hit_head_02",
  "impact_time": 0.8333,
  "reaction_onset": 0.125,
  "attacker_start_delay": 0.0,
  "victim_start_delay": 0.7083,
  "separation_m": 0.8808,
  "separation_ratio": 1.0239,
  "strike_bone": "ball_r"
}
```

Both delays are non-negative — start each clip at its own delay:

```js
const p = manifest.sync_pairs.find(x => x.attacker === 'kick_roundhouse');
victim.position.z = p.separation_ratio * attackerHipHeight;   // scales with body size
victim.rotation.y = Math.PI;                                  // face the attacker
setTimeout(() => play(attacker, p.attacker), p.attacker_start_delay * 1000);
setTimeout(() => play(victim,   p.victim),   p.victim_start_delay   * 1000);
```

Exactly one delay is ever non-zero. Usually it's the victim's, but `punch_uppercut` →
`hit_knockout` inverts it: that reaction has a 1.08 s wind-up before the head moves, so
the **attacker** waits instead.

Use `separation_ratio * hip_height_m` rather than `separation_m`: reach scales with body
size, and `separation_m` is measured on the reference body only (`manifest.sync_reference`).

Two extras:

- **`extra_contacts`** — combos land more than once. `punch_jab_cross` reports its primary
  contact at 0.458 s (the cross) plus one at 0.2 s (the jab), so you can trigger two reactions.
- **`native_pairs`** — `stealth_kill_attacker` / `stealth_kill_victim` were authored together
  and are already frame-locked. Spawn both at the *same* transform and start together.

## Viewer

Serve the repo — `file://` will not work, as the browser blocks loading `manifest.json`
and the GLBs over that scheme:

```bash
python -m http.server 8123      # then open http://localhost:8123/viewer/
```

**Single** browses any character × clip. **Synced duel** plays a pair with a live contact
marker. Views are URL-addressable:

```
?char=mh_3183&clip=punch_hook_right
?duel=6&at=0.833                 # seek a pair to 0.833s and hold there
?axes=1&cam=3.4,1.5,0.5          # axis gizmo, camera position
```

## Verify / rebuild

```bash
python tools/verify.py .        # no Blender needed; exits non-zero on failure
```

Checks each character has all 66 clips and exactly 22 bones, that no clip collapsed to a
static pose, that channels only target real bones, and that the pelvis track matches that
body's own hip height.

Rebuilding needs npcforge checked out, plus Blender 5.0 and Pillow:

```bash
python tools/build.py --npcforge ../npcforge --out .
python tools/optimize_glb.py "characters/*.glb" --max-size 768
blender --background --factory-startup --python tools/analyze_sync.py -- --out .
python tools/make_manifest.py .
```

`tools/clips.py` is the curated list — npcforge exports 243 clips, this kit selects 66.
Add a line there and rebuild to include more.

### Making it smaller

Characters are ~5.5 MB each: roughly 45% texture, 35% mesh, 20% animation.
`--max-size 512` takes the set from 87 MB to about 60 MB and still looks fine at gameplay
distance. `optimize_glb.py` re-encodes textures to JPEG, keeps PNG only where alpha is
genuinely used, and converts materials that claim `BLEND` but have a fully opaque texture
to `OPAQUE` — MakeHuman marks everything `BLEND`, which is both larger and wrong, since
it disables depth-write.

## What was verified

- `verify.py` passes on all 16 characters: 22 bones, 66 clips, no dead clips, hips correct.
- Every GLB round-trips through Blender's importer with skinning and materials intact.
- The three.js path is exercised by `viewer/index.html` (the screenshot above is a
  headless render of it).
- The Unreal/Unity notes come from the rig naming and file structure, not a built project.

## Credits and licensing

Characters are **MakeHuman**/MPFB2 output — MakeHuman's meshes and its bundled assets are
released under CC0. Generated by [npcforge](https://github.com/MMWilliams/npcforge).

The motion is third-party motion capture retargeted onto this rig. Check the licence of
your own animation sources before redistributing a build of this kit.
