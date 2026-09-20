import { draw, drawCircle, drawRoundedRectangle, DrawingPen } from "replicad";
import { Drawing, type Point2D } from "replicad";
import type * as THREE from "three";
import { computeStrutPlane } from "./strutGeometry";
import { NO_STRUT_BRACES, type BraceParams, type StrutBraces } from "./braces";
import {
  arcPointAtAngle,
  bracePlateHoleCenters,
  placeInPlateFrame,
  braceRectInArcBand,
  type BraceRect,
  type ArcEndpoints,
} from "./braceGeometry";

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

// A drawing with a human-readable name, so failures (e.g. a boolean cut that throws) can say
// which shape was involved.
export interface DrawingWithLabel {
  drawing: Drawing;
  name: string;
}

export interface StrutMark {
  end: "A" | "B";
  point: Point2D;
  axis: Point2D;
}

export interface StrutBoundaryManualResult {
  // The actual strut sketch outline - what would eventually replace computeStrutBoundary's
  // return value. Null while you don't have one yet (helpers alone still render).
  main: Drawing | null;
  // The flat brace plate (rounded rectangle with its bolt holes) at this strut's A / B end, or
  // null if there's no brace there. If several braces sit on one end, it's the first one's.
  bracePlateA: Drawing | null;
  bracePlateB: Drawing | null;
  // The two points where the line through the brace's center along the strut end's axis crosses
  // the plate's two short sides (the ones perpendicular to that axis), in the strut's 2D
  // coordinates - same brace as bracePlateA / bracePlateB, null when there's no plate.
  bracePlateEndsA: [Point2D, Point2D] | null;
  bracePlateEndsB: [Point2D, Point2D] | null;
  // Reference spots for labeling, in the strut's 2D coordinates. `endMarks`: one per strut end,
  // on the strut's axis in the middle of its tenon; `braceMarks`: the center of every brace on the
  // strut. `axis` is the unit direction along the strut there (labels are written along it).
  endMarks: StrutMark[];
  braceMarks: (StrutMark & { braceId: number })[];
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
export function alignVertical(p: Point2D, alignWith: Point2D): Point2D {
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

export function angleBetweenDeg(v1: Point2D, v2: Point2D): number {
  return (angleBetweenRad(v1, v2) * 180) / Math.PI;
}

function rotate90(v: Point2D, sign: 1 | -1): Point2D {
  return sign === 1 ? [-v[1], v[0]] : [v[1], -v[0]];
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
export function lineIntersection2D(
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

type MillingDirection =
  | "top-right"
  | "top-left"
  | "bottom-left"
  | "bottom-right";

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
  const rightSign =
    direction === "top-right" || direction === "bottom-right" ? 1 : -1;
  const upSign = direction === "top-right" || direction === "top-left" ? 1 : -1;
  const circleCenter: Point2D = [
    p[0] + rightSign * offset,
    p[1] + upSign * offset,
  ];
  return drawCircle(millingDiameter / 2).translate(circleCenter);
}

// A point on the circle centered at `center` (radius = the average of p1's and p2's own
// distances from `center`, in case they're not perfectly equal) halfway - by angle, the short
// way around - between p1 and p2. Used as the "via" point for threePointsArcTo when the arc's
// actual center is known but there's no third point to hand.
export function arcMidpoint(p1: Point2D, p2: Point2D, center: Point2D): Point2D {
  const radius = (length2(sub2(p1, center)) + length2(sub2(p2, center))) / 2;
  const angle1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
  const angle2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
  let delta = angle2 - angle1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const mid = angle1 + delta / 2;
  return [
    center[0] + radius * Math.cos(mid),
    center[1] + radius * Math.sin(mid),
  ];
}

// Whether a Drawing still has real, meshable area - a boolean op that goes wrong (see the
// comment where this is used) can produce a Drawing that no longer throws but also no longer
// represents any actual shape.
export function isNonEmptyDrawing(drawing: Drawing): boolean {
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
export function drawDiamond(
  p: Point2D,
  size: number,
  right: Point2D,
  up: Point2D,
): Drawing {
  return draw()
    .movePointerTo(add2(p, scale2(right, -size)))
    .lineTo(add2(p, scale2(up, size)))
    .lineTo(add2(p, scale2(right, size)))
    .lineTo(add2(p, scale2(up, -size)))
    .close();
}

// Prints every vertex coordinate of `drawing` (meshed just for this - a Drawing itself doesn't
// expose its polygon points directly) as [x, y, z] triples, tagged with `label`.
export function logDrawingPoints(label: string, drawing: Drawing): void {
  try {
    const sketched = drawing.sketchOnPlane();
    const face = "face" in sketched ? sketched.face() : sketched.faces();
    const mesh = face.mesh({ tolerance: 0.5, angularTolerance: 0.5 });
    face.delete();
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      console.log(
        label,
        i / 3,
        mesh.vertices[i],
        mesh.vertices[i + 1],
        mesh.vertices[i + 2],
      );
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
function computeStrutBoundaryManualUnguarded(
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
  // Braces lying on the A / B end of this strut (see braces.ts); empty lists mean none.
  braces: StrutBraces = NO_STRUT_BRACES,
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
    braces,
  );
}

// Everything computeStrutBoundaryManual takes, as plain JSON-friendly data (vectors as [x, y, z]).
// When the computation throws we dump this to the console; the /strut-shape-debug page can import
// it ("Import failure JSON") to reproduce the exact same call.
export interface StrutBoundaryManualInput {
  a: [number, number, number];
  b: [number, number, number];
  center: [number, number, number];
  offsetA: number;
  offsetB: number;
  cornerLength: number;
  halfWidth: number;
  endGrooveLengthPercent: number;
  midGrooveLengthPercent: number;
  grooveDepth: number;
  millingDiameter: number;
  chamferLength: number;
  braces: StrutBraces;
}

const NON_FINITE_NUMBERS = new Set(["NaN", "Infinity", "-Infinity"]);

// JSON.stringify turns NaN / Infinity into `null`, which would hide exactly the kind of bad input
// that tends to cause these failures - so write them as the strings "NaN" / "Infinity" instead
// (and turn them back into numbers on import).
export function strutBoundaryManualInputToJson(
  input: StrutBoundaryManualInput,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    { ...extra, input },
    (_key, value) => (typeof value === "number" && !Number.isFinite(value) ? String(value) : value),
    2,
  );
}

// Accepts either the full dump (`{ error, input: {...} }`) or a bare input object.
export function strutBoundaryManualInputFromJson(json: string): StrutBoundaryManualInput {
  const parsed: unknown = JSON.parse(json, (_key, value) =>
    typeof value === "string" && NON_FINITE_NUMBERS.has(value) ? Number(value) : value,
  );
  const candidate =
    typeof parsed === "object" && parsed !== null && "input" in parsed
      ? (parsed as { input: unknown }).input
      : parsed;
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Expected a JSON object with the strut inputs");
  }
  const input = candidate as Partial<StrutBoundaryManualInput>;
  for (const key of ["a", "b", "center"] as const) {
    const v = input[key];
    if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== "number")) {
      throw new Error(`"${key}" must be an [x, y, z] array of numbers`);
    }
  }
  for (const key of [
    "offsetA",
    "offsetB",
    "cornerLength",
    "halfWidth",
    "endGrooveLengthPercent",
    "midGrooveLengthPercent",
    "grooveDepth",
    "millingDiameter",
    "chamferLength",
  ] as const) {
    if (typeof input[key] !== "number") throw new Error(`"${key}" must be a number`);
  }
  return { ...(input as StrutBoundaryManualInput), braces: input.braces ?? NO_STRUT_BRACES };
}

// Public entry point. Same as computeStrutBoundaryManualUnguarded, but if that throws, logs
// everything needed to reproduce the call as JSON (copy it from the console and paste it into
// /strut-shape-debug via "Import failure JSON"), then rethrows so callers behave as before.
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
  // Braces lying on the A / B end of this strut (see braces.ts); empty lists mean none.
  braces: StrutBraces = NO_STRUT_BRACES,
): StrutBoundaryManualResult {
  try {
    return computeStrutBoundaryManualUnguarded(
      a,
      b,
      center,
      offsetA,
      offsetB,
      cornerLength,
      halfWidth,
      endGrooveLengthPercent,
      midGrooveLengthPercent,
      grooveDepth,
      millingDiameter,
      chamferLength,
      braces,
    );
  } catch (err) {
    try {
      const json = strutBoundaryManualInputToJson(
        {
          a: a.toArray(),
          b: b.toArray(),
          center: center.toArray(),
          offsetA,
          offsetB,
          cornerLength,
          halfWidth,
          endGrooveLengthPercent,
          midGrooveLengthPercent,
          grooveDepth,
          millingDiameter,
          chamferLength,
          braces,
        },
        { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) },
      );
      console.error(
        "computeStrutBoundaryManual threw. To reproduce: open /strut-shape-debug and paste the JSON below into \"Import failure JSON\":",
        err,
      );
      console.error(json);
    } catch (dumpErr) {
      console.error("computeStrutBoundaryManual threw, and dumping its inputs failed too", dumpErr);
    }
    throw err;
  }
}

