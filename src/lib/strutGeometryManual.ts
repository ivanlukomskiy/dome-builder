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

type MillingDirection = "top-right" | "top-left" | "bottom-left" | "bottom-right";

// A mill-relief circle of the given diameter, tucked into the corner at `p` - offset diagonally
// (by millingDiameter/2/sqrt(2) along each axis, toward `direction`) so the circle's own edge
// passes exactly through `p`, clearing the inside corner of a square notch for a round end mill.
function drawMillingCircle(p: Point2D, direction: MillingDirection, millingDiameter: number): Drawing {
  const offset = millingDiameter / 2 / Math.sqrt(2);
  const dx = direction === "top-right" || direction === "bottom-right" ? offset : -offset;
  const dy = direction === "top-right" || direction === "top-left" ? offset : -offset;
  return drawCircle(millingDiameter / 2).translate([p[0] + dx, p[1] + dy]);
}

// Whether a Drawing still has real, meshable area - a boolean op that goes wrong (see the
// comment where this is used) can produce a Drawing that no longer throws but also no longer
// represents any actual shape.
function isNonEmptyDrawing(drawing: Drawing): boolean {
  try {
    const sketched = drawing.sketchOnPlane();
    const face = "face" in sketched ? sketched.face() : sketched.faces();
    const mesh = face.mesh({ tolerance: 0.5, angularTolerance: 0.5 });
    face.delete();
    return mesh.vertices.length > 0;
  } catch {
    return false;
  }
}

// The 3D-to-2D wrapper - see the file-level comment. `computeStrutPlane` builds the exact same
// meridian plane (origin at the gravity center, normal perpendicular to it, xDir toward `a`) the
// real strut pipeline uses; projecting a/b/center onto that plane's own basis turns them into
// flat 2D coordinates for computeStrutBoundaryManual2D. Rather than keep computeStrutPlane's own
// A-aligned xDir, `alignVertical` re-rotates everything (still around the gravity center, so it
// doesn't change anything's shape or relative position) so that center->B comes out pointing
// straight up (+Y) instead - simpler to reason about, and createShoulderGeometry's own right/up
// basis (see below) still works out correctly for A even though A isn't vertically aligned.
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

