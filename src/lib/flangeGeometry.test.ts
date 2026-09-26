/// <reference types="node" />
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { measureArea, setOC, type Drawing, type Face } from "replicad";
import initOpenCascade from "replicad-opencascadejs";
import {
  computeFlangeBoundary2D,
  computeFlangeOutline,
  DEFAULT_FLANGE_SHAPE_PARAMS,
  DEFAULT_FOOT_PARAMS,
  type FlangeFoot,
  type FlangeShapeParams,
  type FlangeVertexInput,
} from "./flangeGeometry";
import type { VertexEdgesInfo } from "./edgesInfo";

// computeFlangeBoundary2D draws the plate's outline via replicad's own draw() and then .cut()s the
// holes and slots out of it - primitives that need opencascade's WASM module loaded first (see replicadCad.ts's
// ensureReplicadReady). That helper assumes a Vite/browser context (a `?url` import feeding
// `locateFile`) - here we load the .wasm file straight off disk instead and hand it to
// initOpenCascade as `wasmBinary`, skipping the fetch/locateFile path entirely so this also
// works under plain Node.
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("replicad-opencascadejs/wasm");
  const wasmBinary = readFileSync(wasmPath);
  const oc = await initOpenCascade({ wasmBinary });
  setOC(oc);
}, 30_000);

// Two real hub vertices, pulled from a "Get Edges Info" export, that used to crash
// computeFlangeBoundary2D's opencascade calls with a "Failed to split the curve" /
// "memory access out of bounds" error - kept verbatim as regression fixtures so a future change
// can't silently reintroduce either failure.

