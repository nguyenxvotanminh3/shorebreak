# Movement evidence and implementation choices

This prototype uses bounded, species-specific animation and kinematics. It does
not solve fluid dynamics, muscle mechanics or real pressure physiology.

## Octopod-inspired Kraken

[Gutfreund et al., 1996](https://pmc.ncbi.nlm.nih.gov/articles/PMC6578955/) describes
localized bend propagation from an octopus arm's base toward its tip. The arm is
a muscular hydrostat, rather than a rigid limb with fixed elbow joints.
[Kinematic decomposition and classification, 2013](https://www.frontiersin.org/journals/computational-neuroscience/articles/10.3389/fncom.2013.00060/full)
examines arm extension, bends and the combination of motion primitives.

[Sfakiotakis et al., 2015](https://pubmed.ncbi.nlm.nih.gov/25970151/) studies an
octopus-inspired robotic swimmer with a fast sculling power stroke and slower
recovery. It distinguishes arm-swimming from siphon jetting. Robot velocities
and timing are not claimed as calibrated animal values here.

Implementation inference: the fictional Kraken's eight existing seven-joint
chains have a localized unrolling front, a slower returning curl, brief glide,
individual phase variation and steering asymmetry. The authored bent rest pose
is actively unwound, rather than merely rotated or wiggled. A mantle squeeze
and root acceleration share a pulse clock. Scale and cycle timing are authored
for an approximately 15 m fictional animal, not extrapolated biological data.
Bone lengths stay fixed; no true muscle-volume or sucker-contact simulation.

## Jellyfish

[Gemmell et al., 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3816424/) separates
bell contraction, refilling and an interpulse period, including passive energy
recapture in studied medusae. [Gemmell et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29180601/)
finds that the use of this mechanism varies with swimming kinematics. The duty
cycle is not universal across jellyfish species.

Implementation inference: our moon-jelly-inspired bell contracts chiefly at the
margin, reopens and has a quiet open glide. Flexible trailing tissue follows
with regional delay. Cascaded velocity memory lets the tip retain the preceding
wake direction briefly during a turn. Oral-arm curvature changes with delayed
pulse flow; tentacles are not presented as synchronized swimming oars. No vortex
solver or physical energy-recapture measurement is claimed.

## Shark and fish

[Bonnethead shark turning study, 2019](https://academic.oup.com/iob/article/1/1/obz014/5520954)
reports coordinated body bending and pectoral changes in shark turning.
Implementation uses increasing posterior wave excursion, differential pectoral
trim and curved steering. Schooling fish must face the derivative of their
actual path; this is covered separately by a travel-tangent regression.

## Visual acceptance

Numerical nonzero joint changes are insufficient. Review a full visible cycle
from a stable camera: Kraken curled → moving bend → extended → recurl; jelly
open → contracted → reopened → quiet glide; shark several tailbeat poses. Then
check turns, response and full/low LOD in the actual game. The isolated
motion-review.html page uses the production drivers and assets, but is explicitly
a review harness, not gameplay footage or a performance benchmark. Its optional
WebM recorder captures only the local rendered canvas and labels that distinction.
