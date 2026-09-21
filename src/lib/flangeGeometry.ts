import { draw, drawCircle } from "replicad";
import { Drawing, type Point2D } from "replicad";
import type {
  HelperDrawing,
  StrutEndMeasurements,
} from "./strutGeometry";
import { add2, length2 } from "./vec2";

// A sandbox for hand-building the "flange" part - a flat connector plate at a hub vertex,
// covering the wedges between struts that have no face between them (see get_edges_info's
// hasFaceToNextEdge). Same idea as strutGeometry.ts's computeStrutBoundary2D, just
// centered on a vertex instead of running the length of one strut. See flange-shape-debug
// (`npm run flange-shape-debug`) - edit computeFlangeBoundary2D and save to see the result there.
//
// Shape matches exactly what App.tsx's "Get Edges Info" button exports per vertex, so a real
// vertex picked out of that JSON can be pasted straight in as FlangeVertexInput.

// One edge (strut) meeting at this hub vertex.
export interface FlangeEdgeInput {
  edgeId: number;
  neighborId: number;
  // This edge's own beam thickness (its override, or the model's default), mm.
  thicknessMm: number;
  // The miter offset this end is trimmed back by - same value precalculateStrutEnd was given.
  offsetMm: number;
  // The shouldered-tenon layout for this strut end (see precalculateStrutEnd in
  // strutGeometry.ts) - effectiveCornerLength is the one that matters here: how far out
  // this strut's own material actually reaches from the vertex.
  strutEnd: StrutEndMeasurements;
  // This edge's direction, projected onto the vertex's tangent plane, as an angle (degrees,
  // 0-360) from the plane's e1 axis toward e2.
  projectedAngleDeg: number;
  // Angle (degrees), going around the tangent plane, from this edge to the next one in `edges`
  // (wrapping back to the first after the last) - i.e. the wedge this edge and the next one
  // bound between them.
  angleToNextEdgeDeg: number;
  // Whether a face already fills that wedge - a flange plate only needs to bridge the open
  // (no-face) ones.
  hasFaceToNextEdge: boolean;
  faceIdToNextEdge: number | null;
}

export interface FlangeVertexInput {
  vertexId: number;
  // In ascending `projectedAngleDeg` order, same as get_edges_info reports them.
  edges: FlangeEdgeInput[];
  // Set (to the global foot parameters) when this vertex is marked as a "foot" - undefined for an
  // ordinary hub vertex.
  foot?: FootParams;
}

export interface FlangeShapeParams {
  // Extra clearance (mm) added to a strut's own reach along its length - widens the plate
  // lengthwise and shifts the side holes further out with it, to fit assembly tolerances.
  toleranceLongitudinal: number;
  // Extra clearance (mm) added across a strut's width - widens the plate side-to-side and
  // pushes the side holes further apart with it.
  toleranceTransverse: number;
  // Diameter (mm) of the bolt hole at the vertex itself, shared by every strut arm's plate.
  centerHoleDiameter: number;
  // Diameter (mm) of each strut arm's own bolt holes - one on either side of its centerline.
  sideHoleDiameter: number;
  // Distance (mm) from a strut's own centerline to each of its two side holes' centers.
  sideHoleDiameterOffset: number;
  // How far (mm) the plate's outer edge extends past a strut's own effectiveCornerLength - a
  // practical "cut past the theoretical point" margin, so the plate doesn't end exactly at the
  // strut's mathematical corner.
  overshoot: number;
  // Minimum plate width (mm), measured across a strut's own centerline - clamps how narrow the
  // plate is allowed to get (e.g. a strut whose own thickness/tolerance would otherwise pinch it
  // thinner than this).
  minSide: number;
  // Diameter (mm) of the relief circle tucked into the plate's own inside corners, same idea as
  // strutGeometry.ts's precalculateStrutEnd - clears room for a round end mill at a square
  // notch.
  millingDiameter: number;
}

export const DEFAULT_FLANGE_SHAPE_PARAMS: FlangeShapeParams = {
  toleranceLongitudinal: 2,
  toleranceTransverse: 1,
  centerHoleDiameter: 8,
  sideHoleDiameter: 6,
  sideHoleDiameterOffset: 6,
  overshoot: 0,
  minSide: 20,
  millingDiameter: 5,
};

