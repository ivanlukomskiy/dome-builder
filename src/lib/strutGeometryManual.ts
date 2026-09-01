import { draw, drawCircle } from "replicad";
import type { Drawing, Point2D } from "replicad";
import type * as THREE from "three";
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
//    no THREE.js, no 3D at all. Same offsetA/offsetB/cornerLength/halfWidth params as
//    computeStrutBoundary, plus the groove/milling params below (this sandbox's own vocabulary,
//    not computeStrutBoundary's tooth/chamfer/millRadius - the two aren't meant to line up 1:1),
//    plus the two vertices and the gravity center as flat 2D points already in the strut's own
//    plane.

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

// Rotates 2D points (around the origin) so that `alignWith` itself ends up pointing straight up
// along +Y - used to make center->B vertical, see computeStrutBoundaryManual below.
function alignVertical(p: Point2D, alignWith: Point2D): Point2D {
  const up = normalize2(alignWith);
  const right: Point2D = [up[1], -up[0]];
  return [dot2(p, right), dot2(p, up)];
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

function angleBetweenRad(v1: Point2D, v2: Point2D): number {
  return Math.atan2(cross2(v1, v2), dot2(v1, v2));
}

function angleBetweenDeg(v1: Point2D, v2: Point2D): number {
  return (angleBetweenRad(v1, v2) * 180) / Math.PI;
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

// A diamond (45-degree square) centered at `p`, reaching `size` in each of the four axis
// directions - used as a chamfer-cut shape at a corner point.
function drawDiamond(p: Point2D, size: number): Drawing {
  return draw()
    .movePointerTo([p[0] - size, p[1]])
    .lineTo([p[0], p[1] + size])
    .lineTo([p[0] + size, p[1]])
    .lineTo([p[0], p[1] - size])
    .close();
}

// The 3D-to-2D wrapper - see the file-level comment. `computeStrutPlane` builds the exact same
// meridian plane (origin at the gravity center, normal perpendicular to it, xDir toward `a`) the
// real strut pipeline uses; projecting a/b/center onto that plane's own basis turns them into
// flat 2D coordinates for computeStrutBoundaryManual2D. Side A is out of scope for now (see
// conversation), so rather than keep computeStrutPlane's own A-aligned xDir, `alignVertical`
// re-rotates everything (still around the gravity center, so it doesn't change anything's shape
// or relative position) so that center->B comes out pointing straight up (+Y) instead - simpler
// to reason about while all the construction work is happening at the B end.
export function computeStrutBoundaryManual(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  endGrooveLength: number,
  midGrooveLength: number,
  grooveDepth: number,
  millingDiameter: number,
  chamferLength: number,
): StrutBoundaryManualResult {
  const plane = computeStrutPlane(a, b, center);
  const yDir = plane.normal.clone().cross(plane.xDir).normalize();

  const aRaw = toLocal2D(a, plane.origin, plane.xDir, yDir);
  const bRaw = toLocal2D(b, plane.origin, plane.xDir, yDir);
  const centerRaw = toLocal2D(center, plane.origin, plane.xDir, yDir);

  const a2 = alignVertical(aRaw, bRaw);
  const b2 = alignVertical(bRaw, bRaw);
  const center2 = alignVertical(centerRaw, bRaw);

  return computeStrutBoundaryManual2D(
    a2,
    b2,
    center2,
    offsetA,
    offsetB,
    cornerLength,
    halfWidth,
    endGrooveLength,
    midGrooveLength,
    grooveDepth,
    millingDiameter,
    chamferLength,
  );
}

const MARKER_RADIUS = 15;

interface ShoulderGeometry {
  main: Drawing | null;
  helpers: HelperDrawing[];
  // Chamfer cuts at the sharp corners - kept separate from `main` rather than subtracted right
  // away, so the caller can apply them after combining shoulder geometry from multiple ends
  // (once side A exists again) instead of each end fighting over its own copy of `main`.
  negativeShapes: Drawing[];
}

const nullShoulderGeometry: ShoulderGeometry = { main: null, helpers: [], negativeShapes: [] };

// Everything currently built around the B end - centerline, offset/shoulder points, and the two
// mid-groove notches. Side A is out of scope for now (see the user's own note in conversation:
// "we'll deal with it later"), so this is the only construction happening today; pulled into its
// own function so computeStrutBoundaryManual2D can eventually call the equivalent for A too
// without the two getting tangled together.
function createShoulderGeometry(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  endGrooveLength: number,
  midGrooveLength: number,
  grooveDepth: number,
  chamferLength: number,
): ShoulderGeometry {
  // computeStrutBoundaryManual (the 3D wrapper) already rotated everything so center->B comes out
  // exactly vertical - `up` is that guaranteed-exact axis, and `right` is the matching horizontal
  // axis (still computed the general way, as the lead-in direction leaning toward `a`, so this
  // keeps working if that vertical-alignment guarantee ever changes). Every point below is just a
  // plain horizontal/vertical step from another, instead of the general tangent/radial vector
  // math the older version of this function used.
  const right = tangentDirection2D(b, a, center);
  const up: Point2D = [0, 1];

  // Where the tangent lines from A and B would cross - the sharp corner the two lead-ins would
  // meet at. Caps how far the B shoulder can travel below: never past that intersection, even if
  // cornerLength would otherwise take it further.
  const tangentA = tangentDirection2D(a, b, center);
  const intersection = lineIntersection2D(a, tangentA, b, right);
  if (!intersection) return nullShoulderGeometry;
  const distanceToIntersection = length2(sub2(intersection, a));

  const offsetPointB = add2(b, scale2(right, offsetB));
  const shoulderEndPointB = add2(b, scale2(right, Math.min(cornerLength, distanceToIntersection)));

  const offsetPointExtB = add2(offsetPointB, scale2(up, halfWidth));
  const offsetPointInnB = add2(offsetPointB, scale2(up, -halfWidth));

  // The end groove at the B end: a plain endGrooveLength x grooveDepth rectangle notched into the
  // Ext/Inn edge right at offsetPointExtB/InnB, cutting inward (Ext down, Inn up - both toward
  // the offsetPointB centerline) by grooveDepth.
  const endGroovePointExt1 = add2(offsetPointExtB, scale2(right, endGrooveLength));
  const endGroovePointExt3 = add2(offsetPointExtB, scale2(up, -grooveDepth));
  const endGroovePointExt2 = add2(endGroovePointExt1, scale2(up, -grooveDepth));

  const endGroovePointInn1 = add2(offsetPointInnB, scale2(right, endGrooveLength));
  const endGroovePointInn3 = add2(offsetPointInnB, scale2(up, grooveDepth));
  const endGroovePointInn2 = add2(endGroovePointInn1, scale2(up, grooveDepth));

  // Both shoulder points are where the horizontal line at that offset point's own height crosses
  // the line from center through the raw shoulderEndPointB.
  const shoulderRefDir = sub2(shoulderEndPointB, center);
  const shoulderEndPointInnB = lineIntersection2D(center, shoulderRefDir, offsetPointInnB, right);
  const shoulderEndPointExtB = lineIntersection2D(center, shoulderRefDir, offsetPointExtB, right);
  if (!shoulderEndPointInnB || !shoulderEndPointExtB) return nullShoulderGeometry;

  console.log(
    'angle between offsetPointExtB→shoulderEndPointExtB and offsetPointInnB→shoulderEndPointInnB (deg)',
    angleBetweenDeg(sub2(shoulderEndPointExtB, offsetPointExtB), sub2(shoulderEndPointInnB, offsetPointInnB)),
  );

  // How much the Ext cap edge (shoulderEndPointInnB->shoulderEndPointExtB, which runs exactly
  // along shoulderRefDir) has tilted away from vertical (the offset cap edge, offsetPointInnB->
  // offsetPointExtB, which is exactly vertical by construction) - sliding back down that edge by
  // grooveDepth*tan(angle) keeps the groove floor flat.
  const cornerJunctionAngleB = angleBetweenRad(
    sub2(shoulderEndPointExtB, shoulderEndPointInnB),
    sub2(offsetPointExtB, offsetPointInnB),
  );
  const minExtGrooveOffsetB = grooveDepth * Math.tan(cornerJunctionAngleB);
  const shoulderEndPointExtEffectiveB = add2(shoulderEndPointExtB, scale2(right, -minExtGrooveOffsetB));

  // The mid-strut groove at the B end: from each shoulder point (the Effective one on the Ext
  // side), step inward (toward each other) by grooveDepth to reach the groove floor, then walk
  // back by midGrooveLength - the third corner needs no extra step since it's a plain
  // horizontal/vertical rectangle now, not a diagonal-then-perpendicular path.
  const midGroovePointInnB1 = add2(shoulderEndPointInnB, scale2(up, grooveDepth));
  const midGroovePointInnB2 = add2(midGroovePointInnB1, scale2(right, -midGrooveLength));
  const midGroovePointInnB3 = add2(shoulderEndPointInnB, scale2(right, -midGrooveLength));

  const midGroovePointExtB1 = add2(shoulderEndPointExtEffectiveB, scale2(up, -grooveDepth));
  const midGroovePointExtB2 = add2(midGroovePointExtB1, scale2(right, -midGrooveLength));
  const midGroovePointExtB3 = add2(shoulderEndPointExtEffectiveB, scale2(right, -midGrooveLength));

  // Chamfer cuts at each sharp corner - clamped to grooveDepth so a chamfer can never eat past
  // the bottom of a groove it sits next to.
  const clampedChamferLength = Math.min(chamferLength, grooveDepth);
  const negativeShapes: Drawing[] = [
    drawDiamond(endGroovePointExt1, clampedChamferLength),
    drawDiamond(midGroovePointExtB3, clampedChamferLength),
    drawDiamond(shoulderEndPointExtEffectiveB, clampedChamferLength),
    drawDiamond(shoulderEndPointInnB, clampedChamferLength),
    drawDiamond(midGroovePointInnB3, clampedChamferLength),
    drawDiamond(endGroovePointInn1, clampedChamferLength),
  ];

  const helpers: HelperDrawing[] = [
    { drawing: drawThinLine(center, a, LINE_THICKNESS), color: LIGHT_GREEN, name: "center → A" },
    { drawing: drawThinLine(center, b, LINE_THICKNESS), color: LIGHT_GREEN, name: "center → B" },
    { drawing: drawPointMarker(offsetPointB, MARKER_RADIUS), color: "#b47eea", name: "offsetPointB" },
    { drawing: drawPointMarker(shoulderEndPointB, MARKER_RADIUS), color: "#a3e635", name: "shoulderEndPointB" },
    { drawing: drawPointMarker(offsetPointExtB, MARKER_RADIUS), color: "#ddd6fe", name: "offsetPointExtB" },
    { drawing: drawPointMarker(offsetPointInnB, MARKER_RADIUS), color: "#6b21a8", name: "offsetPointInnB" },
    { drawing: drawPointMarker(shoulderEndPointExtB, MARKER_RADIUS), color: "#d9f99d", name: "shoulderEndPointExtB" },
    { drawing: drawPointMarker(shoulderEndPointInnB, MARKER_RADIUS), color: "#4d7c0f", name: "shoulderEndPointInnB" },
    {
      drawing: drawPointMarker(shoulderEndPointExtEffectiveB, MARKER_RADIUS),
      color: "#fb7185",
      name: "shoulderEndPointExtEffectiveB",
    },
    { drawing: drawPointMarker(midGroovePointExtB1, MARKER_RADIUS), color: "#fdba74", name: "midGroovePointExtB1" },
    { drawing: drawPointMarker(midGroovePointInnB1, MARKER_RADIUS), color: "#c2410c", name: "midGroovePointInnB1" },
    { drawing: drawPointMarker(midGroovePointExtB2, MARKER_RADIUS), color: "#fde047", name: "midGroovePointExtB2" },
    { drawing: drawPointMarker(midGroovePointInnB2, MARKER_RADIUS), color: "#a16207", name: "midGroovePointInnB2" },
    { drawing: drawPointMarker(midGroovePointExtB3, MARKER_RADIUS), color: "#5eead4", name: "midGroovePointExtB3" },
    { drawing: drawPointMarker(midGroovePointInnB3, MARKER_RADIUS), color: "#0f766e", name: "midGroovePointInnB3" },
    { drawing: drawPointMarker(intersection, MARKER_RADIUS), color: "#f5a623", name: "intersection" },
    { drawing: drawPointMarker(endGroovePointExt1, MARKER_RADIUS), color: "#fca5a5", name: "endGroovePointExt1" },
    { drawing: drawPointMarker(endGroovePointExt2, MARKER_RADIUS), color: "#b91c1c", name: "endGroovePointExt2" },
    { drawing: drawPointMarker(endGroovePointExt3, MARKER_RADIUS), color: "#7f1d1d", name: "endGroovePointExt3" },
    { drawing: drawPointMarker(endGroovePointInn1, MARKER_RADIUS), color: "#93c5fd", name: "endGroovePointInn1" },
    { drawing: drawPointMarker(endGroovePointInn2, MARKER_RADIUS), color: "#1d4ed8", name: "endGroovePointInn2" },
    { drawing: drawPointMarker(endGroovePointInn3, MARKER_RADIUS), color: "#1e3a8a", name: "endGroovePointInn3" },
  ];

  let main = draw()
    .movePointerTo(offsetPointExtB)
    .lineTo(shoulderEndPointExtB)
    .lineTo(shoulderEndPointInnB)
    .lineTo(offsetPointInnB)
    .close();

  // Cut the two mid-groove notches (Ext/Inn) out of the strut body at the B end.
  const midGrooveExtCutB = draw()
    .movePointerTo(shoulderEndPointExtEffectiveB)
    .lineTo(midGroovePointExtB1)
    .lineTo(midGroovePointExtB2)
    .lineTo(midGroovePointExtB3)
    .close();
  main = main.cut(midGrooveExtCutB);

  const midGrooveInnCutB = draw()
    .movePointerTo(shoulderEndPointInnB)
    .lineTo(midGroovePointInnB1)
    .lineTo(midGroovePointInnB2)
    .lineTo(midGroovePointInnB3)
    .close();
  main = main.cut(midGrooveInnCutB);

  // Cut the two end-groove notches (Ext/Inn) out of the strut body right at the B end.
  const endGrooveExtCutB = draw()
    .movePointerTo(endGroovePointExt1)
    .lineTo(endGroovePointExt2)
    .lineTo(endGroovePointExt3)
    .lineTo(offsetPointExtB)
    .close();
  main = main.cut(endGrooveExtCutB);

  const endGrooveInnCutB = draw()
    .movePointerTo(endGroovePointInn1)
    .lineTo(endGroovePointInn2)
    .lineTo(endGroovePointInn3)
    .lineTo(offsetPointInnB)
    .close();
  main = main.cut(endGrooveInnCutB);

  return {
    main,
    helpers,
    negativeShapes,
  };
}

export function computeStrutBoundaryManual2D(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  _offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  endGrooveLength: number,
  midGrooveLength: number,
  grooveDepth: number,
  _millingDiameter: number,
  chamferLength: number,
): StrutBoundaryManualResult {
  const { main, helpers, negativeShapes } = createShoulderGeometry(
    a,
    b,
    center,
    offsetB,
    cornerLength,
    halfWidth,
    endGrooveLength,
    midGrooveLength,
    grooveDepth,
    chamferLength,
  );

  let result = main;
  for (const shape of negativeShapes) {
    if (result) result = result.cut(shape);
  }

  return { main: result, helpers };
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
