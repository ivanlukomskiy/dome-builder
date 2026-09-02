import { draw, drawCircle, DrawingPen } from "replicad";
import { Drawing, type Point2D } from "replicad";
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

type MillingDirection = "top-right" | "top-left" | "bottom-left" | "bottom-right";

// A mill-relief circle of the given diameter, tucked into the corner at `p` - offset diagonally
// (by millingDiameter/2/sqrt(2) along each of `right`/`up`, toward `direction`, rather than the
// global X/Y axes) so the circle's own edge passes exactly through `p`, clearing the inside
// corner of a square notch for a round end mill.
function drawMillingCircle(
  p: Point2D,
  direction: MillingDirection,
  millingDiameter: number,
): Drawing {
  const offset = millingDiameter / 2 / Math.sqrt(2);
  const rightSign = direction === "top-right" || direction === "bottom-right" ? 1 : -1;
  const upSign = direction === "top-right" || direction === "top-left" ? 1 : -1;
  const circleCenter: Point2D = [p[0] + rightSign * offset, p[1] + upSign * offset];
  return drawCircle(millingDiameter / 2).translate(circleCenter);
}

// A point on the circle centered at `center` (radius = the average of p1's and p2's own
// distances from `center`, in case they're not perfectly equal) halfway - by angle, the short
// way around - between p1 and p2. Used as the "via" point for threePointsArcTo when the arc's
// actual center is known but there's no third point to hand.
function arcMidpoint(p1: Point2D, p2: Point2D, center: Point2D): Point2D {
  const radius = (length2(sub2(p1, center)) + length2(sub2(p2, center))) / 2;
  const angle1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
  const angle2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
  let delta = angle2 - angle1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const mid = angle1 + delta / 2;
  return [center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)];
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

// A diamond (45-degree square, oriented to the given right/up axes rather than the global X/Y
// ones) centered at `p`, reaching `size` in each of the four right/up directions - used as a
// chamfer-cut shape at a corner point.
function drawDiamond(p: Point2D, size: number, right: Point2D, up: Point2D): Drawing {
  return draw()
    .movePointerTo(add2(p, scale2(right, -size)))
    .lineTo(add2(p, scale2(up, size)))
    .lineTo(add2(p, scale2(right, size)))
    .lineTo(add2(p, scale2(up, -size)))
    .close();
}

// Prints every vertex coordinate of `drawing` (meshed just for this - a Drawing itself doesn't
// expose its polygon points directly) as [x, y, z] triples, tagged with `label`.
function logDrawingPoints(label: string, drawing: Drawing): void {
  try {
    const sketched = drawing.sketchOnPlane();
    const face = "face" in sketched ? sketched.face() : sketched.faces();
    const mesh = face.mesh({ tolerance: 0.5, angularTolerance: 0.5 });
    face.delete();
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      console.log(label, i / 3, mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]);
    }
  } catch (err) {
    console.log(label, "failed to mesh for logging", err);
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
  endGrooveLengthPercent: number,
  midGrooveLengthPercent: number,
  grooveDepth: number,
  millingDiameter: number,
  chamferLength: number,
): StrutBoundaryManualResult {
  const plane = computeStrutPlane(a, b, center);
  const yDir = plane.normal.clone().cross(plane.xDir).normalize();

  const aRaw = toLocal2D(a, plane.origin, plane.xDir, yDir);
  const bRaw = toLocal2D(b, plane.origin, plane.xDir, yDir);
  const centerRaw = toLocal2D(center, plane.origin, plane.xDir, yDir);

  // const a2 = alignVertical(aRaw, bRaw);
  // const b2 = alignVertical(bRaw, bRaw);
  // const center2 = alignVertical(centerRaw, bRaw);

  return computeStrutBoundaryManual2D(
    aRaw,
    bRaw,
    centerRaw,
    offsetA,
    offsetB,
    cornerLength,
    halfWidth,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
  );
}

const MARKER_RADIUS = 8;

interface Geometry {
  main: Drawing;
  helpers: HelperDrawing[];
  // Cuts (grooves, chamfers, mill-relief) - kept separate from `main` rather than subtracted
  // right away, so the caller can combine shoulder geometry from both ends first (fusing their
  // `main`s and pooling their negativeShapes) and cut once, instead of each end fighting over
  // its own copy of `main`.
  negativeShapes: Drawing[];
}

const nullShoulderGeometry: Geometry = {
  main: draw().close(),
  helpers: [],
  negativeShapes: [],
};