// The flange parameters a single vertex can override (all of them), with the labels the Sidebar
// shows for them.
export const FLANGE_PARAM_FIELDS: { key: keyof FlangeShapeParams; label: string }[] = [
  { key: "toleranceLongitudinal", label: "Tolerance longitudinal (mm)" },
  { key: "toleranceTransverse", label: "Tolerance transverse (mm)" },
  { key: "centerHoleDiameter", label: "Center hole diameter (mm)" },
  { key: "sideHoleDiameter", label: "Side hole diameter (mm)" },
  { key: "sideHoleDiameterOffset", label: "Side hole diameter offset (mm)" },
  { key: "overshoot", label: "Overshoot (mm)" },
  { key: "minSide", label: "Min side (mm)" },
  { key: "millingDiameter", label: "Flange milling diameter (mm)" },
];

// The global flange params with one vertex's own overrides (if any) laid over them.
export function resolveFlangeParams(
  base: FlangeShapeParams,
  overrides: Partial<FlangeShapeParams> | undefined,
): FlangeShapeParams {
  return overrides ? { ...base, ...overrides } : base;
}

// The dimensions of a "foot" - what a vertex marked as one gets built with. One shared set for the
// whole dome (unlike FlangeShapeParams there's no per-vertex override yet); each vertex is only
// flagged as a foot or not.
export interface FootParams {
  // How far (mm) the foot reaches.
  length: number;
  // How thick (mm) the foot is.
  thickness: number;
  // Length (mm) of the groove cut into the foot.
  grooveLength: number;
}

export const DEFAULT_FOOT_PARAMS: FootParams = {
  length: 50,
  thickness: 10,
  grooveLength: 20,
};

// The foot parameters, with the labels the Sidebar shows for them.
export const FOOT_PARAM_FIELDS: { key: keyof FootParams; label: string }[] = [
  { key: "length", label: "Foot length (mm)" },
  { key: "thickness", label: "Foot thickness (mm)" },
  { key: "grooveLength", label: "Foot groove length (mm)" },
];

export function footParamsEqual(a: FootParams, b: FootParams): boolean {
  return a.length === b.length && a.thickness === b.thickness && a.grooveLength === b.grooveLength;
}

// The middle of one strut's rectangular tenon hole in the flange plate: which strut (edge), where,
// the direction along the hole (degrees) and how wide the hole is across it.
export interface FlangeEdgeMark {
  edgeId: number;
  center: Point2D;
  angleDeg: number;
  holeWidth: number;
}

export interface FlangeBoundaryResult {
  main: Drawing | null;
  edgeMarks: FlangeEdgeMark[];
  helpers: HelperDrawing[];
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

const DEG2RAD = Math.PI / 180;

function polar(angleDeg: number, radius: number): Point2D {
  const rad = angleDeg * DEG2RAD;
  return [radius * Math.cos(rad), radius * Math.sin(rad)];
}

function rotate2D(p: Point2D, degrees: number): Point2D {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);

  return [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos];
}

function lineIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): Point2D | null {
  const dax = a2[0] - a1[0];
  const day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0];
  const dby = b2[1] - b1[1];

  const det = dax * dby - day * dbx;

  if (Math.abs(det) < 1e-9) return null;

  const dx = b1[0] - a1[0];
  const dy = b1[1] - a1[1];

  const t = (dx * dby - dy * dbx) / det;

  return [a1[0] + t * dax, a1[1] + t * day];
}

export function moveAwayFromOrigin(p: Point2D, n: number): Point2D {
  const len = Math.hypot(p[0], p[1]);
  if (len < 1e-9) return p;

  const scale = (len + n) / len;

  return [p[0] * scale, p[1] * scale];
}