const MARKER_RADIUS = 8;

interface Geometry {
  main: Drawing;
  helpers: HelperDrawing[];
  // Cuts (grooves, chamfers, mill-relief) - kept separate from `main` rather than subtracted
  // right away, so the caller can combine shoulder geometry from both ends first (fusing their
  // `main`s and pooling their negativeShapes) and cut once, instead of each end fighting over
  // its own copy of `main`.
  negativeShapes: DrawingWithLabel[];
}

export const nullShoulderGeometry: Geometry = {
  main: draw().close(),
  helpers: [],
  negativeShapes: [],
};

// The brace plate, flat: the rectangle `rect` (centered at `c`, its length along `axis`) with
// corners rounded by `plateRadius`, and 6 bolt holes cut in it (see bracePlateHoleCenters).
// Null if the rectangle is degenerate.
function drawBracePlate(
  c: Point2D,
  axis: Point2D,
  rect: BraceRect,
  params: BraceParams,
): Drawing | null {
  if (rect.halfAlong <= 0 || rect.halfAcross <= 0) return null;

  // Built around the origin with x along the strut end's axis, then rotated / moved into place.
  const radius = Math.min(
    Math.max(params.plateRadius, 0),
    rect.halfAlong,
    rect.halfAcross,
  );
  const width = rect.halfAlong * 2;
  const height = rect.halfAcross * 2;
  let plate =
    radius > 0
      ? drawRoundedRectangle(width, height, radius)
      : drawRoundedRectangle(width, height);

  if (params.plateHoleDiameter > 0) {
    const holes = bracePlateHoleCenters(
      rect.halfAlong,
      rect.halfAcross,
      params.plateHoleOffsetLongitudinal,
      params.plateHoleOffsetTransverse,
    );
    for (const holeCenter of [...holes.corner, ...holes.middle]) {
      plate = plate.cut(
        drawCircle(params.plateHoleDiameter / 2).translate(holeCenter),
      );
    }
  }

  const angleDeg = (Math.atan2(axis[1], axis[0]) * 180) / Math.PI;
  return plate.rotate(angleDeg).translate(c);
}

