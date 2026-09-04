/// <reference types="node" />
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { setOC } from "replicad";
import initOpenCascade from "replicad-opencascadejs";
import { computeFlangeBoundary2D, DEFAULT_FLANGE_SHAPE_PARAMS } from "./flangeGeometry";
import type { VertexEdgesInfo } from "./edgesInfo";

// computeFlangeBoundary2D builds its 2D outline via replicad's own draw()/.fuse()/.cut()
// primitives, which need opencascade's WASM module loaded first (see replicadCad.ts's
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