export function perpendicularFoot(center: Point2D, a: Point2D, b: Point2D): Point2D {
  const ab: Point2D = [b[0] - a[0], b[1] - a[1]];

  const ac: Point2D = [center[0] - a[0], center[1] - a[1]];

  const lenSq = ab[0] * ab[0] + ab[1] * ab[1];

  if (lenSq < 1e-12) {
    throw new Error("A and B must be different points");
  }

  const t = (ac[0] * ab[0] + ac[1] * ab[1]) / lenSq;

  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

const SEGMENTS_COUNT = 50;
const HOLE_COLOR = "#12141a";

// Side bolt holes flanking this strut's own centerline, at its real (non-overshot) end.
function computeSideHoles(
  edge: FlangeEdgeInput,
  params: FlangeShapeParams,
): { holeA: Drawing; holeB: Drawing } {
  const holeBasis = (edge.strutEnd.tenonStart + edge.strutEnd.tenonEnd) / 2;
  const holeShift = edge.thicknessMm / 2 + params.sideHoleDiameterOffset;

  const tip = polar(edge.projectedAngleDeg, holeBasis);
  const holeA = add2(tip, polar(edge.projectedAngleDeg + 90, holeShift));
  const holeB = add2(tip, polar(edge.projectedAngleDeg - 90, holeShift));

  return {
    holeA: drawCircle(params.sideHoleDiameter / 2).translate(holeA),
    holeB: drawCircle(params.sideHoleDiameter / 2).translate(holeB),
  };
}

// The two points (in `edge`'s own local frame) where the wedge between `edge` and `next` starts
// and ends - `nextLocalStart` is `end` before it's rotated into `edge`'s frame, and is also the
// anchor `next`'s own side-of-the-wedge shape is built from.
function computeWedgeBoundary(
  edge: FlangeEdgeInput,
  next: FlangeEdgeInput,
  params: FlangeShapeParams,
): { start: Point2D; end: Point2D; nextLocalStart: Point2D } {
  const start: Point2D = [
    edge.strutEnd.cornerLength + params.overshoot,
    edge.thicknessMm / 2 + params.toleranceTransverse,
  ];
  const nextLocalStart: Point2D = [
    next.strutEnd.cornerLength + params.overshoot,
    -next.thicknessMm / 2 - params.toleranceTransverse,
  ];
  const end = rotate2D(nextLocalStart, edge.angleToNextEdgeDeg);

  return { start, end, nextLocalStart };
}

// Mill-relief cuts at the wedge's own corner (where this edge's reach meets the next edge's),
// only needed once tolerance/overshoot actually pushes the corner out into a shape a round mill
// bit couldn't otherwise clear.
function computeWedgeCornerMillingCuts(
  edge: FlangeEdgeInput,
  next: FlangeEdgeInput,
  params: FlangeShapeParams,
): { millingCutA: Drawing; millingCutB: Drawing } | null {
  if (params.overshoot == 0) return null;

  const millingCutA = drawMillingCircle(
    [
      edge.strutEnd.cornerLength - params.toleranceLongitudinal,
      edge.thicknessMm / 2 + params.toleranceTransverse,
    ],
    "bottom-right",
    params.millingDiameter,
  ).rotate(edge.projectedAngleDeg);

  const millingCutB = drawMillingCircle(
    [
      next.strutEnd.cornerLength - params.toleranceLongitudinal,
      -next.thicknessMm / 2 - params.toleranceTransverse,
    ],
    "top-right",
    params.millingDiameter,
  ).rotate(next.projectedAngleDeg);

  return { millingCutA, millingCutB };
}

// ---------------------------------------------------------------------------------------------
// The plate's outline
//
// The plate itself is one simple closed shape with no holes in it (everything that is cut out of
// it - bolt holes, tenon slots, mill reliefs - is subtracted afterwards as a "negative"). So
// instead of building it out of overlapping pieces and fusing them, we walk once around its
// boundary, counter-clockwise, collecting points, and draw the whole thing in one go.
//
// Going around, every edge (strut arm) contributes two runs of points, in this order:
//   1. computeTipPoints: the end of its arm, from the corner on its clockwise (-y) side to the one
//      on its counter-clockwise (+y) side.
//   2. computeWedgePoints: the boundary of the wedge between it and the next edge, from its own
//      +y corner over to the next edge's -y corner.
// Both are in world (vertex-centered) coordinates. Neighbouring runs share their corner points;
// computeFlangeOutline drops the duplicates.
// ---------------------------------------------------------------------------------------------

// Segments per rounded corner ("ear") at the end of a wedge side - a quarter circle of radius
// about minSide, so this is plenty smooth (sagitta well below 0.1 mm).
const EAR_ARC_SEGMENTS = 24;

// A reflex open wedge is closed off behind the vertex by a straight line between two points on the
// plate's two sides. They're found by casting a beam from the vertex on either side of the wedge's
// bisector, this many degrees away from it, and seeing where each hits its side.
const WEDGE_BEAM_SPREAD_DEG = 20;

// Two outline points closer than this (mm) are the same point.
const OUTLINE_POINT_TOLERANCE = 1e-6;

// Points on a circle, from `fromDeg` to `toDeg` (counter-clockwise when toDeg > fromDeg), both
// ends included.
function circleArcPoints(
  center: Point2D,
  radius: number,
  fromDeg: number,
  toDeg: number,
  steps: number,
): Point2D[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = polar(fromDeg + ((toDeg - fromDeg) * i) / steps, radius);
    return [center[0] + p[0], center[1] + p[1]] as Point2D;
  });
}