export interface StrutEndMeasurements {
  offset: number;
  cornerLength: number;
  tenonStart: number;
  tenonEnd: number;
  chamferLength: number;
  millingDiameter: number;
  effectiveCornerLength: number; // includes space for chamfer / milling diameter
  halfWidth: number;
  grooveDepth: number;
  connectionHalfWidth: number;
}

const TINY_DISTANCE = 0.01;

export function precalculateStrutEnd(
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
  const tenonWidth =
    (workableLength * (100 - endGrooveLengthPercent - midGrooveLengthPercent)) /
    100;
  const millingDiameterDip = (millingDiameter / 2) * (1 - 1 / Math.sqrt(2));
  const safeChamferLength = Math.max(
    0,
    Math.min(
      tenonWidth / 2 - TINY_DISTANCE,
      grooveDepth - TINY_DISTANCE,
      chamferLength,
    ),
  );
  let connectionWallThickness = 0;
  if (safeChamferLength > 0) {
    connectionWallThickness = safeChamferLength + TINY_DISTANCE;
  }
  if (millingDiameter > 0) {
    connectionWallThickness = Math.max(
      connectionWallThickness,
      millingDiameterDip + TINY_DISTANCE,
    );
  }
  if (connectionWallThickness > 0) {
    const minPositiveConnWidth = cornerLength * 0.05;
    connectionWallThickness = Math.max(
      minPositiveConnWidth,
      connectionWallThickness,
    );
  }
  return {
    offset,
    cornerLength,
    tenonStart: offset + (workableLength * endGrooveLengthPercent) / 100,
    tenonEnd: cornerLength - (workableLength * midGrooveLengthPercent) / 100,
    chamferLength: safeChamferLength,
    millingDiameter,
    effectiveCornerLength: cornerLength + connectionWallThickness,
    halfWidth,
    grooveDepth,
    connectionHalfWidth:
      connectionWallThickness > 0 ? halfWidth : halfWidth - grooveDepth,
  };
}

