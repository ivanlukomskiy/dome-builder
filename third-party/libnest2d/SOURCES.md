# Browser libnest2d build

The DXF exporter uses libnest2d's NFP placer and first-fit selector, with its
Clipper geometry backend and NLopt optimizer. It runs in a dedicated Web Worker.
The checked-in `src/vendor/libnest2d/nesting.js` and `nesting.wasm` are generated
from `nesting.cpp`. Ordinary `npm run build` does not need a C++ compiler or
registry authentication.

## Rebuild or replace the library

Activate [Emscripten 4.0.15](https://github.com/emscripten-core/emsdk), with CMake
3.31.6 and Ninja 1.11.1 on PATH, then run:

```sh
npm run build:nesting
npm test -- src/lib/dxfNesting.integration.test.ts
npm run build
```

`build.sh` downloads pinned source releases into `/tmp/dome-nesting-native-source`
(override with `NESTING_BUILD_DIR`). It compiles the unmodified upstream sources
with our small wrapper. To replace libnest2d, change its pinned revision and
rebuild. The wrapper is licensed LGPL-3.0-or-later. No proprietary components or
private registries are required.

| Component | Source revision | License |
| --- | --- | --- |
| libnest2d | [663daa69e1d7478669f714218e27681edbc96640](https://github.com/tamasmeszaros/libnest2d/tree/663daa69e1d7478669f714218e27681edbc96640) | LGPL-3.0 |
| Clipper 6.4.2 | [784ff113071f1fa7832ebe74667f2fd0756c634f](https://github.com/tamasmeszaros/libpolyclipping/tree/784ff113071f1fa7832ebe74667f2fd0756c634f) | Boost Software License 1.0 |
| NLopt 2.7.1 | [09b3c2a6da71cabcb98d2c8facc6b83d2321ed71](https://github.com/stevengj/nlopt/tree/09b3c2a6da71cabcb98d2c8facc6b83d2321ed71) | See bundled NLopt notices |
| Boost 1.85.0 | [Source archive](https://archives.boost.io/release/1.85.0/source/boost_1_85_0.tar.bz2) | Boost Software License 1.0 |
| Emscripten 4.0.15 runtime | [Source](https://github.com/emscripten-core/emscripten/tree/4.0.15) | MIT / University of Illinois-NCSA |

License notices are distributed with the site in `public/third-party/libnest2d/`.

## Geometry contract

- Packing uses conservative convex envelopes, with circular arcs bounded by
  tangent intersections (maximum excess 0.02 mm before integer rounding).
  Concave recesses and holes are not used as nesting space.
- Input coordinates use 1,000,000 integer units/mm, matching libnest2d's backend.
  Sheet dimensions, margins and spacing are final millimeters, independent of
  the export scale. Only part geometry and labels are scaled.
- Allowed rotations are 0, 90, 180, 270 degrees. No mirroring or grain inference.
- The engine returns a sheet, rotation about the origin, and translation for
  every original part. Original DXF curves, holes and labels are transformed
  together; the packing envelope is never exported as a cut line.
- A separate TypeScript validator checks completeness, sheet margins, overlaps
  and Euclidean spacing before any download. The 0.0002 mm comparison tolerance
  includes the DXF writer's four-decimal coordinate precision.
- Cancellation terminates the worker. A five-minute limit prevents an endless
  native search. Any error aborts the arranged export; there is no fallback that
  silently drops parts or exports an incomplete layout.
- Different part kinds currently share sheets, matching the export's existing
  all-parts workflow. Material/thickness grouping is not inferred.