// The plate's boundary across the wedge between `edge` and `next` when a face already fills it,
// as points from `start` to `end` (both in `edge`'s own local frame, see computeWedgeBoundary).
function computeConnectionCurvePoints(
  start: Point2D,
  end: Point2D,
  edge: FlangeEdgeInput,
  params: FlangeShapeParams,
): Point2D[] {
  const rStart = length2(start);
  const rEnd = length2(end);

  const angleA = Math.atan2(start[1], start[0]);
  const angleB = Math.atan2(end[1], end[0]);

  let delta = angleB - angleA;

  while (delta < 0) delta += 2 * Math.PI;

  // here come some obscure curve calculations
  // the goal is to achieve a nice smooth transition between the edges connected via a face
  // and shortcut to an arc when the angle is small

  let midR = ((rStart + rEnd) / 2) * 0.75;

  const minStraight = Math.atan2(
    edge.thicknessMm / 2 + params.toleranceTransverse,
    (rStart + rEnd) / 2,
  );

  const hit0Angle = Math.PI * 0.75;
  const a0 = 1 / (minStraight * 3 - hit0Angle);
  const b0 = -hit0Angle * a0;
  const minRadius = ((rStart + rEnd) / 2) * Math.min(a0 * delta + b0, 1);

  midR = Math.max(midR, minRadius);

  const phaseOffset = minStraight / delta;

  const a = 1 / (1 - 2 * phaseOffset);
  const b = -phaseOffset * a;

  const points = Array.from({ length: SEGMENTS_COUNT + 1 }, (_, i) => {
    const phase = i / SEGMENTS_COUNT;
    const angle = angleA + delta * phase;

    let phaseCorrected = 0;
    if (phase < phaseOffset) {
      phaseCorrected = 0;
    } else if (phase > 1 - phaseOffset) {
      phaseCorrected = 1;
    } else {
      phaseCorrected = a * phase + b;
    }

    let radiusI = 0;
    if (phase < 0.5) {
      radiusI = rStart + (midR - rStart) * Math.sin(phaseCorrected * Math.PI);
    } else {
      radiusI = rEnd + (midR - rEnd) * Math.sin(phaseCorrected * Math.PI);
    }

    return [Math.cos(angle) * radiusI, Math.sin(angle) * radiusI] as Point2D;
  });

  // Land exactly on the two corners, so they line up with the neighbouring runs of the outline.
  points[0] = start;
  points[points.length - 1] = end;
  return points;
}

// The plate's boundary across an acute (< 180 deg) open wedge between `edge` and `next`: a
// quadratic bezier that starts on `edge`'s outer side line, ends on `next`'s, and is pulled towards
// a control point on the wedge's bisector, which rounds the corner between the two sides off.
//
// The control point sits where the two side lines meet on the bisector when both struts are equally
// thick: as far from the vertex as the sides are (on average), divided by the sine of half the
// wedge angle. Placing it on the bisector rather than intersecting the two side lines keeps it
// well behaved (no parallel lines, no runaway crossing) when the two struts differ in thickness.
function computeWedgeRoundingPoints(
  edge: FlangeEdgeInput,
  next: FlangeEdgeInput,
  params: FlangeShapeParams,
): Point2D[] {
  const h1 = edge.thicknessMm / 2 + params.toleranceTransverse + params.minSide;
  const h2 = next.thicknessMm / 2 + params.toleranceTransverse + params.minSide;
  const nextAngle = edge.projectedAngleDeg + edge.angleToNextEdgeDeg;

  const bisectorAngle = edge.projectedAngleDeg + edge.angleToNextEdgeDeg / 2;
  const control = polar(
    bisectorAngle,
    (h1 + h2) / 2 / Math.sin((edge.angleToNextEdgeDeg / 2) * DEG2RAD),
  );

  const start = rotate2D(
    [edge.strutEnd.cornerLength + params.overshoot - params.minSide, h1],
    edge.projectedAngleDeg,
  );
  const end = rotate2D(
    [next.strutEnd.cornerLength + params.overshoot - params.minSide, -h2],
    nextAngle,
  );

  return Array.from({ length: SEGMENTS_COUNT + 1 }, (_, i) => {
    const t = i / SEGMENTS_COUNT;
    const w0 = (1 - t) * (1 - t);
    const w1 = 2 * (1 - t) * t;
    const w2 = t * t;
    return [
      w0 * start[0] + w1 * control[0] + w2 * end[0],
      w0 * start[1] + w1 * control[1] + w2 * end[1],
    ] as Point2D;
  });
}

