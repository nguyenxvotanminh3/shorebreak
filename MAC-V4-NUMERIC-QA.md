# Full-v4 Mac numerical review

The exact full-v4 source ZIP was tested on Node26.4.0/macOS arm64. The recorded
result was267/270 passed, with three numeric/hash fixture failures. The same
assertions failed against the old local source. No assertion was edited on Mac.
All rig simulation and application-route tests passed; those application tests
use explicit renderer/DOM/loader stand-ins.

## Raw cross-environment diagnosis

The unchanged Mac exporter was replayed on cloud Node24.19 against separately
staged historical sources. The nine original world/simulation/Three source hashes
match across the environments. Seven world/lifecycle snapshots and fifteen
900-tick replays give identical discrepancy patterns:

- World:1 of71,702 matrix/color values differs: vault-mineral mesh233,
  instance19, matrix component9 is+0 on Mac versus−4.184620278531755e−18 on cloud.
  All instance translations and all colors match.
- Colliders:1 of1,940 fields differs. Collider217.y differs by
  3.552713678800501e−15m, exactly one Float64 ULP.
- Terrain/particle hashes, objectives and diving-bell location match.
- Replay:426 of10,800 values differ per run: z397, vz27, distanceSwum2.
  Maximum absolute difference is7.105427357601002e−15m. The final state differs
  only in z by8.881784197001252e−16m, one Float64 ULP.

ULP counts alone are misleading near zero: the matrix discrepancy is not
one ULP. The largest replay ULP count is376 near z≈0.00398, yet that difference
is only3.2612801348363973e−16m. The evidence establishes cross-environment numeric
variation without isolating the Node version, hardware, OS or a Math function.
There is no detected v4 placement/trajectory regression in these comparisons.

## Strict portable repair

Tests now evaluate independently frozen, provenance-pinned historical generators
on the same runtime, then compare exact geometry/data bytes and every historical
state field at each replay tick. Negative tests change values by one ULP and
must fail. Exact file-byte asset hashes remain unchanged. The fixtures ship in
tests/fixtures and work from a source ZIP without .git.

The newly authorized active-turn steering correction intentionally changes
turning behavior. Historical replay therefore covers fixed-heading movement,
control reversal and neutral free-look across five optional-world configurations;
the separate23 heading tests define the new active-turn contract. No broad
epsilon or platform-specific expected-hash whitelist hides changes.

Follow-up: the repaired v5 suite subsequently passed347/347 on Mac. The earlier
v4 result remains267/270; the later result belongs to its verified v5 ZIP.
Newer feature suites require their own separate device run.

## Browser limit

The exact-v4 isolated server ran on port4175. A combined Start/read-state browser
operation stalled for2228s despite a20s timeout, so no rig pixels, real entry/
drain/walk route, final console result or FPS measurement was established. A
late snapshot only confirmed far-rig/plant/jelly resources loaded, with neutral
input and one unattended rescue. It is not bounded gameplay/performance evidence.
Previous4173/4174 servers were no longer listening at the later terminal check.
