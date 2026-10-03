# Frozen same-runtime regression fixtures

These are historical test oracles, never runtime imports. Keep their numeric
generation code frozen. A deliberate baseline change must receive a separate
review; do not regenerate these from current production code to fix a failure.

## Why execute a baseline rather than store a cross-machine numeric hash?

The full-v4 source suite passed on cloud Node 24.19.0 but reported three fixture
failures on macOS arm64 Node 26.4.0: the old-ocean replay's final Z differed by
one Float64 ULP, and two tests rejected generated instance-buffer SHA-256s.
The Mac report also found identical older-source, motion-v2 and v4 numeric
outputs on that Mac. A collider JSON hash would have failed next. At the time
this repair was made, raw cross-machine arrays had not yet been compared;
these facts do not establish the magnitude or exact mathematical source of the
world-buffer differences.

The tests now run independent, pinned pre-change generators in the same engine
as the implementation. Every replay tick and the world data are compared exactly.
There is no epsilon, rounding, platform exception or alternative-hash allowlist.
The current simulation/world is not used to generate its own expected answer.
Negative checks prove that even a one-ULP placement, collider, geometry or
trajectory change remains unequal. All shipped asset-file SHA checks are intact.

## World generator

- Original: `dist/abyss-world.js`
- Commit: `229ad9d755dd94493ef3f180eef1f917a61218c0`
- Git blob: `064e1715ae190f655c5f00be062905894cab1941`
- Original complete source SHA-256:
  `1b7f36efc621d9a10e0404b245aa4b120f40ea0ed3c3f3dcc9482a198c426202`
- Fixture: `abyss-world-229ad9d.mjs`

Extraction retains original lines 5–70, 77, 121–289 and 304–307. It keeps all
terrain, geometry, seeded placement/color, collider, landmark and particle
generation expressions in their original order, including random draws for
non-instanced landmark scenery. The Three import points to the bundled vendor.
Shader decoration is replaced by an identity function; particles use a plain
material. A small return/disposal wrapper exposes and releases the data.
Fog, surface/shafts, shader text, frame updates and quality handling are omitted
because they do not generate the compared habitat data. No water helper is
required by this extraction.

The test compares terrain, instance and particle buffer SHA-256s produced by
both versions in the same process, plus the exact numeric collider, objective
and air-bell data. It additionally fingerprints every original habitat/landmark
geometry attribute and index, including typed-array shape. Imported vegetation,
the water surface and light shafts are outside this historical fixture's scope.

## Ocean simulation

- Original: `dist/abyss-sim.js`
- Commit: `283be2aa4079dd7f1b91f184a1fb3dddab9e3abf`
- Git blob: `b34e6f16d5fb7a648a35c8873c3b83d1cc4aace9`
- Original complete source SHA-256:
  `92b0a70baf1e21482339990aaa643780c7f2b3cdf48567a5e879040e8db4ac93`
- Fixture: `abyss-sim-283be2a.mjs`

Extraction retains original lines 1–7, 13–14, 16–19, 21, 23 and 26–91. It keeps
the complete old `stepDive`, original constructor, constants and reachable
helpers unchanged. Unused location, start/reset, sonar and persistence exports
are omitted. This fixture has no imports or dependencies on the current sim.

The interior test compares all original state fields after every one of the
900 ticks for each of five ocean configurations: 300 sprint/diagonal ticks,
300 fixed-heading reverse/strafe ticks, then 300 released free-look ticks.
It checks exact stopped velocity and new swim-state fields separately.
Active turning intentionally changed with input-owned steering; the independent
heading suite tests that new contract. The historical fixture therefore covers
unchanged fixed-heading acceleration/reversal and released braking/free look,
rather than freezing the obsolete active-turning behavior into a new golden.

## Dependency and extraction verification

The world generator uses the already vendored Three.js r170 module; that file
is identical at both baseline commits and the repair's source HEAD. It is
pinned by a separate source-integrity test so a later vendor change cannot
silently change both sides of the comparison:

- Path: `dist/vendor/three.module.js`
- Git blob: `282d1087068fab752a7e59b65aaa61c8b0a4be8c`
- SHA-256: `08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7`

During extraction, on cloud Node 24.19.0, a one-off comparison against the full
historical source verified exact data for all 387 retained mesh/point nodes
and 388 colliders, including geometry, transforms, matrices/colors, objectives
and the air bell. The extracted ocean sim matched the complete original state
at every one of 900 replay ticks. This is extraction validation, not a Mac pass.

The shipped tests read only fixture and vendor files. They require no Git
history, shell commands, network, browser, or separately installed Three package,
so the same checks run from a source ZIP. Fixture source hashes are pinned in
`../abyss-baseline-fixtures.test.mjs`.