// Where a beam cast from the vertex at `beamAngleDeg` meets the straight plate side that passes
// through `sidePoint` heading along `sideDirection`. Null if they're parallel.
function beamHitPoint(
  beamAngleDeg: number,
  sidePoint: Point2D,
  sideDirection: Point2D,
): Point2D | null {
  return lineIntersection(
    [0, 0],
    polar(beamAngleDeg, 1),
    sidePoint,
    add2(sidePoint, sideDirection),
  );
}

// The plate's boundary across the wedge between `edge` and `next`, from `edge`'s +y corner (where
// its arm ends) around to `next`'s -y corner.
//
// With a face in the wedge that's just the connection curve. Without one, each of the two arms
// flares out sideways into a wide plate side with a rounded corner ("ear") at its end, and the
// space between the two sides is then bridged:
//   - acute wedge (< 180 deg): by a bezier that rounds off the corner between the two sides,
//   - reflex wedge (> 180 deg): by a straight line across the back of the vertex, between the
//     points where two beams cast from the vertex either side of the wedge's bisector hit the sides,
//   - exactly straight (180 deg): by nothing - the two sides simply meet.
function computeWedgePoints(
  edge: FlangeEdgeInput,
  next: FlangeEdgeInput,
  params: FlangeShapeParams,
): Point2D[] {
  const { start, end, nextLocalStart } = computeWedgeBoundary(edge, next, params);
  const edgeAngle = edge.projectedAngleDeg;
  const nextAngle = edge.projectedAngleDeg + edge.angleToNextEdgeDeg;

  if (edge.hasFaceToNextEdge) {
    return computeConnectionCurvePoints(start, end, edge, params).map((p) =>
      rotate2D(p, edgeAngle),
    );
  }

  // How far the plate sides reach past their arm's own (tolerance-widened) edge.
  const rad = Math.max(params.minSide - params.toleranceTransverse, 0);

  // Each ear is a quarter circle: `edge`'s runs from its tip corner `start` up to the top of its
  // side, `next`'s from the top of its side down to its own tip corner.
  const earOne = circleArcPoints([start[0] - rad, start[1]], rad, 0, 90, EAR_ARC_SEGMENTS).map(
    (p) => rotate2D(p, edgeAngle),
  );
  const earTwo = circleArcPoints(
    [nextLocalStart[0] - rad, nextLocalStart[1]],
    rad,
    -90,
    0,
    EAR_ARC_SEGMENTS,
  ).map((p) => rotate2D(p, nextAngle));

  // Where the two plate sides run into the vertex's own neighbourhood - the inner ends of their
  // outer edges.
  const sideOneInner = rotate2D([0, params.minSide + edge.thicknessMm / 2], edgeAngle);
  const sideTwoInner = rotate2D([0, -params.minSide - next.thicknessMm / 2], nextAngle);

  let bridge: Point2D[];
  if (edge.angleToNextEdgeDeg > 180) {
    const bisectorAngle = edgeAngle + edge.angleToNextEdgeDeg / 2;
    const sideOneHit = beamHitPoint(
      bisectorAngle - WEDGE_BEAM_SPREAD_DEG,
      earOne[earOne.length - 1],
      polar(edgeAngle, 1),
    );
    const sideTwoHit = beamHitPoint(
      bisectorAngle + WEDGE_BEAM_SPREAD_DEG,
      earTwo[0],
      polar(nextAngle, 1),
    );
    bridge = sideOneHit && sideTwoHit ? [sideOneHit, sideTwoHit] : [sideOneInner, sideTwoInner];
  } else if (edge.angleToNextEdgeDeg < 180) {
    bridge = computeWedgeRoundingPoints(edge, next, params);
  } else {
    bridge = computeWedgeRoundingPoints(edge, next, params);

    // bridge = [sideOneInner, sideTwoInner];
  }

  return [...earOne, ...bridge, ...earTwo];
}