function createStrutEndHalf(p: StrutEndMeasurements): Geometry {
  let main: DrawingPen = draw();

  main = main.movePointerTo([p.offset, 0]);
  main = main.vLineTo(p.halfWidth - p.grooveDepth);
  main = main.hLineTo(p.tenonStart);
  main = main.vLineTo(p.halfWidth);

  if (p.chamferLength > 0) {
    main = main.customCorner(p.chamferLength, "chamfer");
  }
  main = main.hLineTo(p.tenonEnd);
  if (p.chamferLength > 0) {
    main = main.customCorner(p.chamferLength, "chamfer");
  }
  main = main.vLineTo(p.halfWidth - p.grooveDepth);
  main = main.hLineTo(p.cornerLength);

  if (p.chamferLength > 0) {
    main = main.vLineTo(p.halfWidth - p.chamferLength);
    main = main.lineTo([p.cornerLength + p.chamferLength, p.halfWidth]);
    main = main.hLineTo(p.effectiveCornerLength);
  } else if (p.effectiveCornerLength > p.cornerLength) {
    main = main.vLineTo(p.halfWidth);
    main = main.hLineTo(p.effectiveCornerLength);
  }
  main = main.vLineTo(0);

  // let negativeShapes: HelperDrawing[] = []
  let helpers: HelperDrawing[] = [];
  let negativeShapes: DrawingWithLabel[] = [];
  if (p.millingDiameter) {
    const mp1 = drawMillingCircle(
      [p.tenonStart, p.halfWidth - p.grooveDepth],
      "top-left",
      p.millingDiameter,
    );
    helpers.push({ drawing: mp1, color: "red", name: "mp1" });
    negativeShapes.push({ drawing: mp1, name: "mp1" });
    const mp2 = drawMillingCircle(
      [p.tenonEnd, p.halfWidth - p.grooveDepth],
      "top-right",
      p.millingDiameter,
    );
    helpers.push({ drawing: mp2, color: "red", name: "mp2" });
    negativeShapes.push({ drawing: mp2, name: "mp2" });
    const mp3 = drawMillingCircle(
      [p.cornerLength, p.halfWidth - p.grooveDepth],
      "top-left",
      p.millingDiameter,
    );
    helpers.push({ drawing: mp3, color: "red", name: "mp3" });
    negativeShapes.push({ drawing: mp3, name: "mp3" });
  }

  return {
    main: main.close(),
    helpers,
    negativeShapes,
  };
}

