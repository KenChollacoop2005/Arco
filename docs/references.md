# References

One line per source or library, with its license.

## Libraries (vendored in `vendor/`)

- three.js 0.185.1, rendering and OrbitControls, MIT. https://github.com/mrdoob/three.js (0.185.1 is the newest release that ships minified builds. `OrbitControls.js` has one edit: its import points at `./three.module.min.js`.)
- Rapier 3D compat build 0.21.0, rigid body physics, Apache-2.0. https://github.com/dimforge/rapier.js
- manifold-3d 3.5.5, manifold booleans for printable solids, Apache-2.0. https://github.com/elalish/manifold

## Fonts (in `fonts/`, license files beside them)

- Big Shoulders Display, wordmark and headings, SIL Open Font License 1.1. https://github.com/xotypeco/big_shoulders
- IBM Plex Sans, interface text, SIL Open Font License 1.1. https://github.com/IBM/plex
- IBM Plex Mono, numbers and drawing labels, SIL Open Font License 1.1. https://github.com/IBM/plex

## Icon

- Brick emoji (1F9F1) from Twemoji, graphics licensed CC-BY 4.0. https://github.com/jdecked/twemoji

## Methods

- Block stacking (book stacking) overhang, (1/2)(1 + 1/2 + ... + 1/n) block lengths, used as the textbook answer for the stability tests. Paterson and Zwick, "Overhang", American Mathematical Monthly 116 (2009), section 1 covers the classic harmonic stack.
- Rigid block equilibrium with compression-only contacts, solved as a linear program. Livesley, "Limit analysis of structures formed from rigid blocks", International Journal for Numerical Methods in Engineering 12 (1978).
- Simplex method, phase one feasibility with Bland's rule against cycling. Chvatal, "Linear Programming" (1983), chapters 2 and 3.
