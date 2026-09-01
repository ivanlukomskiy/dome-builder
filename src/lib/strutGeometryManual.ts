import { draw } from 'replicad'
import type { Drawing, Point2D } from 'replicad'
import type * as THREE from 'three'
import type { ToothParams } from './strutGeometry'

// A sandbox for hand-building computeStrutBoundary's replacement directly with replicad's own
// 2D primitives (draw(), .cut()/.fuse()/.intersect(), etc.) instead of the hand-rolled Vec2 math
// in strutGeometry.ts - see the "Strut Shape Debug" tool (`npm run strut-shape-debug`). Safe to
// break, safe to rewrite completely: nothing else in the app imports this file, so experimenting
// here can't touch the working Preview pipeline or the /edge-sketch debug page. The real,
// load-bearing implementation stays at `computeStrutBoundary` in strutGeometry.ts - treat this as
// a second opinion you're building by hand, not a patch to the original.
//
// Same parameter list as computeStrutBoundary (so this stays a drop-in replacement candidate),
// but you don't have to wire up all of them right away - the debug page's sidebar exposes every
// one of them regardless of whether this function currently reads it.

export interface HelperDrawing {
  drawing: Drawing
  // Any CSS color string - the debug page renders each helper filled with its own color, so
  // different construction lines/reference shapes stay visually distinct from `main` and from
  // each other.
  color: string
}

export interface StrutBoundaryManualResult {
  // The actual strut sketch outline - what would eventually replace computeStrutBoundary's
  // return value. Null while you don't have one yet (helpers alone still render).
  main: Drawing | null
  // Construction lines, reference points turned into tiny shapes, anything else worth seeing
  // while building `main` up. Purely visual - never fed into the real pipeline.
  helpers: HelperDrawing[]
}

const LIGHT_GREEN = '#90ee90'
// A "line" is rendered the same way as everything else here (a thin filled rectangle), since the
// whole pipeline (meshDrawing) expects a closed, meshable Drawing.
const LINE_THICKNESS = 8

function drawThinLine(from: Point2D, to: Point2D, thickness: number): Drawing {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)
  const ux = length < 1e-9 ? 1 : dx / length
  const uy = length < 1e-9 ? 0 : dy / length
  const px = (-uy * thickness) / 2
  const py = (ux * thickness) / 2

  return draw()
    .movePointerTo([from[0] + px, from[1] + py])
    .lineTo([to[0] + px, to[1] + py])
    .lineTo([to[0] - px, to[1] - py])
    .lineTo([from[0] - px, from[1] - py])
    .close()
}

// Below is starter geometry (two overlapping rectangles, intersected, plus reference lines from
// the gravity center to each vertex) just to prove the loop works end to end: edit this function,
// save, and the debug page reloads and shows the result. Replace `main` with real strut
// construction whenever you're ready.
export function computeStrutBoundaryManual(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  _offsetA: number,
  _offsetB: number,
  _cornerLength: number,
  _halfWidth: number,
  _tooth: ToothParams,
): StrutBoundaryManualResult {
  const rectA = draw().movePointerTo([0, 0]).hLine(100).vLine(50).hLine(-100).close()

  const rectB = draw().movePointerTo([50, 20]).hLine(100).vLine(50).hLine(-100).close()

  const centerPt: Point2D = [center.x, center.y]
  const aPt: Point2D = [a.x, a.y]
  const bPt: Point2D = [b.x, b.y]

  return {
    main: rectA.intersect(rectB),
    helpers: [
      { drawing: drawThinLine(centerPt, aPt, LINE_THICKNESS), color: LIGHT_GREEN },
      { drawing: drawThinLine(centerPt, bPt, LINE_THICKNESS), color: LIGHT_GREEN },
    ],
  }
}

// This file has no component export, so it isn't a React Fast Refresh boundary on its own, and
// the debug page only reaches it through a dynamic import() inside a useEffect - which doesn't
// reliably propagate HMR updates into a re-run of that effect. Forcing a full reload here (rather
// than relying on default propagation) is what makes "edit, save, see the new shape" actually
// work every time.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}
