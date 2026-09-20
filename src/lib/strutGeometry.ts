import { draw, drawCircle, drawRoundedRectangle, DrawingPen } from "replicad";
import { Drawing, type Point2D } from "replicad";
import * as THREE from "three";
import type { SceneData } from "./polyhedra";
import { buildVertexAdjacency, computeVertexHubMetrics } from "./polyhedra";
import { add2, sub2, scale2, dot2, cross2, length2, normalize2 } from "./vec2";
import { NO_STRUT_BRACES, type BraceParams, type StrutBraces } from "./braces";
import {
  arcPointAtAngle,
  bracePlateHoleCenters,
  placeInPlateFrame,
  braceRectInArcBand,
  type BraceRect,
  type ArcEndpoints,
} from "./braceGeometry";

// Strut geometry: the flat 2D outline of a strut (and of the brace plates on it) in its own
// "meridian" plane - the plane through an edge's two vertices and the gravity center.
//
// Two functions, two different jobs:
//  - `computeStrutBoundary` is a thin, stable wrapper: it takes 3D THREE.Vector3 inputs,
//    projects them onto the flat plane through a/b/center (see computeStrutPlane) and hands off
//    2D coordinates.
//  - `computeStrutBoundary2D` (further down) is where the shape is actually built: pure replicad
//    2D, no THREE.js, no 3D at all. It takes offsetA/offsetB, the corner lengths, halfWidth and
//    the groove/milling/chamfer params, plus the two vertices and the gravity center as flat 2D
//    points already in the strut's own plane.
//
// The bottom of the file keeps the older, hand-rolled sketch code (`computeStrutSketch` and its
// helpers, built on plain Vec2 math instead of replicad) - only the /edge-sketch debug page uses
// it now.

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

export interface StrutBoundaryResult {
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
// along +Y - used to make center->B vertical, see computeStrutBoundary below.
export function alignVertical(p: Point2D, alignWith: Point2D): Point2D {
  const up = normalize2(alignWith);
  const right: Point2D = [up[1], -up[0]];
  return [dot2(p, right), dot2(p, up)];
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
// same idea as the legacy sketch code's tangentDirectionFromOrigin2D (centered on the origin): perpendicular to the radius
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
// flat 2D coordinates for computeStrutBoundary2D. Rather than keep computeStrutPlane's own
// A-aligned xDir, `alignVertical` re-rotates everything (still around the gravity center, so it
// doesn't change anything's shape or relative position) so that center->B comes out pointing
// straight up (+Y) instead - simpler to reason about, and createShoulderGeometry's own right/up
// basis (see below) still works out correctly for A even though A isn't vertically aligned.
function computeStrutBoundaryUnguarded(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  offsetA: number,
  offsetB: number,
  // Each end's own corner length (a vertex can override the global one - see App's
  // vertexCornerLength).
  cornerLengthA: number,
  cornerLengthB: number,
  halfWidth: number,
  endGrooveLengthPercent: number,
  midGrooveLengthPercent: number,
  grooveDepth: number,
  millingDiameter: number,
  chamferLength: number,
  // Braces lying on the A / B end of this strut (see braces.ts); empty lists mean none.
  braces: StrutBraces = NO_STRUT_BRACES,
): StrutBoundaryResult {
  const plane = computeStrutPlane(a, b, center);
  const yDir = plane.normal.clone().cross(plane.xDir).normalize();

  const aRaw = toLocal2D(a, plane.origin, plane.xDir, yDir);
  const bRaw = toLocal2D(b, plane.origin, plane.xDir, yDir);
  const centerRaw = toLocal2D(center, plane.origin, plane.xDir, yDir);

  // const a2 = alignVertical(aRaw, bRaw);
  // const b2 = alignVertical(bRaw, bRaw);
  // const center2 = alignVertical(centerRaw, bRaw);

  return computeStrutBoundary2D(
    aRaw,
    bRaw,
    centerRaw,
    offsetA,
    offsetB,
    cornerLengthA,
    cornerLengthB,
    halfWidth,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
    braces,
  );
}

// Everything computeStrutBoundary takes, as plain JSON-friendly data (vectors as [x, y, z]).
// When the computation throws we dump this to the console; the /strut-shape-debug page can import
// it ("Import failure JSON") to reproduce the exact same call.
export interface StrutBoundaryInput {
  a: [number, number, number];
  b: [number, number, number];
  center: [number, number, number];
  offsetA: number;
  offsetB: number;
  cornerLengthA: number;
  cornerLengthB: number;
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
export function strutBoundaryInputToJson(
  input: StrutBoundaryInput,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    { ...extra, input },
    (_key, value) => (typeof value === "number" && !Number.isFinite(value) ? String(value) : value),
    2,
  );
}

// Accepts either the full dump (`{ error, input: {...} }`) or a bare input object.
export function strutBoundaryInputFromJson(json: string): StrutBoundaryInput {
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
  const input = candidate as Partial<StrutBoundaryInput>;
  for (const key of ["a", "b", "center"] as const) {
    const v = input[key];
    if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== "number")) {
      throw new Error(`"${key}" must be an [x, y, z] array of numbers`);
    }
  }
  // Dumps from before corner length could differ per end carry a single `cornerLength`.
  const legacy = input as { cornerLength?: number };
  if (typeof legacy.cornerLength === "number") {
    input.cornerLengthA ??= legacy.cornerLength;
    input.cornerLengthB ??= legacy.cornerLength;
  }
  for (const key of [
    "offsetA",
    "offsetB",
    "cornerLengthA",
    "cornerLengthB",
    "halfWidth",
    "endGrooveLengthPercent",
    "midGrooveLengthPercent",
    "grooveDepth",
    "millingDiameter",
    "chamferLength",
  ] as const) {
    if (typeof input[key] !== "number") throw new Error(`"${key}" must be a number`);
  }
  return { ...(input as StrutBoundaryInput), braces: input.braces ?? NO_STRUT_BRACES };
}