interface StrutEndMeasurements {
  offset: number,
  cornerLength: number,
  tenonStart: number,
  tenonEnd: number,
  chamferLength: number,
  millingDiameter: number,
  effectiveCornerLength: number, // includes space for chamfer / milling diameter
  halfWidth: number,
  grooveDepth: number,
  connectionHalfWidth: number,
}

const TINY_DISTANCE = 0.01

function precalculateStrutEnd(
  offset: number,
  cornerLength: number,
  endGrooveLengthPercent: number,
  midGrooveLengthPercent: number,
  chamferLength: number,
  millingDiameter: number,
  grooveDepth: number,
  halfWidth: number,
): StrutEndMeasurements {
  const workableLength = cornerLength - offset;
  const tenonWidth = workableLength * (100 - endGrooveLengthPercent - midGrooveLengthPercent) / 100
  const millingDiameterDip = millingDiameter / 2 * (1 - 1 / Math.sqrt(2))
  const safeChamferLength = Math.max(0,
    Math.min(
      tenonWidth / 2 - TINY_DISTANCE,
      grooveDepth - TINY_DISTANCE,
      chamferLength,
    ))
  let connectionWallThickness = 0
  if (safeChamferLength > 0) {
    connectionWallThickness = safeChamferLength + TINY_DISTANCE
  }
  if (millingDiameter > 0) {
    connectionWallThickness = Math.max(connectionWallThickness, millingDiameterDip + TINY_DISTANCE)
  }
  console.log('cwt', connectionWallThickness, millingDiameter)
  return {
    offset,
    cornerLength,
    tenonStart: offset + workableLength * endGrooveLengthPercent / 100,
    tenonEnd: cornerLength - workableLength * midGrooveLengthPercent / 100,
    chamferLength: safeChamferLength,
    millingDiameter,
    effectiveCornerLength: cornerLength + connectionWallThickness,
    halfWidth,
    grooveDepth,
    connectionHalfWidth: connectionWallThickness > 0 ? halfWidth : halfWidth - grooveDepth,
  }
}

function createStrutEndHalf(p: StrutEndMeasurements): Geometry {
  let main: DrawingPen = draw()

  console.log("cl",p.chamferLength)

  main = main.movePointerTo([p.offset, 0])
  main = main.vLineTo((p.halfWidth - p.grooveDepth))
  main = main.hLineTo(p.tenonStart)
  main = main.vLineTo(p.halfWidth)

  if (p.chamferLength > 0) {
    main = main.customCorner(p.chamferLength, "chamfer")
  }
  main = main.hLineTo(p.tenonEnd)
  if (p.chamferLength > 0) {
    main = main.customCorner(p.chamferLength, "chamfer")
  }
  main = main.vLineTo((p.halfWidth - p.grooveDepth))
  main = main.hLineTo(p.cornerLength)

  if (p.chamferLength > 0) {
    main = main.vLineTo((p.halfWidth - p.chamferLength))
    main = main.lineTo([p.effectiveCornerLength, p.halfWidth])
  } else if (p.effectiveCornerLength > p.cornerLength) {
    main = main.vLineTo(p.halfWidth)
    main = main.hLineTo(p.effectiveCornerLength)
  }
  main = main.vLineTo(0)

  // let negativeShapes: HelperDrawing[] = []
  let helpers: HelperDrawing[] = []
  if (p.millingDiameter) {
    const mp1 = drawMillingCircle([p.tenonStart, p.halfWidth - p.grooveDepth], 'top-left', p.millingDiameter);
    helpers.push({drawing: mp1, color: 'red', name: 'mp1'})
    const mp2 = drawMillingCircle([p.tenonEnd, p.halfWidth - p.grooveDepth], 'top-right', p.millingDiameter);
    helpers.push({drawing: mp2, color: 'red', name: 'mp2'})
    const mp3 = drawMillingCircle([p.cornerLength, p.halfWidth - p.grooveDepth], 'top-left', p.millingDiameter);
    helpers.push({drawing: mp3, color: 'red', name: 'mp3'})
  }

  return {
    main: main.close(),
    helpers,
    negativeShapes: [],
  }
}

function createStrutEnd(p: StrutEndMeasurements): Geometry {
  const half1 = createStrutEndHalf(p)
  const half2 = half1.main.mirror([1, 0], [0, 0], "plane")

  return {
    main: half1.main.fuse(half2),
    helpers: half1.helpers,
    negativeShapes: half1.negativeShapes,
  }
}