function createStrutEnd(p: StrutEndMeasurements): Drawing {
  const half1 = createStrutEndHalf(p);
  const half2 = half1.main.mirror([1, 0], [0, 0], "plane");
  let main = half1.main.fuse(half2);
  half1.negativeShapes.forEach(({ drawing: s, name }) => {
    // Mirror before cutting - `.cut()` consumes (deletes) its operand, so `s` is no longer valid
    // afterward.
    const mirrored = s.mirror([1, 0], [0, 0], "plane");
    try {
      main = main.cut(s);
    } catch (err) {
      throw new Error(`createStrutEnd: cutting negative shape "${name}" failed`, { cause: err });
    }
    try {
      main = main.cut(mirrored);
    } catch (err) {
      throw new Error(`createStrutEnd: cutting mirrored negative shape "${name}" failed`, {
        cause: err,
      });
    }
  });
  return main;
}

function arcStart(
  midPoint: Point2D,
  tangent: Point2D,
  sign: 1 | -1,
  measurements: StrutEndMeasurements,
): Point2D {
  let innA = add2(
    midPoint,
    scale2(tangent, measurements.effectiveCornerLength),
  );
  innA = add2(innA, scale2(rotate90(tangent, sign), measurements.halfWidth));
  return innA;
}

function calculateArcPoints(
  start: Point2D,
  end: Point2D,
  center: Point2D,
  steps: number,
): Point2D[] {
  const va = normalize2(sub2(start, center));
  const vb = normalize2(sub2(end, center));
  const angleA = Math.atan2(va[1], va[0]);
  const angleB = Math.atan2(vb[1], vb[0]);
  let delta = angleB - angleA;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  const angles = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = angleA + (delta * i) / steps;
    return [Math.cos(angle), Math.sin(angle)] as Point2D;
  });
  const da = length2(sub2(start, center));
  const db = length2(sub2(end, center));
  return angles.map((a, i) => {
    const len = da + (i * (db - da)) / steps;
    return add2(center, scale2(a, len));
  });
}

function arcEndpoints(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  aMeasurements: StrutEndMeasurements,
  bMeasurements: StrutEndMeasurements,
): ArcEndpoints {
  const tangentA = tangentDirection2D(a, b, center);
  const tangentB = tangentDirection2D(b, a, center);

  return {
    innA: arcStart(a, tangentA, 1, aMeasurements),
    innB: arcStart(b, tangentB, -1, bMeasurements),
    extA: arcStart(a, tangentA, -1, aMeasurements),
    extB: arcStart(b, tangentB, 1, bMeasurements),
  };
}