// Public entry point. Same as computeStrutBoundaryUnguarded, but if that throws, logs
// everything needed to reproduce the call as JSON (copy it from the console and paste it into
// /strut-shape-debug via "Import failure JSON"), then rethrows so callers behave as before.
export function computeStrutBoundary(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  offsetA: number,
  offsetB: number,
  // Each end's own corner length (a vertex can override the global one - see App's
  // vertexCornerLength).
  cornerLengthA: number,
  cornerLengthB: number,
  halfWidth: number,
  endGrooveLengthPercent: number,
  midGrooveLengthPercent: number,
  grooveDepth: number,
  millingDiameter: number,
  chamferLength: number,
  // Braces lying on the A / B end of this strut (see braces.ts); empty lists mean none.
  braces: StrutBraces = NO_STRUT_BRACES,
): StrutBoundaryResult {
  try {
    return computeStrutBoundaryUnguarded(
      a,
      b,
      center,
      offsetA,
      offsetB,
      cornerLengthA,
      cornerLengthB,
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
      const json = strutBoundaryInputToJson(
        {
          a: a.toArray(),
          b: b.toArray(),
          center: center.toArray(),
          offsetA,
          offsetB,
          cornerLengthA,
          cornerLengthB,
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
        "computeStrutBoundary threw. To reproduce: open /strut-shape-debug and paste the JSON below into \"Import failure JSON\":",
        err,
      );
      console.error(json);
    } catch (dumpErr) {
      console.error("computeStrutBoundary threw, and dumping its inputs failed too", dumpErr);
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

export function computeStrutBoundary2D(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  offsetA: number,
  offsetB: number,
  // Each end's own corner length (a vertex can override the global one - see App's
  // vertexCornerLength).
  cornerLengthA: number,
  cornerLengthB: number,
  halfWidth: number,
  endGrooveLengthPercent: number,
  midGrooveLengthPercent: number,
  grooveDepth: number,
  millingDiameter: number,
  chamferLength: number,
  // Braces on the A / B end. Not yet used to shape the outline - for now each one just shows up
  // as a `braceCenter` helper point (see below), `shift` of the way along the A-B chord.
  braces: StrutBraces = NO_STRUT_BRACES,
): StrutBoundaryResult {
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
    cornerLengthA,
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
    cornerLengthB,
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

const EPS = 1e-9;

// The meridian plane for an edge: the flat plane through both vertices and the gravity center -
// exactly the plane sheet material for this strut lies in. Falls back to an arbitrary plane
// through the edge if the two vertices and the center are (nearly) collinear, which shouldn't
// happen for real dome geometry.
export function computeStrutPlane(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
): { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 } {
  const ca = a.clone().sub(center)
  const cb = b.clone().sub(center)
  let normal = ca.clone().cross(cb)
  if (normal.lengthSq() < EPS) {
    const edgeDir = b.clone().sub(a).normalize()
    const arbitrary = Math.abs(edgeDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    normal = edgeDir.clone().cross(arbitrary)
  }
  normal.normalize()

  const xDir = ca.lengthSq() > EPS ? ca.normalize() : new THREE.Vector3(1, 0, 0)
  return { origin: center.clone(), normal, xDir }
}

// minOffset for every edge-end in the model, keyed by edge id then by the vertex id at that
// end - built by running the same per-vertex hub-metric computation the HUD uses
// (computeVertexHubMetrics) for every vertex, so struts get the exact miter offsets the HUD
// already shows for each hub.
export function computeEdgeEndOffsets(
  data: SceneData,
  transformedVertices: ReadonlyMap<number, THREE.Vector3>,
  edgeThicknessOf: (edgeId: number) => number,
): Map<number, Map<number, number>> {
  const center = new THREE.Vector3(0, 0, 0)
  const positionOf = (id: number) => transformedVertices.get(id)!
  const adjacency = buildVertexAdjacency(data.edges)

  const result = new Map<number, Map<number, number>>()
  for (const vertexId of transformedVertices.keys()) {
    const edges = adjacency.get(vertexId) ?? []
    const metrics = computeVertexHubMetrics(positionOf(vertexId), center, edges, positionOf, edgeThicknessOf)
    for (const m of metrics) {
      let byVertex = result.get(m.edgeId)
      if (!byVertex) {
        byVertex = new Map()
        result.set(m.edgeId, byVertex)
      }
      byVertex.set(vertexId, m.offsetMm)
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// Legacy hand-rolled sketch (used by the /edge-sketch debug page only)
// ---------------------------------------------------------------------------------------------

export type Vec2 = [number, number]

// Rotates a 2D vector by 90 degrees - used as a fallback tangent direction when the direct
// computation is degenerate.
function perp2(a: Vec2): Vec2 {
  return [-a[1], a[0]]
}

// The tangent direction at `from`, in the plane's local coordinates (where the gravity center
// sits at the origin), leaning as much as possible toward `toward` - i.e. the component of
// (toward - from) perpendicular to the radius from the origin to `from`. Mirrors the 3D
// `tangentDirection` this replaces, just expressed in-plane where the center is the origin.
function tangentDirectionFromOrigin2D(from: Vec2, toward: Vec2): Vec2 {
  const radial = normalize2(from)
  const alongEdge = sub2(toward, from)
  let tangent = sub2(alongEdge, scale2(radial, dot2(alongEdge, radial)))
  if (length2(tangent) < EPS) tangent = perp2(radial)
  return normalize2(tangent)
}

export interface ToothParams {
  // A tooth only appears where its budget fits and this is positive - 0 (or too little room
  // along the lead-in) falls back to the plain straight line, so this doubles as an on/off
  // switch.
  height: number
  length: number
  chamfer: number
  millRadius: number
}

// The via point for a semicircular arc of radius `r`, centered at `center`, bulging toward unit
// direction `bulgeDir`.
function semicircleVia(center: Vec2, bulgeDir: Vec2, r: number): Vec2 {
  return add2(center, scale2(bulgeDir, r))
}

// A straight boundary run (from -> to) with a rectangular interlocking tooth cut into its
// middle: straight flanks rising the full `height` perpendicular to `tangent` from each (still
// sharp) base corner, a flat top `length` wide and exactly parallel to `tangent`, a chamfer
// clipping each of the tooth's two (convex) top corners, and - at each of the tooth's two
// (concave) base corners - a semicircular "dogbone"/"T-bone" mill relief cut into the main line
// just before the corner, rather than rounding the corner itself: one end of the semicircle
// sits exactly on the (still sharp) corner, the other sits further out at twice the mill radius,
// and the arc bulges into the solid (away from the tooth, i.e. a bite taken out of the material,
// not a bump added to it). A real round mill bit can't cut a sharp concave corner, so without
// this relief it would leave a rounded remnant blocking a square mating part from seating flush.
// `tangent` is the true lead-in direction (tA/tB) shared by both the outer and
// inner call for this end, rather than each side's own (very slightly non-parallel) offset line -
// so the tooth's top and sides end up exactly parallel/perpendicular to the actual corner line, and
// the outer and inner teeth end up exact mirror images of each other. `side` is +1 to have the
// tooth protrude away from the gravity center (the outer boundary) or -1 toward it (the inner
// boundary). Falls back to a plain line if there's no positive height, or not enough room along
// the run for the tooth's own length plus its relief cuts.
function buildToothedRun(
  from: Vec2,
  to: Vec2,
  tangent: Vec2,
  side: 1 | -1,
  tooth: ToothParams,
): { to: Vec2; seg: PathSegment }[] {
  const runLength = dot2(sub2(to, from), tangent)
  const millRadius = Math.max(tooth.millRadius, 0)
  if (tooth.height <= EPS || runLength < EPS) return [{ to, seg: { kind: 'line' } }]

  const midpoint = scale2(add2(from, to), 0.5)
  const outward = normalize2(midpoint)
  // The component of the radial-outward direction perpendicular to `tangent` - same "project out
  // the parallel part" trick as tangentDirectionFromOrigin2D, just for the other axis.
  let heightDir = sub2(outward, scale2(tangent, dot2(outward, tangent)))
  if (length2(heightDir) < EPS) heightDir = perp2(tangent)
  heightDir = scale2(normalize2(heightDir), side)

  const half = tooth.length / 2
  if (half <= EPS || half + 2 * millRadius > runLength / 2 - EPS) return [{ to, seg: { kind: 'line' } }]

  const baseLeft = add2(midpoint, scale2(tangent, -half))
  const baseRight = add2(midpoint, scale2(tangent, half))
  const chamfer = Math.max(Math.min(tooth.chamfer, tooth.height, half), 0)

  const path: { to: Vec2; seg: PathSegment }[] = []

  if (millRadius > EPS) {
    // A straight run up to 2r before the corner, then a semicircle (center r before the corner,
    // bulging into the solid, away from the tooth) that ends exactly on the still-sharp corner.
    const entryCenter = sub2(baseLeft, scale2(tangent, millRadius))
    path.push({ to: sub2(baseLeft, scale2(tangent, 2 * millRadius)), seg: { kind: 'line' } })
    path.push({
      to: baseLeft,
      seg: { kind: 'arc', via: semicircleVia(entryCenter, scale2(heightDir, -1), millRadius) },
    })
  } else {
    path.push({ to: baseLeft, seg: { kind: 'line' } })
  }

  const sharpTopLeft = add2(baseLeft, scale2(heightDir, tooth.height))
  const sharpTopRight = add2(baseRight, scale2(heightDir, tooth.height))

  if (chamfer > EPS) {
    path.push({ to: sub2(sharpTopLeft, scale2(heightDir, chamfer)), seg: { kind: 'line' } })
    path.push({ to: add2(sharpTopLeft, scale2(tangent, chamfer)), seg: { kind: 'line' } })
    path.push({ to: sub2(sharpTopRight, scale2(tangent, chamfer)), seg: { kind: 'line' } })
    path.push({ to: sub2(sharpTopRight, scale2(heightDir, chamfer)), seg: { kind: 'line' } })
  } else {
    path.push({ to: sharpTopLeft, seg: { kind: 'line' } })
    path.push({ to: sharpTopRight, seg: { kind: 'line' } })
  }

  path.push({ to: baseRight, seg: { kind: 'line' } })
  if (millRadius > EPS) {
    // Mirror of the entry: starts exactly on the (still-sharp) corner, semicircles out to the
    // point 2r past it, then a plain line resumes for the rest of the run.
    const exitCenter = add2(baseRight, scale2(tangent, millRadius))
    path.push({
      to: add2(baseRight, scale2(tangent, 2 * millRadius)),
      seg: { kind: 'arc', via: semicircleVia(exitCenter, scale2(heightDir, -1), millRadius) },
    })
  }
  path.push({ to, seg: { kind: 'line' } })

  return path
}

// Reverses a path (start -> path[0].to -> path[1].to -> ...) into one that walks the same points
// backwards. Segment kinds/via-points are direction-agnostic (a line or a three-point arc looks
// the same walked either way), so they just get replayed in reverse order.
function reversePath(
  start: Vec2,
  path: { to: Vec2; seg: PathSegment }[],
): { start: Vec2; path: { to: Vec2; seg: PathSegment }[] } {
  const points = [start, ...path.map((p) => p.to)].reverse()
  const segs = path.map((p) => p.seg).reverse()
  return { start: points[0], path: segs.map((seg, i) => ({ to: points[i + 1], seg })) }
}

// Where two rays (from p1 along d1, from p2 along d2, both length `cornerLength`) cross, if they
// do so within both rays' own length. Returns the crossing point and how far along each ray (as
// a 0-1 fraction of `cornerLength`) it sits.
function findLeadInIntersection(
  p1: Vec2,
  d1: Vec2,
  p2: Vec2,
  d2: Vec2,
  cornerLength: number,
): { point: Vec2; t: number; s: number } | null {
  const D1 = scale2(d1, cornerLength)
  const D2 = scale2(d2, cornerLength)
  const denom = cross2(D1, D2)
  if (Math.abs(denom) < EPS) return null

  const diff = sub2(p2, p1)
  const t = cross2(diff, D2) / denom
  const s = cross2(diff, D1) / denom
  const EDGE_EPS = 1e-6
  if (t < -EDGE_EPS || t > 1 + EDGE_EPS || s < -EDGE_EPS || s > 1 + EDGE_EPS) return null

  const clampedT = Math.min(Math.max(t, 0), 1)
  return { point: add2(p1, scale2(D1, clampedT)), t: clampedT, s }
}

export type PathSegment = { kind: 'line' } | { kind: 'arc'; via: Vec2 }

export interface SketchPath {
  start: Vec2
  // Ordered path from `start`, through each `to` in turn.
  path: { to: Vec2; seg: PathSegment }[]
}

export interface StrutSketch extends SketchPath {
  planeOrigin: THREE.Vector3
  planeNormal: THREE.Vector3
  planeXDir: THREE.Vector3
  // The trimmed, mitered centerline `path` was built by offsetting (see the module doc) -
  // exposed mainly for debugging/visualization (e.g. the edge-sketch debug view), not needed to
  // build the solid itself.
  centerline: SketchPath
}

function toLocal(
  p: THREE.Vector3,
  plane: { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 },
  yDir: THREE.Vector3,
): Vec2 {
  const rel = p.clone().sub(plane.origin)
  return [rel.dot(plane.xDir), rel.dot(yDir)]
}

// Offsets a point (in local coordinates, where the gravity center is the origin) radially by
// `dist`, i.e. toward/away from the center - toward if `dist` is negative.
function offsetRadial(p: Vec2, dist: number): Vec2 {
  return add2(p, scale2(normalize2(p), dist))
}

// The flat sketch outline for one strut: the trimmed, mitered centerline (see
// computeStrutPlane's doc and the module-level algorithm this implements) turned into a closed
// polygon by offsetting it radially by `halfWidth` on each side, with an interlocking tooth cut
// into each end's straight lead-in on both sides (see buildToothedRun) if `tooth.height` is
// positive. Returns null for degenerate input (a vertex sitting on the gravity center -
// shouldn't happen for real dome geometry).
export function computeStrutSketch(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  tooth: ToothParams,
): StrutSketch | null {
  const plane = computeStrutPlane(a, b, center)
  const yDir = plane.normal.clone().cross(plane.xDir).normalize()

  const A = toLocal(a, plane, yDir)
  const B = toLocal(b, plane, yDir)
  if (length2(A) < EPS || length2(B) < EPS) return null

  // A degenerate offset computation (e.g. NaN/Infinity from a vertex with a near-0 or near-360
  // angle between edges) falls back to the full cornerLength budget - the safer of the two
  // directions to be wrong in, since it over-trims rather than risking overlap.
  const clampOffset = (offset: number): number =>
    Number.isFinite(offset) ? Math.min(Math.max(offset, 0), cornerLength) : cornerLength

  const tA = tangentDirectionFromOrigin2D(A, B)
  const tB = tangentDirectionFromOrigin2D(B, A)

  const corner = findLeadInIntersection(A, tA, B, tB, cornerLength)

  let offsetALimit = clampOffset(offsetA)
  let offsetBLimit = clampOffset(offsetB)
  if (corner) {
    offsetALimit = Math.min(offsetALimit, corner.t * cornerLength)
    offsetBLimit = Math.min(offsetBLimit, corner.s * cornerLength)
  }

  const trimmedA = add2(A, scale2(tA, offsetALimit))
  const trimmedB = add2(B, scale2(tB, offsetBLimit))

  // The centerline's key points and the segment used to reach each from the previous one.
  const centerline: { pt: Vec2; seg: PathSegment }[] = [{ pt: trimmedA, seg: { kind: 'line' } }]

  if (corner) {
    centerline.push({ pt: corner.point, seg: { kind: 'line' } })
    centerline.push({ pt: trimmedB, seg: { kind: 'line' } })
  } else {
    const eA = add2(A, scale2(tA, cornerLength))
    const eB = add2(B, scale2(tB, cornerLength))
    // The two lead-ins' free ends may sit at slightly different distances from the gravity
    // center (the vertices need not share a sphere); snap both onto their average radius so a
    // single circle, centered at the gravity center, passes through both exactly.
    const radius = (length2(eA) + length2(eB)) / 2
    const eAu = normalize2(eA)
    const eBu = normalize2(eB)
    const eAr = scale2(eAu, radius)
    const eBr = scale2(eBu, radius)
    const viaDir = normalize2(add2(eAu, eBu))
    const via = scale2(viaDir, radius)

    centerline.push({ pt: eAr, seg: { kind: 'line' } })
    centerline.push({ pt: eBr, seg: { kind: 'arc', via } })
    centerline.push({ pt: trimmedB, seg: { kind: 'line' } })
  }

  // Turns each centerline segment into its outer (away from center) and inner (toward center)
  // boundary counterpart. A line segment's boundary is normally the line between its two
  // endpoints' radial offsets (the same per-point-offset approximation the old three.js beam
  // used) - except the first and last (always the two straight lead-ins, one per vertex end),
  // which get an interlocking tooth cut into their middle instead, mirrored between the outer
  // and inner sides. An arc segment's boundary is an exact concentric arc, at radius +/-
  // halfWidth, since it's already centered at the origin.
  const outerStart = offsetRadial(centerline[0].pt, halfWidth)
  const innerStart = offsetRadial(centerline[0].pt, -halfWidth)
  const outerPath: { to: Vec2; seg: PathSegment }[] = []
  const innerPath: { to: Vec2; seg: PathSegment }[] = []

  for (let i = 1; i < centerline.length; i++) {
    const { pt, seg } = centerline[i]

    if (seg.kind === 'arc') {
      const outerRadius = length2(seg.via) + halfWidth
      const innerRadius = length2(seg.via) - halfWidth
      const viaDir = normalize2(seg.via)
      outerPath.push({ to: offsetRadial(pt, halfWidth), seg: { kind: 'arc', via: scale2(viaDir, outerRadius) } })
      innerPath.push({ to: offsetRadial(pt, -halfWidth), seg: { kind: 'arc', via: scale2(viaDir, innerRadius) } })
      continue
    }

    const isLeadIn = i === 1 || i === centerline.length - 1
    const prevPt = centerline[i - 1].pt
    const outerFrom = offsetRadial(prevPt, halfWidth)
    const outerTo = offsetRadial(pt, halfWidth)
    const innerFrom = offsetRadial(prevPt, -halfWidth)
    const innerTo = offsetRadial(pt, -halfWidth)
    if (isLeadIn) {
      // The true lead-in direction (tA at the a-side, -tB at the b-side, since that segment
      // walks from the corner/arc-start back toward B) - shared by both the outer and inner
      // call, rather than each side's own (very slightly non-parallel) offset line.
      const leadTangent = i === 1 ? tA : scale2(tB, -1)
      outerPath.push(...buildToothedRun(outerFrom, outerTo, leadTangent, 1, tooth))
      innerPath.push(...buildToothedRun(innerFrom, innerTo, leadTangent, -1, tooth))
    } else {
      outerPath.push({ to: outerTo, seg: { kind: 'line' } })
      innerPath.push({ to: innerTo, seg: { kind: 'line' } })
    }
  }

  const { start: innerReversedStart, path: innerReversedPath } = reversePath(innerStart, innerPath)
  const path: { to: Vec2; seg: PathSegment }[] = [
    ...outerPath,
    // End cap at the b-side.
    { to: innerReversedStart, seg: { kind: 'line' } },
    ...innerReversedPath,
  ]
  // Closing the loop back to `start` (the a-side end cap) is left to the caller's sketcher.

  const centerlinePath: { to: Vec2; seg: PathSegment }[] = centerline
    .slice(1)
    .map(({ pt, seg }) => ({ to: pt, seg }))

  return {
    planeOrigin: plane.origin,
    planeNormal: plane.normal,
    planeXDir: plane.xDir,
    start: outerStart,
    path,
    centerline: { start: centerline[0].pt, path: centerlinePath },
  }
}

