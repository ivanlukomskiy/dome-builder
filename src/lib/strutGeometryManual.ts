import { draw, drawCircle } from "replicad";
import type { Drawing, Point2D } from "replicad";
import type * as THREE from "three";
import type { ToothParams } from "./strutGeometry";
import { computeStrutPlane } from "./strutGeometry";

// A sandbox for hand-building computeStrutBoundary's replacement directly with replicad's own
// 2D primitives (draw(), .cut()/.fuse()/.intersect(), etc.) instead of the hand-rolled Vec2 math
// in strutGeometry.ts - see the "Strut Shape Debug" tool (`npm run strut-shape-debug`). Safe to
// break, safe to rewrite completely: nothing else in the app imports this file, so experimenting
// here can't touch the working Preview pipeline or the /edge-sketch debug page. The real,
// load-bearing implementation stays at `computeStrutBoundary` in strutGeometry.ts - treat this as
// a second opinion you're building by hand, not a patch to the original.
//
// Two functions, two different jobs:
//  - `computeStrutBoundaryManual` (below) is a thin, stable wrapper: it takes the same 3D
//    THREE.Vector3 inputs computeStrutBoundary does, projects them onto the flat plane through
//    a/b/center (reusing computeStrutPlane, the same plane the real pipeline builds the strut
//    on), and hands off 2D coordinates. You shouldn't need to touch this.
//  - `computeStrutBoundaryManual2D` (further down) is where you actually work: pure replicad 2D,
//    no THREE.js, no 3D at all. Same scalar params as computeStrutBoundary (offsetA/offsetB/
//    cornerLength/halfWidth/tooth), plus the two vertices and the gravity center as flat 2D
//    points already in the strut's own plane.

export interface HelperDrawing {
  drawing: Drawing;
  // Any CSS color string - the debug page renders each helper filled with its own color, so
  // different construction lines/reference shapes stay visually distinct from `main` and from
  // each other.
  color: string;
  // Shown as a tooltip when hovering this helper in the preview - what point/line this is.
  name: string;
}

export interface StrutBoundaryManualResult {
  // The actual strut sketch outline - what would eventually replace computeStrutBoundary's
  // return value. Null while you don't have one yet (helpers alone still render).
  main: Drawing | null;
  // Construction lines, reference points turned into tiny shapes, anything else worth seeing
  // while building `main` up. Purely visual - never fed into the real pipeline.
  helpers: HelperDrawing[];
}

const LIGHT_GREEN = "#90ee90";
// A "line" is rendered the same way as everything else here (a thin filled rectangle), since the
// whole pipeline (meshDrawing) expects a closed, meshable Drawing.
const LINE_THICKNESS = 3;

function drawThinLine(from: Point2D, to: Point2D, thickness: number): Drawing {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const ux = length < 1e-9 ? 1 : dx / length;
  const uy = length < 1e-9 ? 0 : dy / length;
  const px = (-uy * thickness) / 2;
  const py = (ux * thickness) / 2;

  return draw()
    .movePointerTo([from[0] + px, from[1] + py])
    .lineTo([to[0] + px, to[1] + py])
    .lineTo([to[0] - px, to[1] - py])
    .lineTo([from[0] - px, from[1] - py])
    .close();
}

function toLocal2D(
  p: THREE.Vector3,
  origin: THREE.Vector3,
  xDir: THREE.Vector3,
  yDir: THREE.Vector3,
): Point2D {
  const rel = p.clone().sub(origin);
  return [rel.dot(xDir), rel.dot(yDir)];
}

// Rotates a 2D point 90 degrees CCW around the origin.
function rotate90(p: Point2D): Point2D {
  return [-p[1], p[0]];
}

// Small 2D vector helpers - kept local so this file stays self-contained (pure replicad 2D, no
// dependency on strutGeometry.ts's own private Vec2 math).
function sub2(p: Point2D, q: Point2D): Point2D {
  return [p[0] - q[0], p[1] - q[1]];
}
function add2(p: Point2D, q: Point2D): Point2D {
  return [p[0] + q[0], p[1] + q[1]];
}
function scale2(p: Point2D, s: number): Point2D {
  return [p[0] * s, p[1] * s];
}
function dot2(p: Point2D, q: Point2D): number {
  return p[0] * q[0] + p[1] * q[1];
}
function cross2(p: Point2D, q: Point2D): number {
  return p[0] * q[1] - p[1] * q[0];
}
function length2(p: Point2D): number {
  return Math.hypot(p[0], p[1]);
}
function normalize2(p: Point2D): Point2D {
  const l = length2(p);
  return l < 1e-9 ? [1, 0] : [p[0] / l, p[1] / l];
}

