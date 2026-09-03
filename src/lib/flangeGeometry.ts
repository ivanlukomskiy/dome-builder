import { draw, drawCircle, DrawingPen } from "replicad";
import { Drawing, type Point2D } from "replicad";
import type {
  HelperDrawing,
  StrutEndMeasurements,
} from "./strutGeometryManual";
import { add2, sub2, length2 } from "./vec2";

// A sandbox for hand-building the "flange" part - a flat connector plate at a hub vertex,
// covering the wedges between struts that have no face between them (see get_edges_info's
// hasFaceToNextEdge). Same idea as strutGeometryManual.ts's computeStrutBoundaryManual2D, just
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
  // strutGeometryManual.ts) - effectiveCornerLength is the one that matters here: how far out
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
  // strutGeometryManual.ts's precalculateStrutEnd - clears room for a round end mill at a square
  // notch.
  millingDiameter: number;
}

export const DEFAULT_FLANGE_SHAPE_PARAMS: FlangeShapeParams = {
  toleranceLongitudinal: 0,
  toleranceTransverse: 0,
  centerHoleDiameter: 8,
  sideHoleDiameter: 4,
  sideHoleDiameterOffset: 6,
  overshoot: 2,
  minSide: 6,
  millingDiameter: 8,
};

export interface FlangeBoundaryResult {
  main: Drawing | null;
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

function calculateArcPoints(
  start: Point2D,
  end: Point2D,
  center: Point2D,
  steps: number,
  direction: "cw" | "ccw",
): Point2D[] {
  const a = sub2(start, center);
  const b = sub2(end, center);

  const radius = length2(a);

  if (Math.abs(radius - length2(b)) > 1e-6) {
    throw new Error("Start and end must lie on the same circle");
  }

  const angleA = Math.atan2(a[1], a[0]);
  const angleB = Math.atan2(b[1], b[0]);

  let delta = angleB - angleA;

  if (direction === "ccw") {
    while (delta < 0) delta += 2 * Math.PI;
  } else {
    while (delta > 0) delta -= 2 * Math.PI;
  }

  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = angleA + (delta * i) / steps;

    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ];
  });
}

// Traces a closed polygon through `points`, then back to the origin - the shared shape of the
// wedge-boundary arcs (connection edge / connection sector) below.
function closedFanFromOrigin(points: Point2D[]): Drawing {
  let pen = draw();
  points.forEach((p, i) => {
    if (i === 0) {
      pen = pen.movePointerTo(p);
    } else {
      pen = pen.lineTo(p);
    }
  });
  pen = pen.lineTo([0, 0]);
  return pen.close();
}

function quadCircle(
  pen: DrawingPen,
  rad: number,
  dx: 1 | -1,
  dy: 1 | -1,
  sign: 1 | -1,
): DrawingPen {
  return pen.bulgeArc(rad * dx, rad * dy, sign * (Math.SQRT2 - 1));
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

function moveAwayFromOrigin(p: Point2D, n: number): Point2D {
  const len = Math.hypot(p[0], p[1]);
  if (len < 1e-9) return p;

  const scale = (len + n) / len;

  return [p[0] * scale, p[1] * scale];
}

function perpendicularFoot(center: Point2D, a: Point2D, b: Point2D): Point2D {
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

function addToMain(main: Drawing | null, drawing: Drawing): Drawing | null {
  if (main == null) return drawing;
  return main.fuse(drawing);
}

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
    -edge.thicknessMm / 2 - params.toleranceTransverse,
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
  if (!(params.toleranceLongitudinal > 0 || params.overshoot > 0)) return null;

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
      edge.strutEnd.cornerLength - params.toleranceLongitudinal,
      -edge.thicknessMm / 2 - params.toleranceTransverse,
    ],
    "top-right",
    params.millingDiameter,
  ).rotate(next.projectedAngleDeg);

  return { millingCutA, millingCutB };
}

// The wedge between `edge` and `next` when a face already fills it - a pie slice from the
// origin out to `start` and `end`, arcing between them.
function computeConnectionEdgeShape(
  start: Point2D,
  end: Point2D,
  edge: FlangeEdgeInput,
): Drawing {
  const points = calculateArcPoints(start, end, [0, 0], SEGMENTS_COUNT, "ccw");
  return closedFanFromOrigin(points).rotate(edge.projectedAngleDeg);
}