// The end of `edge`'s arm, from its -y corner to its +y corner. Normally that's a straight cut
// across the arm. With an overshoot, the plate's corners reach past the arm's own (tolerance-
// shortened) end, so the arm's flat end steps back from them - along the plate side if there's no
// face in that wedge, or along the ray from the vertex to the corner if there is one.
function computeTipPoints(
  edge: FlangeEdgeInput,
  prevHasFace: boolean,
  nextHasFace: boolean,
  params: FlangeShapeParams,
): Point2D[] {
  const halfWidth = edge.thicknessMm / 2 + params.toleranceTransverse;
  const cornerX = edge.strutEnd.cornerLength + params.overshoot;
  const armEndX =
    edge.strutEnd.cornerLength - (params.overshoot > 0 ? params.toleranceLongitudinal : 0);
  const rayY = params.overshoot > 0 ? (halfWidth * armEndX) / cornerX : halfWidth;

  const local: Point2D[] = [
    [cornerX, -halfWidth],
    [armEndX, prevHasFace ? -rayY : -halfWidth],
    [armEndX, nextHasFace ? rayY : halfWidth],
    [cornerX, halfWidth],
  ];
  return local.map((p) => rotate2D(p, edge.projectedAngleDeg));
}

// The whole plate's outline: counter-clockwise points around it, no repeated points, not closed
// (the last point implicitly connects back to the first).
export function computeFlangeOutline(edges: FlangeEdgeInput[], params: FlangeShapeParams): Point2D[] {
  const outline: Point2D[] = [];
  const isSamePoint = (a: Point2D, b: Point2D) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= OUTLINE_POINT_TOLERANCE;
  const addPoint = (p: Point2D) => {
    if (outline.length === 0 || !isSamePoint(outline[outline.length - 1], p)) outline.push(p);
  };

  edges.forEach((edge, i) => {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const next = edges[(i + 1) % edges.length];

    computeTipPoints(edge, prev.hasFaceToNextEdge, edge.hasFaceToNextEdge, params).forEach(
      addPoint,
    );
    computeWedgePoints(edge, next, params).forEach(addPoint);
  });

  while (outline.length > 1 && isSamePoint(outline[0], outline[outline.length - 1])) {
    outline.pop();
  }
  return outline;
}

// A closed drawing tracing straight lines through `points`, in order.
function drawPolygon(points: Point2D[]): Drawing {
  let pen = draw().movePointerTo(points[0]);
  for (let i = 1; i < points.length; i++) {
    pen = pen.lineTo(points[i]);
  }
  return pen.close();
}

// The cutout across this strut's own tenon span, cleared out of the plate so the tenon has room
// to seat.
function computeRectCut(edge: FlangeEdgeInput, params: FlangeShapeParams): Drawing {
  return draw()
    .movePointerTo([
      edge.strutEnd.tenonStart - params.toleranceLongitudinal,
      edge.thicknessMm / 2 + params.toleranceTransverse,
    ])
    .hLineTo(edge.strutEnd.tenonEnd + params.toleranceLongitudinal)
    .vLineTo(-edge.thicknessMm / 2 - params.toleranceTransverse)
    .hLineTo(edge.strutEnd.tenonStart - params.toleranceLongitudinal)
    .close()
    .rotate(edge.projectedAngleDeg);
}