// Direction tangent to the circle centered at `center` at point `p`, leaning toward `towards` -
// same idea as strutGeometry.ts's own (private) tangentDirection2D: perpendicular to the radius
// center->p, picking whichever of the two perpendicular directions points more toward `towards`.
function tangentDirection2D(
  p: Point2D,
  towards: Point2D,
  center: Point2D,
): Point2D {
  const radial = normalize2(sub2(p, center));
  const towardVec = sub2(towards, p);
  const alongTangent = sub2(towardVec, scale2(radial, dot2(towardVec, radial)));
  return length2(alongTangent) < 1e-9
    ? [-radial[1], radial[0]]
    : normalize2(alongTangent);
}

// Where the line through p1 (direction d1) crosses the line through p2 (direction d2), or null if
// the two directions are parallel.
function lineIntersection2D(
  p1: Point2D,
  d1: Point2D,
  p2: Point2D,
  d2: Point2D,
): Point2D | null {
  const denom = cross2(d1, d2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross2(sub2(p2, p1), d2) / denom;
  return add2(p1, scale2(d1, t));
}

function drawPointMarker(p: Point2D, radius: number): Drawing {
  return drawCircle(radius).translate(p);
}

// Moves `p` by `dist` along the radial direction center->p (negative `dist` moves toward
// `center` instead).
function radialOffset(p: Point2D, center: Point2D, dist: number): Point2D {
  const dir = normalize2(sub2(p, center));
  return add2(p, scale2(dir, dist));
}

// The 3D-to-2D wrapper - see the file-level comment. `computeStrutPlane` builds the exact same
// meridian plane (origin at the gravity center, normal perpendicular to it, xDir toward `a`) the
// real strut pipeline uses; projecting a/b/center onto that plane's own basis turns them into
// flat 2D coordinates for computeStrutBoundaryManual2D. `computeStrutPlane`'s own xDir points
// straight at `a`, i.e. center->A comes out of that projection lying flat along +X - an extra 90
// degree rotation (still around the gravity center, so it doesn't change anything's shape or
// relative position) turns that into center->A pointing straight up (+Y) instead, which reads a
// lot more naturally while sketching.
export function computeStrutBoundaryManual(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  tooth: ToothParams,
): StrutBoundaryManualResult {
  const plane = computeStrutPlane(a, b, center);
  const yDir = plane.normal.clone().cross(plane.xDir).normalize();

  const a2 = rotate90(toLocal2D(a, plane.origin, plane.xDir, yDir));
  const b2 = rotate90(toLocal2D(b, plane.origin, plane.xDir, yDir));
  const center2 = rotate90(toLocal2D(center, plane.origin, plane.xDir, yDir));

  return computeStrutBoundaryManual2D(
    a2,
    b2,
    center2,
    offsetA,
    offsetB,
    cornerLength,
    halfWidth,
    tooth,
  );
}

// Below is starter geometry (two overlapping rectangles, intersected, plus reference lines from
// the gravity center to each vertex) just to prove the loop works end to end: edit this function,
// save, and the debug page reloads and shows the result. Replace `main` with real strut
// construction whenever you're ready.
const MARKER_RADIUS = 15;
const nullResp = { main: null, helpers: [] };

export function computeStrutBoundaryManual2D(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  _tooth: ToothParams,
): StrutBoundaryManualResult {
  const rectA = draw()
    .movePointerTo([0, 0])
    .hLine(100)
    .vLine(50)
    .hLine(-100)
    .close();

  // Tangent to the center-A / center-B circle at each vertex, leaning toward the other vertex -
  // this is the same lead-in direction strutGeometry.ts's tangentDirection2D produces.
  const tangentA = tangentDirection2D(a, b, center);
  const tangentB = tangentDirection2D(b, a, center);

  // Where the two tangent lines cross - the sharp "corner" the two lead-ins would meet at.
  const intersection = lineIntersection2D(a, tangentA, b, tangentB);
  if (!intersection) return nullResp;

  const intersectionDistance = length2(sub2(intersection, a));

  // Walk offsetA/offsetB back along each tangent from the vertex, same as trimmedA/trimmedB in
  // the real algorithm.
  const offsetPointA = add2(a, scale2(tangentA, offsetA));
  const offsetPointB = add2(b, scale2(tangentB, offsetB));

  // Where the lead-in from each vertex would actually end: as far as the tangent lines' own
  // intersection (the sharp corner), but never further than cornerLength - same "the offset
  // spends the cornerLength budget" idea as strutGeometry.ts's trimmedA/trimmedB.
  const shoulderLength = Math.min(intersectionDistance, cornerLength);
  const shoulderEndPointA = add2(a, scale2(tangentA, shoulderLength));
  const shoulderEndPointB = add2(b, scale2(tangentB, shoulderLength));

  // Push each of those points out (Ext, away from center) and in (Inn, toward center) by
  // halfWidth, radially - this is how the centerline construction above turns into the strut's
  // actual left/right edges.
  const shoulderEndPointExtA = radialOffset(shoulderEndPointA, center, halfWidth);
  const shoulderEndPointInnA = radialOffset(shoulderEndPointA, center, -halfWidth);
  const shoulderEndPointExtB = radialOffset(shoulderEndPointB, center, halfWidth);
  const shoulderEndPointInnB = radialOffset(shoulderEndPointB, center, -halfWidth);
  const offsetPointExtA = radialOffset(offsetPointA, center, halfWidth);
  const offsetPointInnA = radialOffset(offsetPointA, center, -halfWidth);
  const offsetPointExtB = radialOffset(offsetPointB, center, halfWidth);
  const offsetPointInnB = radialOffset(offsetPointB, center, -halfWidth);

  const helpers: HelperDrawing[] = [
    { drawing: drawThinLine(center, a, LINE_THICKNESS), color: LIGHT_GREEN, name: "center → A" },
    { drawing: drawThinLine(center, b, LINE_THICKNESS), color: LIGHT_GREEN, name: "center → B" },
    { drawing: drawPointMarker(offsetPointA, MARKER_RADIUS), color: "#e0729f", name: "offsetPointA" },
    { drawing: drawPointMarker(offsetPointB, MARKER_RADIUS), color: "#b47eea", name: "offsetPointB" },
    { drawing: drawPointMarker(shoulderEndPointA, MARKER_RADIUS), color: "#38bdf8", name: "shoulderEndPointA" },
    { drawing: drawPointMarker(shoulderEndPointB, MARKER_RADIUS), color: "#a3e635", name: "shoulderEndPointB" },
    { drawing: drawPointMarker(offsetPointExtA, MARKER_RADIUS), color: "#f9a8d4", name: "offsetPointExtA" },
    { drawing: drawPointMarker(offsetPointInnA, MARKER_RADIUS), color: "#9d174d", name: "offsetPointInnA" },
    { drawing: drawPointMarker(offsetPointExtB, MARKER_RADIUS), color: "#ddd6fe", name: "offsetPointExtB" },
    { drawing: drawPointMarker(offsetPointInnB, MARKER_RADIUS), color: "#6b21a8", name: "offsetPointInnB" },
    { drawing: drawPointMarker(shoulderEndPointExtA, MARKER_RADIUS), color: "#7dd3fc", name: "shoulderEndPointExtA" },
    { drawing: drawPointMarker(shoulderEndPointInnA, MARKER_RADIUS), color: "#0369a1", name: "shoulderEndPointInnA" },
    { drawing: drawPointMarker(shoulderEndPointExtB, MARKER_RADIUS), color: "#d9f99d", name: "shoulderEndPointExtB" },
    { drawing: drawPointMarker(shoulderEndPointInnB, MARKER_RADIUS), color: "#4d7c0f", name: "shoulderEndPointInnB" },
  ];
  if (intersection)
    helpers.push({
      drawing: drawPointMarker(intersection, MARKER_RADIUS),
      color: "#f5a623",
      name: "intersection",
    });

  return {
    main: rectA,
    helpers,
  };
}

// This file has no component export, so it isn't a React Fast Refresh boundary on its own, and
// the debug page only reaches it through a dynamic import() inside a useEffect - which doesn't
// reliably propagate HMR updates into a re-run of that effect. Forcing a full reload here (rather
// than relying on default propagation) is what makes "edit, save, see the new shape" actually
// work every time.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