// The two straight plate edges running along each side of the open wedge between `edge` and
// `next` (used when no face already fills it), each with a quarter-circle relief bulging into
// the plate at its outer corner.
function computeEdgeSides(
  start: Point2D,
  nextLocalStart: Point2D,
  edge: FlangeEdgeInput,
  params: FlangeShapeParams,
): { sideOne: Drawing; sideTwo: Drawing } {
  const rad = params.minSide - params.toleranceTransverse;

  let sideOnePen = draw().movePointerTo(start);
  sideOnePen = quadCircle(sideOnePen, rad, -1, 1, 1);
  sideOnePen = sideOnePen.hLineTo(0).vLineTo(start[1]);
  const sideOne = sideOnePen.close().rotate(edge.projectedAngleDeg);

  let sideTwoPen = draw().movePointerTo(nextLocalStart);
  sideTwoPen = quadCircle(sideTwoPen, rad, -1, -1, -1);
  sideTwoPen = sideTwoPen.hLineTo(0).vLineTo(nextLocalStart[1]);
  const sideTwo = sideTwoPen
    .close()
    .rotate(edge.projectedAngleDeg + edge.angleToNextEdgeDeg);

  return { sideOne, sideTwo };
}

// Fills the acute (< 180 deg) open wedge between `edge` and `next`'s own plate sides with a
// rounded corner: finds where the two sides' outer edges would cross, then rounds that corner
// off at `params.minSide` radius. Returns null if the two sides turn out to be parallel (no
// crossing) - shouldn't happen for real dome geometry.
function computeWedgeRoundingShape(
  edge: FlangeEdgeInput,
  next: FlangeEdgeInput,
  params: FlangeShapeParams,
): Drawing | null {
  const h1 = edge.thicknessMm / 2 + params.toleranceTransverse + params.minSide;
  const h2 = next.thicknessMm / 2 + params.toleranceTransverse + params.minSide;
  const edge1p1 = rotate2D([100, h1], edge.projectedAngleDeg);
  const edge1p2 = rotate2D([0, h1], edge.projectedAngleDeg);
  const edge2p1 = rotate2D(
    [100, -h2],
    edge.projectedAngleDeg + edge.angleToNextEdgeDeg,
  );
  const edge2p2 = rotate2D(
    [0, -h2],
    edge.projectedAngleDeg + edge.angleToNextEdgeDeg,
  );
  const intersection = lineIntersection(edge1p1, edge1p2, edge2p1, edge2p2);
  if (intersection == null) return null;

  const roundingCenter = moveAwayFromOrigin(intersection, params.minSide);
  const projection1 = perpendicularFoot(roundingCenter, edge1p1, edge1p2);
  const projection2 = perpendicularFoot(roundingCenter, edge2p1, edge2p2);

  const roundingPoints = calculateArcPoints(
    projection1,
    projection2,
    roundingCenter,
    SEGMENTS_COUNT,
    "cw",
  );
  let rounding = draw();
  roundingPoints.forEach((p, i) => {
    if (i == 0) {
      rounding = rounding.movePointerTo(p);
    } else {
      rounding = rounding.lineTo(p);
    }
  });
  rounding.lineTo(intersection);
  return rounding.close();
}

// Fills the reflex (> 180 deg) open wedge between `edge` and `next`'s own plate sides with a
// pie slice arcing around the vertex itself.
function computeConnectionSectorShape(
  edge: FlangeEdgeInput,
  next: FlangeEdgeInput,
  params: FlangeShapeParams,
): Drawing {
  const connPoint1 = rotate2D(
    [0, params.minSide + edge.thicknessMm / 2],
    edge.projectedAngleDeg,
  );
  const connPoint2 = rotate2D(
    [0, -params.minSide - next.thicknessMm / 2],
    next.projectedAngleDeg,
  );

  const points = calculateArcPoints(
    connPoint1,
    connPoint2,
    [0, 0],
    SEGMENTS_COUNT,
    "ccw",
  );
  return closedFanFromOrigin(points);
}