// A reflex (>180 deg) open wedge between edges 44 and -5 - computeConnectionSectorShape's via
// points didn't land on where the adjacent side plates actually end, leaving the fan not
// touching what it was meant to bridge.
const VERTEX_21: VertexEdgesInfo = {
  vertexId: 21,
  position: [2103.888212112315, -53.20132931814612, -1051.9441060561583],
  tangentPlane: {
    origin: [2103.888212112315, -53.20132931814612, -1051.9441060561583],
    normal: [0.8415552848449261, 0.33871946827274174, -0.42077764242246335],
    e1: [-0.30295990254417354, 0.9408874118687269, 0.15147995127208688],
    e2: [0.4472135954999583, 0, 0.894427190999916],
  },
  edges: [
    {
      edgeId: 44,
      neighborId: 11,
      neighborPosition: [1855.9336735458407, 774.9657308132123, 0],
      thicknessMm: 75,
      offsetMm: 62.49210233276298,
      strutEnd: {
        offset: 62.49210233276298,
        cornerLength: 375,
        tenonStart: 140.61907674957223,
        tenonEnd: 265.6222358164671,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 39.310516226973846,
      angleToNextEdgeDeg: 185.23029932784715,
      hasFaceToNextEdge: false,
      faceIdToNextEdge: null,
    },
    {
      edgeId: -5,
      neighborId: -3,
      neighborPosition: [1767.7669529663688, -900.0000000000005, -1767.7669529663694],
      thicknessMm: 75,
      offsetMm: 77.0553351884945,
      strutEnd: {
        offset: 77.0553351884945,
        cornerLength: 375,
        tenonStart: 151.54150139137087,
        tenonEnd: 270.71936731597305,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 224.540815554821,
      angleToNextEdgeDeg: 51.90096918236735,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: -3,
    },
    {
      edgeId: 46,
      neighborId: 20,
      neighborPosition: [1051.9441060561574, -53.20132931814612, -2103.8882121123156],
      thicknessMm: 75,
      offsetMm: 77.0553351884945,
      strutEnd: {
        offset: 77.0553351884945,
        cornerLength: 375,
        tenonStart: 151.54150139137087,
        tenonEnd: 270.71936731597305,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 276.44178473718836,
      angleToNextEdgeDeg: 60.93482955437456,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: 25,
    },
    {
      edgeId: 45,
      neighborId: 19,
      neighborPosition: [1161.1118996517139, 985.1096289007635, -1161.1118996517137],
      thicknessMm: 75,
      offsetMm: 63.74523960811312,
      strutEnd: {
        offset: 63.74523960811312,
        cornerLength: 375,
        tenonStart: 141.55892970608483,
        tenonEnd: 266.06083386283956,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 337.3766142915629,
      angleToNextEdgeDeg: 61.93390193541095,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: 24,
    },
  ],
};

// The dome's apex: four struts, evenly spaced 90 degrees apart, with a face in every gap (no
// reflex-wedge branch involved at all) - crashes independently of the vertex 21 bug above, so it
// covers a different failure in the same fuse/cut chain.
const VERTEX_0: VertexEdgesInfo = {
  vertexId: 0,
  position: [4.081702296416017e-13, 1599.9999999999995, 0],
  tangentPlane: {
    origin: [4.081702296416017e-13, 1599.9999999999995, 0],
    normal: [1.632680918566407e-16, 1, 0],
    e1: [1, -1.632680918566407e-16, 0],
    e2: [0, 0, -1],
  },
  edges: [
    {
      edgeId: 19,
      neighborId: 10,
      neighborPosition: [839.5154389887676, 1454.8277702837408, 0],
      thicknessMm: 75,
      offsetMm: 37.5,
      strutEnd: {
        offset: 37.5,
        cornerLength: 375,
        tenonStart: 121.875,
        tenonEnd: 256.875,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 0,
      angleToNextEdgeDeg: 90,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: 18,
    },
    {
      edgeId: 34,
      neighborId: 16,
      neighborPosition: [4.2422524271706925e-13, 1454.8277702837408, -839.5154389887676],
      thicknessMm: 75,
      offsetMm: 37.5,
      strutEnd: {
        offset: 37.5,
        cornerLength: 375,
        tenonStart: 121.875,
        tenonEnd: 256.875,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 90,
      angleToNextEdgeDeg: 90,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: 27,
    },
    {
      edgeId: 0,
      neighborId: 4,
      neighborPosition: [-839.515438988767, 1454.8277702837413, 1.0281098951923785e-13],
      thicknessMm: 75,
      offsetMm: 37.5,
      strutEnd: {
        offset: 37.5,
        cornerLength: 375,
        tenonStart: 121.875,
        tenonEnd: 256.875,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 180,
      angleToNextEdgeDeg: 90,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: 0,
    },
    {
      edgeId: 2,
      neighborId: 1,
      neighborPosition: [4.2422524271706925e-13, 1454.8277702837408, 839.5154389887676],
      thicknessMm: 75,
      offsetMm: 37.5,
      strutEnd: {
        offset: 37.5,
        cornerLength: 375,
        tenonStart: 121.875,
        tenonEnd: 256.875,
        chamferLength: 6,
        millingDiameter: 8,
        effectiveCornerLength: 393.75,
        halfWidth: 62.5,
        grooveDepth: 20,
        connectionHalfWidth: 62.5,
      },
      projectedAngleDeg: 270,
      angleToNextEdgeDeg: 90,
      hasFaceToNextEdge: true,
      faceIdToNextEdge: 9,
    },
  ],
};

describe("computeFlangeBoundary2D", () => {
  it.each<[string, VertexEdgesInfo]>([
    ["vertex 21 (reflex wedge, no face)", VERTEX_21],
    ["vertex 0 (apex, four faced wedges)", VERTEX_0],
  ])("does not throw for %s", (_name, vertex) => {
    const result = computeFlangeBoundary2D(
      { vertexId: vertex.vertexId, edges: vertex.edges },
      DEFAULT_FLANGE_SHAPE_PARAMS,
    );
    expect(result.main).not.toBeNull();
  });

  // Vertex 0 alone (previous test above) doesn't crash, but the app hit "memory access out of
  // bounds" while building a *batch* of 12 vertices (including 0) in one worker/opencascade
  // instance - repeating the same, individually-fine vertex many times in a row, in this one
  // shared OC instance, checks whether that's really a per-vertex bug or just accumulated
  // opencascade memory pressure from building many flanges without ever resetting the instance.
  it("does not run out of memory building the same vertex repeatedly in one instance", () => {
    for (let i = 0; i < 30; i++) {
      const result = computeFlangeBoundary2D(
        { vertexId: VERTEX_0.vertexId, edges: VERTEX_0.edges },
        DEFAULT_FLANGE_SHAPE_PARAMS,
      );
      expect(result.main, `iteration ${i}`).not.toBeNull();
    }
  }, 30_000);
});

// --- The outline itself ---------------------------------------------------------------------

// The plate is built from one closed outline (see computeFlangeOutline), not from fused pieces, so
// the outline has to be a valid simple polygon on its own: counter-clockwise and never crossing
// itself. These checks are pure geometry - no opencascade involved.

type Pt = [number, number];

function signedArea(points: Pt[]): number {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// Whether any two segments that aren't neighbours properly cross each other (touching at an end
// point doesn't count).
function crossesItself(points: Pt[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (
        cross(a1, a2, b1) * cross(a1, a2, b2) < 0 &&
        cross(b1, b2, a1) * cross(b1, b2, a2) < 0
      ) {
        return true;
      }
    }
  }
  return false;
}

// Two of VERTEX_21's real struts (-5 and 46, 51.9 deg apart) with no face between them: an open
// *acute* wedge, which exercises the rounded-corner bezier. (Vertex 21 itself has the open reflex
// wedge, and vertex 0 only faced ones.) The wedge back around the other way is open and reflex.
const ACUTE_OPEN_WEDGE: FlangeVertexInput = {
  vertexId: 1001,
  edges: [
    { ...VERTEX_21.edges[1], hasFaceToNextEdge: false, faceIdToNextEdge: null },
    {
      ...VERTEX_21.edges[2],
      angleToNextEdgeDeg: 360 - VERTEX_21.edges[1].angleToNextEdgeDeg,
      hasFaceToNextEdge: false,
      faceIdToNextEdge: null,
    },
  ],
};

// A lone strut: the plate wraps all the way around the vertex (a 360 deg open wedge).
const SINGLE_STRUT: FlangeVertexInput = {
  vertexId: 1002,
  edges: [
    {
      ...VERTEX_21.edges[0],
      angleToNextEdgeDeg: 360,
      hasFaceToNextEdge: false,
      faceIdToNextEdge: null,
    },
  ],
};

const OUTLINE_CASES: [string, FlangeVertexInput][] = [
  ["vertex 21 (open reflex wedge + faced wedges)", { vertexId: VERTEX_21.vertexId, edges: VERTEX_21.edges }],
  ["vertex 0 (four faced wedges)", { vertexId: VERTEX_0.vertexId, edges: VERTEX_0.edges }],
  ["an open acute wedge", ACUTE_OPEN_WEDGE],
  ["a single strut", SINGLE_STRUT],
];

const PARAM_CASES: [string, FlangeShapeParams][] = [
  ["default params", DEFAULT_FLANGE_SHAPE_PARAMS],
  ["overshoot", { ...DEFAULT_FLANGE_SHAPE_PARAMS, overshoot: 6 }],
  ["no transverse tolerance", { ...DEFAULT_FLANGE_SHAPE_PARAMS, toleranceTransverse: 0 }],
];

function areaOf(drawing: Drawing): number {
  const sketched = drawing.sketchOnPlane();
  const shape = "face" in sketched ? sketched.face() : sketched.faces();
  const area = measureArea(shape as Face);
  shape.delete();
  return area;
}

describe("computeFlangeOutline", () => {
  describe.each(OUTLINE_CASES)("for %s", (_vertexName, vertex) => {
    it.each(PARAM_CASES)("is a simple counter-clockwise polygon with %s", (_paramsName, params) => {
      const outline = computeFlangeOutline(vertex.edges, params);
      expect(outline.length).toBeGreaterThan(3);
      expect(signedArea(outline)).toBeGreaterThan(0);
      expect(crossesItself(outline)).toBe(false);
    });
  });
});

describe("computeFlangeOutline reflex open wedge", () => {
  // Two struts 90 deg apart with a face between them, and nothing across the 270 deg the other way
  // round. The plate's two outer sides (57.5 mm = half a strut + minSide from each strut's axis)
  // run along x = -57.5 and y = -57.5; the wedge's bisector points at 225 deg, so beams at 205 and
  // 245 deg hit them at (-57.5, -57.5 * tan 25) and (-57.5 * tan 25, -57.5), and the plate is
  // closed off with a straight line between those two.
  const reflexVertex: FlangeVertexInput = {
    vertexId: 1003,
    edges: [
      { ...VERTEX_0.edges[0], angleToNextEdgeDeg: 90 },
      { ...VERTEX_0.edges[1], angleToNextEdgeDeg: 270, hasFaceToNextEdge: false, faceIdToNextEdge: null },
    ],
  };
  const sideOffset = VERTEX_0.edges[0].thicknessMm / 2 + DEFAULT_FLANGE_SHAPE_PARAMS.minSide;
  const hit = sideOffset * Math.tan((25 * Math.PI) / 180);
  const outline = computeFlangeOutline(reflexVertex.edges, DEFAULT_FLANGE_SHAPE_PARAMS);
  const hasPoint = (x: number, y: number) =>
    outline.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-6);

  it("closes the wedge with a straight line between the two beam hits", () => {
    expect(hasPoint(-sideOffset, -hit)).toBe(true);
    expect(hasPoint(-hit, -sideOffset)).toBe(true);
    const i = outline.findIndex((p) => Math.hypot(p[0] + sideOffset, p[1] + hit) < 1e-6);
    const next = outline[(i + 1) % outline.length];
    expect(Math.hypot(next[0] + hit, next[1] + sideOffset)).toBeLessThan(1e-6);
  });

  it("stays within the two plate sides", () => {
    expect(Math.min(...outline.map((p) => p[0]))).toBeCloseTo(-sideOffset, 6);
    expect(Math.min(...outline.map((p) => p[1]))).toBeCloseTo(-sideOffset, 6);
  });
});

describe("computeFlangeBoundary2D plate shape", () => {
  // Plate areas (mm^2) of the previous implementation, which fused a stack of overlapping pieces
  // together - the outline rewrite must still draw the same plate. The 0.05% slack covers the
  // rounded corners now being drawn as many short segments instead of true arcs.
  it.each<[string, VertexEdgesInfo, number]>([
    ["vertex 21", VERTEX_21, 185286.14],
    ["vertex 0", VERTEX_0, 307964.33],
  ])("keeps the plate area for %s", (_name, vertex, expectedArea) => {
    const { main } = computeFlangeBoundary2D(
      { vertexId: vertex.vertexId, edges: vertex.edges },
      DEFAULT_FLANGE_SHAPE_PARAMS,
    );
    expect(Math.abs(areaOf(main!) - expectedArea) / expectedArea).toBeLessThan(5e-4);
  });

  // The fused version fell over on this one ("Bug in the intersection algo on non crossing
  // point") whenever an overshoot was set.
  it("builds vertex 21 with an overshoot", () => {
    const withOvershoot = { ...DEFAULT_FLANGE_SHAPE_PARAMS, overshoot: 6 };
    const { main } = computeFlangeBoundary2D(
      { vertexId: VERTEX_21.vertexId, edges: VERTEX_21.edges },
      withOvershoot,
    );
    const plain = computeFlangeBoundary2D(
      { vertexId: VERTEX_21.vertexId, edges: VERTEX_21.edges },
      DEFAULT_FLANGE_SHAPE_PARAMS,
    );
    // The overshoot only ever pushes the plate's corners further out.
    expect(areaOf(main!)).toBeGreaterThan(areaOf(plain.main!));
  });

  it.each<[string, FlangeVertexInput]>([
    ["an open acute wedge", ACUTE_OPEN_WEDGE],
    ["a single strut", SINGLE_STRUT],
  ])("builds %s", (_name, vertex) => {
    const { main } = computeFlangeBoundary2D(vertex, DEFAULT_FLANGE_SHAPE_PARAMS);
    expect(main).not.toBeNull();
    expect(areaOf(main!)).toBeGreaterThan(0);
  });
});

// --- The foot ---------------------------------------------------------------------------------

// A foot is one more plate arm, in the wedge its direction falls in: a flat tip `length` wide at
// holeOffset + thickness + tipOffset, straight sides, and a rectangular hole across its axis.
describe("foot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const params = DEFAULT_FLANGE_SHAPE_PARAMS;
  const footAt = (projectedAngleDeg: number): FlangeFoot => ({
    ...DEFAULT_FOOT_PARAMS,
    projectedAngleDeg,
  });
  const tipX = DEFAULT_FOOT_PARAMS.holeOffset + DEFAULT_FOOT_PARAMS.thickness + DEFAULT_FOOT_PARAMS.tipOffset;
  const rotate = (p: Pt, deg: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  };
  const hasPoint = (outline: Pt[], p: Pt) => outline.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6);
  const samePoint = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
  const hasSegment = (outline: Pt[], a: Pt, b: Pt) =>
    outline.some((p, i) => {
      const q = outline[(i + 1) % outline.length];
      return (samePoint(p, a) && samePoint(q, b)) || (samePoint(p, b) && samePoint(q, a));
    });

  // The reflex open wedge of ACUTE_OPEN_WEDGE (its struts sit at 224.5 and 276.4 degrees) is
  // centered on 70.5 degrees; its acute open wedge on 250.5.
  const CASES: [string, FlangeVertexInput, number][] = [
    ["the open reflex wedge", ACUTE_OPEN_WEDGE, 70.49],
    ["the open acute wedge", ACUTE_OPEN_WEDGE, 250.49],
    ["a lone strut's wedge", SINGLE_STRUT, VERTEX_21.edges[0].projectedAngleDeg + 180],
  ];

  describe.each(CASES)("in %s", (_name, vertex, angle) => {
    const foot = footAt(angle);
    const outline = computeFlangeOutline(vertex.edges, params, foot);

    it("is still a simple counter-clockwise polygon", () => {
      expect(signedArea(outline)).toBeGreaterThan(0);
      expect(crossesItself(outline)).toBe(false);
    });

    it("ends in a flat tip, foot.length wide, tipX from the vertex", () => {
      expect(hasPoint(outline, rotate([tipX, -foot.length / 2], angle))).toBe(true);
      expect(hasPoint(outline, rotate([tipX, foot.length / 2], angle))).toBe(true);
    });

    it("has flat sides parallel to the axis, ending on the line of the hole's near side", () => {
      const holeX0 = foot.holeOffset - params.toleranceTransverse;
      for (const sign of [-1, 1]) {
        // The side runs from the tip corner to where it meets the hole's near-side line...
        const tipCorner = rotate([tipX, sign * foot.length / 2], angle);
        const sideEnd = rotate([holeX0, sign * foot.length / 2], angle);
        expect(hasPoint(outline, tipCorner)).toBe(true);
        expect(hasPoint(outline, sideEnd)).toBe(true);
        expect(hasSegment(outline, tipCorner, sideEnd)).toBe(true);
      }
      // ...and nothing of the outline strays into the band the two sides enclose, past that line
      // (in the foot's own frame).
      const strays = outline
        .map((p) => rotate(p, -angle))
        .filter((p) => p[0] > holeX0 + 1e-6 && p[0] < tipX - 1e-6 && Math.abs(p[1]) < foot.length / 2 - 1e-6);
      expect(strays).toHaveLength(0);
    });

    it("builds a plate with a rectangular hole of the right size", () => {
      const result = computeFlangeBoundary2D({ vertexId: 2001, edges: vertex.edges, foot }, params);
      expect(result.main).not.toBeNull();
      const rect = result.helpers.find((h) => h.name === "foot rect cut")!;
      // thickness (+ transverse tolerance both sides) along the axis, groove length (+ longitudinal
      // tolerance both sides) across it.
      const expected =
        (foot.thickness + 2 * params.toleranceTransverse) * (foot.grooveLength + 2 * params.toleranceLongitudinal);
      expect(areaOf(rect.drawing)).toBeCloseTo(expected, 3);
      expect(result.helpers.filter((h) => h.name.startsWith("foot side hole"))).toHaveLength(2);
    });
  });

  it("keeps both foot sides straight in a face-filled wedge", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const angle = VERTEX_0.edges[0].projectedAngleDeg + 30;
    const foot = footAt(angle);
    const outline = computeFlangeOutline(VERTEX_0.edges, params, foot);
    const holeX0 = foot.holeOffset - params.toleranceTransverse;

    expect(error).toHaveBeenCalled();
    expect(signedArea(outline)).toBeGreaterThan(0);
    expect(crossesItself(outline)).toBe(false);
    for (const sign of [-1, 1]) {
      expect(hasSegment(
        outline,
        rotate([tipX, sign * foot.length / 2], angle),
        rotate([holeX0, sign * foot.length / 2], angle),
      )).toBe(true);
    }
  });

  it("leaves a vertex without a foot exactly as it was", () => {
    const edges = ACUTE_OPEN_WEDGE.edges;
    expect(computeFlangeOutline(edges, params, undefined)).toEqual(computeFlangeOutline(edges, params));
  });

  it("puts the side bolt holes on the foot's axis, either side of the rectangular hole", () => {
    const angle = 70.49;
    const { helpers } = computeFlangeBoundary2D(
      { vertexId: 2003, edges: ACUTE_OPEN_WEDGE.edges, foot: footAt(angle) },
      params,
    );
    expect(helpers.some((h) => h.name === "foot side hole (+)")).toBe(true);
    expect(helpers.some((h) => h.name === "foot side hole (-)")).toBe(true);
  });

  describe("best effort", () => {
    it("reports a foot in a wedge that already has a face, and still builds it", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      // VERTEX_0's four wedges all have a face.
      const { main } = computeFlangeBoundary2D(
        { vertexId: VERTEX_0.vertexId, edges: VERTEX_0.edges, foot: footAt(VERTEX_0.edges[0].projectedAngleDeg + 30) },
        params,
      );
      expect(error).toHaveBeenCalled();
      expect(main).not.toBeNull();
    });

    it("reports a foot pointing along a strut, and still shows it", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const strutAngle = ACUTE_OPEN_WEDGE.edges[0].projectedAngleDeg;
      const plain = computeFlangeBoundary2D({ vertexId: 2004, edges: ACUTE_OPEN_WEDGE.edges }, params);
      const { main, helpers } = computeFlangeBoundary2D(
        { vertexId: 2004, edges: ACUTE_OPEN_WEDGE.edges, foot: footAt(strutAngle + 0.1) },
        params,
      );
      expect(error).toHaveBeenCalled();
      expect(main).not.toBeNull();
      expect(helpers.some((h) => h.name === "foot rect cut")).toBe(true);
      // The strut is 375 mm long and the foot ends far inside it, so the plate is (nearly) unchanged
      // - it must simply not blow up.
      expect(areaOf(main!)).toBeGreaterThan(areaOf(plain.main!) * 0.99);
    });
  });
});