// Everything built around one end of the strut - centerline, offset/shoulder points, end/mid
// groove notches, chamfers, mill-relief circles. Generic over which vertex it's building around:
// called once for B (vertex=b, other=a) and once for A (vertex=a, other=b) from
// computeStrutBoundaryManual2D below, which fuses the two `main`s and combines their
// negativeShapes before cutting once. `label` ("A" or "B") only affects helper names/logging.
function createShoulderGeometry(
  vertex: Point2D,
  otherVertex: Point2D,
  center: Point2D,
  offset: number,
  cornerLength: number,
  halfWidth: number,
  endGrooveLength: number,
  midGrooveLength: number,
  grooveDepth: number,
  chamferLength: number,
  millingDiameter: number,
  label: string,
): ShoulderGeometry {
  // `right` is the lead-in direction at `vertex`, leaning toward `otherVertex`. `up` is the
  // radial direction straight away from `center` at `vertex` - computeStrutBoundaryManual (the
  // 3D wrapper) rotates everything so this is exactly [0, 1] for B specifically, but the general
  // formula here also gives the correct answer for A (which isn't vertically aligned). Every
  // point below is just a plain right/up step from another, instead of a per-point
  // tangent/radial recompute.
  const right = tangentDirection2D(vertex, otherVertex, center);
  const up = normalize2(sub2(vertex, center));

  // Where the tangent lines from A and B would cross - the sharp corner the two lead-ins would
  // meet at. Caps how far this end's shoulder can travel: never past that intersection, even if
  // cornerLength would otherwise take it further.
  const tangentOther = tangentDirection2D(otherVertex, vertex, center);
  const intersection = lineIntersection2D(vertex, right, otherVertex, tangentOther);
  if (!intersection) return nullShoulderGeometry;
  const distanceToIntersection = length2(sub2(intersection, vertex));

  const offsetPoint = add2(vertex, scale2(right, offset));
  const shoulderEndPoint = add2(vertex, scale2(right, Math.min(cornerLength, distanceToIntersection)));

  const offsetPointExt = add2(offsetPoint, scale2(up, halfWidth));
  const offsetPointInn = add2(offsetPoint, scale2(up, -halfWidth));

  // The end groove: a plain endGrooveLength x grooveDepth rectangle notched into the Ext/Inn edge
  // right at offsetPointExt/Inn, cutting inward (Ext down, Inn up - both toward the offsetPoint
  // centerline) by grooveDepth.
  const endGroovePointExt1 = add2(offsetPointExt, scale2(right, endGrooveLength));
  const endGroovePointExt3 = add2(offsetPointExt, scale2(up, -grooveDepth));
  const endGroovePointExt2 = add2(endGroovePointExt1, scale2(up, -grooveDepth));

  const endGroovePointInn1 = add2(offsetPointInn, scale2(right, endGrooveLength));
  const endGroovePointInn3 = add2(offsetPointInn, scale2(up, grooveDepth));
  const endGroovePointInn2 = add2(endGroovePointInn1, scale2(up, grooveDepth));

  // Both shoulder points are where the horizontal line at that offset point's own height crosses
  // the line from center through the raw shoulderEndPoint.
  const shoulderRefDir = sub2(shoulderEndPoint, center);
  const shoulderEndPointInn = lineIntersection2D(center, shoulderRefDir, offsetPointInn, right);
  const shoulderEndPointExt = lineIntersection2D(center, shoulderRefDir, offsetPointExt, right);
  if (!shoulderEndPointInn || !shoulderEndPointExt) return nullShoulderGeometry;

  console.log(
    `angle between offsetPointExt${label}→shoulderEndPointExt${label} and offsetPointInn${label}→shoulderEndPointInn${label} (deg)`,
    angleBetweenDeg(sub2(shoulderEndPointExt, offsetPointExt), sub2(shoulderEndPointInn, offsetPointInn)),
  );

  // How much the Ext cap edge (shoulderEndPointInn->shoulderEndPointExt, which runs exactly along
  // shoulderRefDir) has tilted away from vertical (the offset cap edge, offsetPointInn->
  // offsetPointExt, which is exactly vertical by construction) - sliding back down that edge by
  // grooveDepth*tan(angle) keeps the groove floor flat.
  const cornerJunctionAngle = angleBetweenRad(
    sub2(shoulderEndPointExt, shoulderEndPointInn),
    sub2(offsetPointExt, offsetPointInn),
  );
  const minExtGrooveOffset = grooveDepth * Math.tan(cornerJunctionAngle);
  const shoulderEndPointExtEffective = add2(shoulderEndPointExt, scale2(right, -minExtGrooveOffset));

  // The mid-strut groove: from each shoulder point (the Effective one on the Ext side), step
  // inward (toward each other) by grooveDepth to reach the groove floor, then walk back by
  // midGrooveLength - the third corner needs no extra step since it's a plain horizontal/vertical
  // rectangle now, not a diagonal-then-perpendicular path.
  const midGroovePointInn1 = add2(shoulderEndPointInn, scale2(up, grooveDepth));
  const midGroovePointInn2 = add2(midGroovePointInn1, scale2(right, -midGrooveLength));
  const midGroovePointInn3 = add2(shoulderEndPointInn, scale2(right, -midGrooveLength));

  const midGroovePointExt1 = add2(shoulderEndPointExtEffective, scale2(up, -grooveDepth));
  const midGroovePointExt2 = add2(midGroovePointExt1, scale2(right, -midGrooveLength));
  const midGroovePointExt3 = add2(shoulderEndPointExtEffective, scale2(right, -midGrooveLength));

  // Chamfer cuts at each sharp corner - clamped to grooveDepth so a chamfer can never eat past
  // the bottom of a groove it sits next to. A zero-or-negative clamp (chamferLength <= 0) means
  // no chamfer at all, not a degenerate zero-size cut.
  const clampedChamferLength = Math.min(chamferLength, grooveDepth);
  const negativeShapes: Drawing[] =
    clampedChamferLength > 0
      ? [
          drawDiamond(endGroovePointExt1, clampedChamferLength),
          drawDiamond(midGroovePointExt3, clampedChamferLength),
          drawDiamond(shoulderEndPointExtEffective, clampedChamferLength),
          drawDiamond(shoulderEndPointInn, clampedChamferLength),
          drawDiamond(midGroovePointInn3, clampedChamferLength),
          drawDiamond(endGroovePointInn1, clampedChamferLength),
        ]
      : [];

  const helpers: HelperDrawing[] = [
    { drawing: drawPointMarker(offsetPoint, MARKER_RADIUS), color: "#b47eea", name: `offsetPoint${label}` },
    { drawing: drawPointMarker(shoulderEndPoint, MARKER_RADIUS), color: "#a3e635", name: `shoulderEndPoint${label}` },
    { drawing: drawPointMarker(offsetPointExt, MARKER_RADIUS), color: "#ddd6fe", name: `offsetPointExt${label}` },
    { drawing: drawPointMarker(offsetPointInn, MARKER_RADIUS), color: "#6b21a8", name: `offsetPointInn${label}` },
    {
      drawing: drawPointMarker(shoulderEndPointExt, MARKER_RADIUS),
      color: "#d9f99d",
      name: `shoulderEndPointExt${label}`,
    },
    {
      drawing: drawPointMarker(shoulderEndPointInn, MARKER_RADIUS),
      color: "#4d7c0f",
      name: `shoulderEndPointInn${label}`,
    },
    {
      drawing: drawPointMarker(shoulderEndPointExtEffective, MARKER_RADIUS),
      color: "#fb7185",
      name: `shoulderEndPointExtEffective${label}`,
    },
    {
      drawing: drawPointMarker(midGroovePointExt1, MARKER_RADIUS),
      color: "#fdba74",
      name: `midGroovePointExt${label}1`,
    },
    {
      drawing: drawPointMarker(midGroovePointInn1, MARKER_RADIUS),
      color: "#c2410c",
      name: `midGroovePointInn${label}1`,
    },
    {
      drawing: drawPointMarker(midGroovePointExt2, MARKER_RADIUS),
      color: "#fde047",
      name: `midGroovePointExt${label}2`,
    },
    {
      drawing: drawPointMarker(midGroovePointInn2, MARKER_RADIUS),
      color: "#a16207",
      name: `midGroovePointInn${label}2`,
    },
    {
      drawing: drawPointMarker(midGroovePointExt3, MARKER_RADIUS),
      color: "#5eead4",
      name: `midGroovePointExt${label}3`,
    },
    {
      drawing: drawPointMarker(midGroovePointInn3, MARKER_RADIUS),
      color: "#0f766e",
      name: `midGroovePointInn${label}3`,
    },
    { drawing: drawPointMarker(intersection, MARKER_RADIUS), color: "#f5a623", name: `intersection${label}` },
    {
      drawing: drawPointMarker(endGroovePointExt1, MARKER_RADIUS),
      color: "#fca5a5",
      name: `endGroovePointExt${label}1`,
    },
    {
      drawing: drawPointMarker(endGroovePointExt2, MARKER_RADIUS),
      color: "#b91c1c",
      name: `endGroovePointExt${label}2`,
    },
    {
      drawing: drawPointMarker(endGroovePointExt3, MARKER_RADIUS),
      color: "#7f1d1d",
      name: `endGroovePointExt${label}3`,
    },
    {
      drawing: drawPointMarker(endGroovePointInn1, MARKER_RADIUS),
      color: "#93c5fd",
      name: `endGroovePointInn${label}1`,
    },
    {
      drawing: drawPointMarker(endGroovePointInn2, MARKER_RADIUS),
      color: "#1d4ed8",
      name: `endGroovePointInn${label}2`,
    },
    {
      drawing: drawPointMarker(endGroovePointInn3, MARKER_RADIUS),
      color: "#1e3a8a",
      name: `endGroovePointInn${label}3`,
    },
  ];

  const main = draw()
    .movePointerTo(offsetPointExt)
    .lineTo(shoulderEndPointExt)
    .lineTo(shoulderEndPointInn)
    .lineTo(offsetPointInn)
    .close();

  // The two mid-groove notches (Ext/Inn) - only if there's actually a groove to cut, both a
  // length along the strut and a depth into it.
  if (midGrooveLength > 0 && grooveDepth > 0) {
    negativeShapes.push(
      draw()
        .movePointerTo(shoulderEndPointExtEffective)
        .lineTo(midGroovePointExt1)
        .lineTo(midGroovePointExt2)
        .lineTo(midGroovePointExt3)
        .close(),
      draw()
        .movePointerTo(shoulderEndPointInn)
        .lineTo(midGroovePointInn1)
        .lineTo(midGroovePointInn2)
        .lineTo(midGroovePointInn3)
        .close(),
    );
  }

  // The two end-groove notches (Ext/Inn), right at this end - same existence check.
  if (endGrooveLength > 0 && grooveDepth > 0) {
    negativeShapes.push(
      draw()
        .movePointerTo(endGroovePointExt1)
        .lineTo(endGroovePointExt2)
        .lineTo(endGroovePointExt3)
        .lineTo(offsetPointExt)
        .close(),
      draw()
        .movePointerTo(endGroovePointInn1)
        .lineTo(endGroovePointInn2)
        .lineTo(endGroovePointInn3)
        .lineTo(offsetPointInn)
        .close(),
    );
  }

  // Mill-relief circles at each groove's inside corner, clearing room for a round end mill to
  // reach all the way into the square notch instead of leaving material a real mill can't cut.
  if (millingDiameter > 0) {
    negativeShapes.push(
      // drawMillingCircle(midGroovePointExt2, "top-right", millingDiameter),
      // drawMillingCircle(endGroovePointExt2, "top-left", millingDiameter),
      // drawMillingCircle(midGroovePointExt1, "top-left", millingDiameter),
      // drawMillingCircle(midGroovePointInn1, "bottom-left", millingDiameter),
      // drawMillingCircle(midGroovePointInn2, "bottom-right", millingDiameter),
      // drawMillingCircle(endGroovePointInn2, "bottom-left", millingDiameter),
    );
  }

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
  const geometryB = createShoulderGeometry(
    b,
    a,
    center,
    offsetB,
    cornerLength,
    halfWidth,
    endGrooveLength,
    midGrooveLength,
    grooveDepth,
    chamferLength,
    millingDiameter,
    "B",
  );
  const geometryA = createShoulderGeometry(
    a,
    b,
    center,
    offsetA,
    cornerLength,
    halfWidth,
    endGrooveLength,
    midGrooveLength,
    grooveDepth,
    chamferLength,
    millingDiameter,
    "A",
  );

  const main = geometryB.main && geometryA.main ? geometryB.main.fuse(geometryA.main) : geometryB.main || geometryA.main;
  const helpers = [...geometryB.helpers, ...geometryA.helpers];
  const negativeShapes = [...geometryB.negativeShapes, ...geometryA.negativeShapes];

  // Cut the negative shapes one at a time, verifying each cut actually produced a real
  // (non-empty, meshable) shape before keeping it - a mill-relief circle landing exactly on an
  // already-cut groove notch's own corner is a coincident-curve case OpenCascade's boolean ops
  // can silently botch, collapsing the whole shape to nothing without throwing. Skipping just
  // that one cut (falling back to the last known-good shape) is far better than losing
  // everything downstream of it.
  let result = main;
  for (const shape of negativeShapes) {
    if (!result) break;
    const candidate = result.cut(shape);
    if (isNonEmptyDrawing(candidate)) {
      result = candidate;
    }
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