// The main rectangular plate patch running along this strut's own centerline, from the vertex
// out to its (tolerance-adjusted) reach.
function computeRectPatch(edge: FlangeEdgeInput, params: FlangeShapeParams): Drawing {
  return draw()
    .movePointerTo([0, edge.thicknessMm / 2 + params.toleranceTransverse])
    .hLineTo(edge.strutEnd.cornerLength - params.toleranceLongitudinal)
    .vLineTo(-edge.thicknessMm / 2 - params.toleranceTransverse)
    .hLineTo(0)
    .close()
    .rotate(edge.projectedAngleDeg);
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
  const helpers: HelperDrawing[] = [];

  // Shapes fused into `main`, kept in separate buckets so the final assembly below can fuse them
  // in a fixed order - fusing in a different order sometimes trips up opencascade's boolean ops,
  // so this order must stay intact even though nothing about the resulting shape logically
  // depends on it.
  const connectionEdges: Drawing[] = [];
  const edgeSides: Drawing[] = [];
  const roundingShapes: Drawing[] = [];
  const connectionSectorShapes: Drawing[] = [];
  const rectEdgeShapes: Drawing[] = [];

  const negativeShapes: Drawing[] = [];
  const addNegative = (drawing: Drawing, name: string) => {
    negativeShapes.push(drawing);
  };

  if (vertex.edges.length === 0) return { main: null, helpers };

  vertex.edges.forEach((edge, i) => {
    const next = vertex.edges[(i + 1) % vertex.edges.length];

    const { holeA, holeB } = computeSideHoles(edge, params);
    helpers.push({ drawing: holeA, color: HOLE_COLOR, name: `side hole (edge ${edge.edgeId}, +)` });
    addNegative(holeA, `side hole (edge ${edge.edgeId}, +)`);
    helpers.push({ drawing: holeB, color: HOLE_COLOR, name: `side hole (edge ${edge.edgeId}, -)` });
    addNegative(holeB, `side hole (edge ${edge.edgeId}, -)`);

    const { start, end, nextLocalStart } = computeWedgeBoundary(edge, next, params);

    const wedgeCornerMillingCuts = computeWedgeCornerMillingCuts(edge, next, params);
    if (wedgeCornerMillingCuts) {
      const { millingCutA, millingCutB } = wedgeCornerMillingCuts;
      helpers.push({ drawing: millingCutA, color: "red", name: `milling cut ${edge.edgeId}` });
      addNegative(millingCutA, `milling cut A (edge ${edge.edgeId})`);
      helpers.push({ drawing: millingCutB, color: "red", name: `milling cut ${edge.edgeId}` });
      addNegative(millingCutB, `milling cut B (edge ${edge.edgeId})`);
    }

    if (edge.hasFaceToNextEdge) {
      const connectionEdge = computeConnectionEdgeShape(start, end, edge);
      helpers.push({
        drawing: connectionEdge,
        color: "purple",
        name: `connection edge ${edge.edgeId} to ${next.edgeId}, angle ${edge.angleToNextEdgeDeg}`,
      });
      connectionEdges.push(connectionEdge);
    } else {
      const { sideOne, sideTwo } = computeEdgeSides(start, nextLocalStart, edge, params);
      helpers.push({ drawing: sideOne, color: "green", name: `side one ${edge.edgeId}` });
      edgeSides.push(sideOne);
      helpers.push({ drawing: sideTwo, color: "green", name: `side two ${edge.edgeId}` });
      edgeSides.push(sideTwo);

      if (edge.angleToNextEdgeDeg < 180) {
        const rounding = computeWedgeRoundingShape(edge, next, params);
        if (rounding) {
          helpers.push({ drawing: rounding, color: "blue", name: `rounding ${edge.edgeId}-${next.edgeId}` });
          roundingShapes.push(rounding);
        }
      } else if (edge.angleToNextEdgeDeg > 180) {
        const connectionSector = computeConnectionSectorShape(edge, next, params);
        helpers.push({
          drawing: connectionSector,
          color: "purple",
          name: `connection sector ${edge.edgeId} to ${next.edgeId}`,
        });
        connectionSectorShapes.push(connectionSector);
      }
    }

    const rectPatch = computeRectPatch(edge, params);
    helpers.push({ drawing: rectPatch, color: "orange", name: `rect edge ${edge.edgeId}` });
    rectEdgeShapes.push(rectPatch);

    const rectCut = computeRectCut(edge, params);
    helpers.push({ drawing: rectCut, color: "cyan", name: `rect cut ${edge.edgeId}` });
    addNegative(rectCut, `rect cut ${edge.edgeId}`);

    computeTenonCornerMillingCuts(edge, params).forEach((cutDrawing) => {
      helpers.push({ drawing: cutDrawing, color: "red", name: `milling cut ${edge.edgeId}` });
      addNegative(cutDrawing, `milling cut corner (edge ${edge.edgeId})`);
    });
  });

  // Center bolt hole, shared by every strut arm at the vertex itself.
  const centerHoleDrawing = drawCircle(params.centerHoleDiameter / 2);
  helpers.push({ drawing: centerHoleDrawing, color: HOLE_COLOR, name: "center hole" });
  addNegative(centerHoleDrawing, "center hole");
  // Drawn last so it stays on top of everything else instead of getting z-fought away.
  helpers.push({ drawing: drawCircle(5), color: "#f5e050", name: `vertex ${vertex.vertexId}` });

  // Fused in this fixed order - see the comment on the buckets above.
  let main: Drawing | null = null;
  rectEdgeShapes.forEach((drawing) => (main = addToMain(main, drawing)));
  connectionEdges.forEach((drawing) => (main = addToMain(main, drawing)));
  edgeSides.forEach((drawing) => (main = addToMain(main, drawing)));
  roundingShapes.forEach((drawing) => (main = addToMain(main, drawing)));
  connectionSectorShapes.forEach((drawing) => (main = addToMain(main, drawing)));

  negativeShapes.forEach((s) => {
    if (!main) return;
    main = main.cut(s);
  });

  return { main, helpers };
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