export function computeStrutBoundaryManual2D(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  endGrooveLengthPercent: number,
  midGrooveLengthPercent: number,
  grooveDepth: number,
  millingDiameter: number,
  chamferLength: number,
): StrutBoundaryManualResult {
  // calculate intersection point
  const tangentA = tangentDirection2D(a, b, center);
  const tangentB = tangentDirection2D(b, a, center);
  const intersection = lineIntersection2D(a, tangentA, b, tangentB);
  if (!intersection) return nullShoulderGeometry;
  const distanceToIntersection = length2(sub2(intersection, a));
  const main = draw().movePointerTo(center).lineTo(a).lineTo(b).close();
  let helpers = [
    {drawing: drawPointMarker(center, MARKER_RADIUS), color: 'red', name: 'center'},
    {drawing: drawPointMarker(a, MARKER_RADIUS), color: 'green', name: 'A'},
    {drawing: drawPointMarker(b, MARKER_RADIUS), color: 'green', name: 'B'},
  ]

  const endB = precalculateStrutEnd(
    offsetB, cornerLength, endGrooveLengthPercent, midGrooveLengthPercent, chamferLength, millingDiameter,
    grooveDepth, halfWidth
  )

  const strutB = createStrutEnd(endB)

  helpers = [
    {drawing: strutB.main, color: 'darkblue', name: 'shoulder b'},
    ...helpers,
    ...strutB.helpers,
    ];
  const negativeShapes = [...strutB.negativeShapes];

  // The two shoulders only reach as far as cornerLength (each one's own shoulderEndPoint is
  // already capped there); if the tangent lines' own intersection is further out than that,
  // there's a gap left between them - bridge it with two arcs (centered at `center`, same as the
  // radial construction everywhere else here) and two straight sides.
  // let main = geometryB.main;
  // if (
  //   main &&
  //   geometryB.distanceToIntersection > cornerLength &&
  //   geometryB.shoulderEndPointInn &&
  //   geometryB.shoulderEndPointExt &&
  //   geometryA.shoulderEndPointInn &&
  //   geometryA.shoulderEndPointExt
  // ) {
  //   const connection = draw()
  //     .movePointerTo(geometryB.shoulderEndPointInn)
  //     .threePointsArcTo(
  //       geometryA.shoulderEndPointInn,
  //       arcMidpoint(geometryB.shoulderEndPointInn, geometryA.shoulderEndPointInn, center),
  //     )
  //     .lineTo(geometryA.shoulderEndPointExt)
  //     .threePointsArcTo(
  //       geometryB.shoulderEndPointExt,
  //       arcMidpoint(geometryA.shoulderEndPointExt, geometryB.shoulderEndPointExt, center),
  //     )
  //     .close();
  //   main = main.fuse(connection);
  // }
  // main = main.fuse(geometryA.main)

  // logDrawingPoints("main polygon point", main);

  // Cut the negative shapes one at a time, verifying each cut actually produced a real
  // (non-empty, meshable) shape before keeping it - a mill-relief circle landing exactly on an
  // already-cut groove notch's own corner is a coincident-curve case OpenCascade's boolean ops
  // can silently botch, collapsing the whole shape to nothing without throwing. Skipping just
  // that one cut (falling back to the last known-good shape) is far better than losing
  // everything downstream of it.
  // let result = main;
  // for (const shape of negativeShapes) {
  //   if (!result) break;
  //   const candidate = result.cut(shape);
  //   if (isNonEmptyDrawing(candidate)) {
  //     result = candidate;
  //   }
  // }

  // Chamfer last, only after every negative shape (grooves and mill-relief circles alike) has
  // already been subtracted - each chamfer point needs to already be a real corner of the final
  // boundary for CornerFinder.inList to match it, and an earlier mill-relief cut landing near one
  // of these corners could otherwise still be reshaping the boundary out from under it.
  // const clampedChamferLength = Math.min(chamferLength, grooveDepth);
  // const chamferPoints = [...geometryB.chamferPoints, ...geometryA.chamferPoints];
  // if (result && clampedChamferLength > 0 && chamferPoints.length > 0) {
  //   try {
  //     result = result.chamfer(clampedChamferLength, (c) => c.inList(chamferPoints));
  //   } catch (err) {
  //     console.log("final chamfer failed, keeping the un-chamfered shape", err);
  //   }
  // }

  return { main: main, helpers };
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