// Mill-relief cuts at this strut's own tenon cutout's four (otherwise square) inside corners.
function computeTenonCornerMillingCuts(
  edge: FlangeEdgeInput,
  params: FlangeShapeParams,
): Drawing[] {
  const corners: { point: Point2D; direction: MillingDirection }[] = [
    {
      point: [
        edge.strutEnd.tenonStart - params.toleranceLongitudinal,
        edge.thicknessMm / 2 + params.toleranceTransverse,
      ],
      direction: "bottom-right",
    },
    {
      point: [
        edge.strutEnd.tenonEnd + params.toleranceLongitudinal,
        edge.thicknessMm / 2 + params.toleranceTransverse,
      ],
      direction: "bottom-left",
    },
    {
      point: [
        edge.strutEnd.tenonStart - params.toleranceLongitudinal,
        -edge.thicknessMm / 2 - params.toleranceTransverse,
      ],
      direction: "top-right",
    },
    {
      point: [
        edge.strutEnd.tenonEnd + params.toleranceLongitudinal,
        -edge.thicknessMm / 2 - params.toleranceTransverse,
      ],
      direction: "top-left",
    },
  ];

  return corners.map((corner) =>
    drawMillingCircle(corner.point, corner.direction, params.millingDiameter).rotate(
      edge.projectedAngleDeg,
    ),
  );
}

export function computeFlangeBoundary2D(
  vertex: FlangeVertexInput,
  params: FlangeShapeParams,
): FlangeBoundaryResult {
  let helpers: HelperDrawing[] = [];
  const edgeMarks: FlangeEdgeMark[] = [];

  const negativeShapes: Drawing[] = [];
  const addNegative = (drawing: Drawing) => {
    negativeShapes.push(drawing);
  };

  if (vertex.edges.length === 0) return { main: null, edgeMarks: [], helpers };

  // Foot geometry isn't built yet - for now the params just get logged, to show they arrive here.
  if (vertex.foot) {
    console.log(`[flange] vertex ${vertex.vertexId} is a foot`, {
      length: vertex.foot.length,
      thickness: vertex.foot.thickness,
      grooveLength: vertex.foot.grooveLength,
    });
  }

  vertex.edges.forEach((edge, i) => {
    const next = vertex.edges[(i + 1) % vertex.edges.length];

    if (params.sideHoleDiameter > 0) {
      const { holeA, holeB } = computeSideHoles(edge, params);
      helpers.push({ drawing: holeA, color: HOLE_COLOR, name: `side hole (edge ${edge.edgeId}, +)` });
      addNegative(holeA);
      helpers.push({ drawing: holeB, color: HOLE_COLOR, name: `side hole (edge ${edge.edgeId}, -)` });
      addNegative(holeB);
    }

    const wedgeCornerMillingCuts = computeWedgeCornerMillingCuts(edge, next, params);
    if (wedgeCornerMillingCuts) {
      const { millingCutA, millingCutB } = wedgeCornerMillingCuts;
      helpers.push({ drawing: millingCutA, color: "red", name: `milling cut ${edge.edgeId}` });
      addNegative(millingCutA);
      helpers.push({ drawing: millingCutB, color: "red", name: `milling cut ${edge.edgeId}` });
      addNegative(millingCutB);
    }

    const rectCut = computeRectCut(edge, params);
    helpers.push({ drawing: rectCut, color: "cyan", name: `rect cut ${edge.edgeId}` });
    addNegative(rectCut);
    edgeMarks.push({
      edgeId: edge.edgeId,
      center: polar(
        edge.projectedAngleDeg,
        (edge.strutEnd.tenonStart + edge.strutEnd.tenonEnd) / 2,
      ),
      angleDeg: edge.projectedAngleDeg,
      holeWidth: edge.thicknessMm + 2 * params.toleranceTransverse,
    });

    computeTenonCornerMillingCuts(edge, params).forEach((cutDrawing) => {
      helpers.push({ drawing: cutDrawing, color: "red", name: `milling cut ${edge.edgeId}` });
      addNegative(cutDrawing);
    });
  });

  // Center bolt hole, shared by every strut arm at the vertex itself.
  if (params.centerHoleDiameter > 0) {
    const centerHoleDrawing = drawCircle(params.centerHoleDiameter / 2);
    helpers.push({ drawing: centerHoleDrawing, color: HOLE_COLOR, name: "center hole" });
    addNegative(centerHoleDrawing);
  }
  // Drawn last so it stays on top of everything else instead of getting z-fought away.
  helpers.push({ drawing: drawCircle(5), color: "#f5e050", name: `vertex ${vertex.vertexId}` });

  // The plate is drawn in one go from its outline, then everything negative is cut out of it.
  let main = drawPolygon(computeFlangeOutline(vertex.edges, params));
  negativeShapes.forEach((s) => {
    main = main.cut(s);
  });

  return { main, edgeMarks, helpers };
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
