/// <reference types="node" />
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { measureArea, setOC, type Drawing, type Face } from "replicad";
import initOpenCascade from "replicad-opencascadejs";
import {
  computeFlangeBoundary2D,
  computeFlangeOutline,
  DEFAULT_FLANGE_SHAPE_PARAMS,
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
  });
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