function arc(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  aMeasurements: StrutEndMeasurements,
  bMeasurements: StrutEndMeasurements,
): Drawing {
  const { innA, innB, extA, extB } = arcEndpoints(
    a,
    b,
    center,
    aMeasurements,
    bMeasurements,
  );

  let conn = draw();
  const innArcPoints = calculateArcPoints(innA, innB, center, 20); // fixme parametrize
  const extArcPoints = calculateArcPoints(extA, extB, center, 20);

  innArcPoints.forEach((p, i) => {
    if (i == 0) {
      conn = conn.movePointerTo(p);
      return;
    }
    conn = conn.lineTo(p);
  });
  extArcPoints.reverse().forEach((p) => {
    conn = conn.lineTo(p);
  });

  return conn.close();
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
  // Braces on the A / B end. Not yet used to shape the outline - for now each one just shows up
  // as a `braceCenter` helper point (see below), `shift` of the way along the A-B chord.
  braces: StrutBraces = NO_STRUT_BRACES,
): StrutBoundaryManualResult {
  // calculate intersection point

  // const intersection = lineIntersection2D(a, tangentA, b, tangentB);
  // if (!intersection) return nullShoulderGeometry;
  // const distanceToIntersection = length2(sub2(intersection, a));
  let helpers = [
    {
      drawing: drawPointMarker(center, MARKER_RADIUS),
      color: "red",
      name: "center",
    },
    { drawing: drawPointMarker(a, MARKER_RADIUS), color: "green", name: "A" },
    { drawing: drawPointMarker(b, MARKER_RADIUS), color: "green", name: "B" },
  ];

  const endA = precalculateStrutEnd(
    offsetA,
    cornerLength,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    chamferLength,
    millingDiameter,
    grooveDepth,
    halfWidth,
  );
  let strutA = createStrutEnd(endA);
  strutA = strutA.rotate(
    (Math.atan2(center[1] - a[1], center[0] - a[0]) * 180) / Math.PI - 90,
  );
  strutA = strutA.translate(a[0], a[1]);

  const endB = precalculateStrutEnd(
    offsetB,
    cornerLength,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    chamferLength,
    millingDiameter,
    grooveDepth,
    halfWidth,
  );
  let strutB = createStrutEnd(endB);
  strutB = strutB.rotate(
    (Math.atan2(center[1] - b[1], center[0] - b[0]) * 180) / Math.PI + 90,
  );
  strutB = strutB.translate(b[0], b[1]);

  const arcBody = arc(a, b, center, endA, endB);

  helpers = [
    // { drawing: strutB, color: "magenta", name: "shoulder b" },
    // { drawing: strutA, color: "magenta", name: "shoulder a" },
    // { drawing: arcBody, color: "magenta", name: "arc" },
    // ...helpers,
  ];

  // braceCenterNoRounding: for a brace on end A, the point reached by going from A toward B by
  // shift * |AB|; for a brace on end B, the same going from B toward A.
  const chord = sub2(b, a);
  const chordLength = length2(chord);
  const chordDir = normalize2(chord);
  const arcEnds = arcEndpoints(a, b, center, endA, endB);
  const braceEnds: [string, Point2D, Point2D, StrutBraces["a"]][] = [
    ["A", a, chordDir, braces.a],
    ["B", b, scale2(chordDir, -1), braces.b],
  ];
  // Centers of the holes to punch through the strut itself (each brace plate's corner holes).
  const strutHoles: [Point2D, number][] = [];
  let bracePlateA: Drawing | null = null;
  let bracePlateB: Drawing | null = null;
  let bracePlateEndsA: [Point2D, Point2D] | null = null;
  let bracePlateEndsB: [Point2D, Point2D] | null = null;
  const braceMarks: (StrutMark & { braceId: number })[] = [];
  // Middle of each end's tenon, on the strut's axis - where the vertex label goes.
  const endMarks: StrutMark[] = (
    [
      ["A", a, endA, tangentDirection2D(a, b, center)],
      ["B", b, endB, tangentDirection2D(b, a, center)],
    ] as const
  ).map(([end, origin, measurements, axis]) => ({
    end,
    axis,
    point: add2(
      origin,
      scale2(axis, (measurements.tenonStart + measurements.tenonEnd) / 2),
    ),
  }));
  for (const [end, origin, dir, endBraces] of braceEnds) {
    for (const [braceIndex, brace] of endBraces.entries()) {
      const braceCenterNoRounding = add2(
        origin,
        scale2(dir, brace.params.shift * chordLength),
      );
      // Construction points (braceCenterNoRounding, braceInn, braceExt) aren't shown as helpers
      // any more - only the final braceCenter below is. Re-add a helpers.push() for any of them
      // when you need to debug it.

      // braceInn / braceExt: where the ray from the center through braceCenterNoRounding
      // crosses the strut body's inn / ext arc (see arcPointAtAngle). Missing when that point
      // lies angularly outside the arc, e.g. within a shoulder.
      const rayAngle = Math.atan2(
        braceCenterNoRounding[1] - center[1],
        braceCenterNoRounding[0] - center[0],
      );
      const braceInn = arcPointAtAngle(
        arcEnds.innA,
        arcEnds.innB,
        center,
        rayAngle,
      );
      const braceExt = arcPointAtAngle(
        arcEnds.extA,
        arcEnds.extB,
        center,
        rayAngle,
      );
      // braceCenter: halfway between braceInn and braceExt, i.e. the middle of the strut's width
      // at the brace.
      if (braceInn && braceExt) {
        const braceCenter = scale2(add2(braceInn, braceExt), 0.5);
        braceMarks.push({
          braceId: brace.braceId,
          end: end as "A" | "B",
          point: braceCenter,
          axis:
            end === "A"
              ? tangentDirection2D(a, b, center)
              : tangentDirection2D(b, a, center),
        });
        helpers.push({
          drawing: drawPointMarker(braceCenter, MARKER_RADIUS),
          color: "magenta",
          name: `braceCenter ${end} (brace ${brace.braceId})`,
        });

        // The brace plate's rectangle around braceCenter: `width` long along this strut end's
        // axis (the tangent at that end - strutA / strutB above are drawn with their length along
        // it), and as wide as fits between the inn / ext arcs across it, up to `maxPlateWidth`.
        // The plate is drawn from it (see drawBracePlate).
        const endAxis =
          end === "A"
            ? tangentDirection2D(a, b, center)
            : tangentDirection2D(b, a, center);
        const rect = braceRectInArcBand(
          braceCenter,
          endAxis,
          center,
          arcEnds,
          brace.params.width,
          brace.params.maxPlateWidth,
        );
        const plate = rect
          ? drawBracePlate(braceCenter, endAxis, rect, brace.params)
          : null;
        if (rect && brace.params.plateHoleDiameter > 0) {
          const holes = bracePlateHoleCenters(
            rect.halfAlong,
            rect.halfAcross,
            brace.params.plateHoleOffsetLongitudinal,
            brace.params.plateHoleOffsetTransverse,
          );
          for (const hole of placeInPlateFrame(
            braceCenter,
            endAxis,
            holes.corner,
          )) {
            strutHoles.push([hole, brace.params.plateHoleDiameter / 2]);
          }
        }
        // Where the line through braceCenter along the strut end's axis crosses the plate's two
        // sides perpendicular to that axis (its ends) - shown as helper points.
        const plateEnds = rect
          ? placeInPlateFrame(braceCenter, endAxis, [
              [rect.halfAlong, 0],
              [-rect.halfAlong, 0],
            ])
          : null;
        plateEnds?.forEach((point, i) => {
          helpers.push({
            drawing: drawPointMarker(point, MARKER_RADIUS),
            color: "lime",
            name: `bracePlateEnd ${end} point ${i + 1} (brace ${brace.braceId})`,
          });
        });
        if (plate && braceIndex === 0) {
          if (end === "A") bracePlateA = plate.clone();
          else bracePlateB = plate.clone();
          if (plateEnds) {
            const ends: [Point2D, Point2D] = [plateEnds[0], plateEnds[1]];
            if (end === "A") bracePlateEndsA = ends;
            else bracePlateEndsB = ends;
          }
        }
        if (plate) {
          helpers.push({
            drawing: plate,
            color: "yellow",
            name: `bracePlate ${end} (brace ${brace.braceId})`,
          });
        }
      }
    }
  }

  let main = strutA.fuse(arcBody).fuse(strutB);

  // The brace plates' corner holes go through the strut too.
  for (const [holeCenter, holeRadius] of strutHoles) {
    main = main.cut(drawCircle(holeRadius).translate(holeCenter));
  }

  return {
    main: main,
    bracePlateA,
    bracePlateB,
    bracePlateEndsA,
    bracePlateEndsB,
    endMarks,
    braceMarks,
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
