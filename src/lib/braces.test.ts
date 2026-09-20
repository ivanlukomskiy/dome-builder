import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  addBrace,
  computeBraceEndpoints,
  computeStrutBraces,
  DEFAULT_BRACE_SHIFT,
  deleteBraces,
  indexBracesByEdge,
  resolveBracePair,
  applyBracePlateParams,
  bracePlateParamsDiffer,
  bracePlatePlane,
  DEFAULT_BRACE_PLATE_PARAMS,
  firstBracePlateParams,
  setBraceParam,
  type StrutBraceEnd,
  DEFAULT_BRACE_PARAMS,
} from "./braces";
import { cartesianToPolar, deleteEdges, deleteVertices, type SceneData } from "./polyhedra";

// Vertex 0 at the origin with edges to 1 (+x, length 10), 2 (+y, length 20) and 3 (+z, length 10),
// plus edge 3 joining vertices 1 and 2.
const POSITIONS = new Map<number, THREE.Vector3>([
  [0, new THREE.Vector3(0, 0, 0)],
  [1, new THREE.Vector3(10, 0, 0)],
  [2, new THREE.Vector3(0, 20, 0)],
  [3, new THREE.Vector3(0, 0, 10)],
]);

// The scene stores its vertices in polar coordinates, so the exact xyz positions above are kept
// aside for the tests that assert on exact points.
function makeScene(): SceneData {
  return {
    vertices: new Map(Array.from(POSITIONS, ([id, p]) => [id, cartesianToPolar(p)])),
    edges: new Map<number, [number, number]>([
      [0, [0, 1]],
      [1, [0, 2]],
      [2, [0, 3]],
      [3, [1, 2]],
    ]),
    faces: new Map(),
    nextVertexId: 4,
    nextEdgeId: 4,
    nextFaceId: 0,
    braces: new Map(),
    nextBraceId: 0,
  };
}

describe("addBrace", () => {
  it("creates a brace at the shared vertex with the default shift", () => {
    const scene = addBrace(makeScene(), new Set([0, 1]));
    expect(scene.braces.size).toBe(1);
    expect(scene.braces.get(0)).toEqual({
      vertexId: 0,
      edgeIds: [0, 1],
      params: DEFAULT_BRACE_PARAMS,
    });
    expect(scene.braces.get(0)!.params.shift).toBe(DEFAULT_BRACE_SHIFT);
    expect(scene.nextBraceId).toBe(1);
  });

  it("needs exactly two edges that share a vertex, and no existing brace between them", () => {
    const scene = makeScene();
    expect(resolveBracePair(scene, new Set([0]))).toBeNull();
    expect(resolveBracePair(scene, new Set([0, 1, 2]))).toBeNull();
    // edges 2 (0-3) and 3 (1-2) don't touch
    expect(resolveBracePair(scene, new Set([2, 3]))).toBeNull();
    expect(resolveBracePair(scene, new Set([0, 1]))).toEqual([0, 1]);

    const withBrace = addBrace(scene, new Set([0, 1]));
    expect(resolveBracePair(withBrace, new Set([1, 0]))).toBeNull();
    expect(addBrace(withBrace, new Set([0, 1]))).toBe(withBrace);
  });
});

describe("brace editing and cascades", () => {
  const withBraces = () => addBrace(addBrace(makeScene(), new Set([0, 1])), new Set([1, 2]));

  it("clamps shift strictly inside (0, 1)", () => {
    const scene = setBraceParam(withBraces(), new Set([0]), "shift", 5);
    expect(scene.braces.get(0)!.params.shift).toBeLessThan(1);
    expect(setBraceParam(scene, new Set([0]), "shift", -1).braces.get(0)!.params.shift).toBeGreaterThan(0);
    // other properties only need to be non-negative
    expect(setBraceParam(scene, new Set([0]), "width", -3).braces.get(0)!.params.width).toBe(0);
    expect(setBraceParam(scene, new Set([0]), "width", 80).braces.get(0)!.params.width).toBe(80);
  });

  it("deleteBraces removes only the given braces", () => {
    const scene = deleteBraces(withBraces(), new Set([0]));
    expect(Array.from(scene.braces.keys())).toEqual([1]);
  });

  it("deleting an edge removes the braces lying on it", () => {
    const scene = deleteEdges(withBraces(), new Set([0]));
    expect(Array.from(scene.braces.keys())).toEqual([1]);
    expect(deleteEdges(withBraces(), new Set([1])).braces.size).toBe(0);
  });

  it("deleting a vertex removes the braces on its edges", () => {
    expect(deleteVertices(withBraces(), new Set([0])).braces.size).toBe(0);
    // vertex 3 only carries edge 2, which is in brace 1
    expect(Array.from(deleteVertices(withBraces(), new Set([3])).braces.keys())).toEqual([0]);
  });

  it("keeps the same braces map when nothing needs pruning", () => {
    const scene = withBraces();
    expect(deleteEdges(scene, new Set([3])).braces).toBe(scene.braces);
  });
});

describe("computeBraceEndpoints", () => {
  it("puts each point shift * edge length from the shared vertex", () => {
    let scene = addBrace(makeScene(), new Set([0, 1]));
    scene = setBraceParam(scene, new Set([0]), "shift", 0.25);
    const [p1, p2] = computeBraceEndpoints(
      scene.braces.get(0)!,
      scene.edges,
      (id) => POSITIONS.get(id)!,
    )!;
    expect(p1.toArray()).toEqual([2.5, 0, 0]);
    expect(p2.toArray()).toEqual([0, 5, 0]);
  });

  it("works when the shared vertex is the edge's second vertex", () => {
    const scene = addBrace(makeScene(), new Set([0, 3])); // edges 0-1 and 1-2 meet at vertex 1
    expect(scene.braces.get(0)!.vertexId).toBe(1);
    const [p1, p2] = computeBraceEndpoints(
      scene.braces.get(0)!,
      scene.edges,
      (id) => POSITIONS.get(id)!,
    )!;
    expect(p1.toArray()).toEqual([5, 0, 0]);
    expect(p2.toArray()).toEqual([5, 10, 0]);
  });
});

describe("computeStrutBraces", () => {
  it("reports braces on end A, end B, both, or neither", () => {
    // brace 0 at vertex 0 (edges 0,1); brace 1 at vertex 1 (edges 0,3)
    let scene = addBrace(makeScene(), new Set([0, 1]));
    scene = addBrace(scene, new Set([0, 3]));
    const byEdge = indexBracesByEdge(scene.braces);
    const strut = (edgeId: number, length: number) =>
      computeStrutBraces(edgeId, scene.edges.get(edgeId)!, length, byEdge, scene.edges, (id) => POSITIONS.get(id)!);

    // edge 0 is 0-1: brace 0 sits at A (vertex 0), brace 1 at B (vertex 1)
    const both = strut(0, 10);
    // brace 0 leaves vertex 0 along edge 1 (0 -> 2, straight up +y)
    expect(both.a).toEqual([
      { braceId: 0, params: DEFAULT_BRACE_PARAMS, distanceFromVertex: 5, otherEdgeId: 1, otherEdgeDirection: [0, 1, 0] },
    ]);
    // brace 1 leaves vertex 1 along edge 3 (1 -> 2, i.e. (-10, 20, 0) normalised)
    expect(both.b).toHaveLength(1);
    expect(both.b[0].braceId).toBe(1);
    expect(both.b[0].distanceFromVertex).toBe(5);
    expect(both.b[0].otherEdgeId).toBe(3);
    expect(both.b[0].otherEdgeDirection[0]).toBeCloseTo(-10 / Math.hypot(10, 20), 9);
    expect(both.b[0].otherEdgeDirection[1]).toBeCloseTo(20 / Math.hypot(10, 20), 9);
    expect(both.b[0].otherEdgeDirection[2]).toBeCloseTo(0, 9);

    // edge 1 is 0-2: only brace 0, at A
    expect(strut(1, 20)).toEqual({
      a: [
        { braceId: 0, params: DEFAULT_BRACE_PARAMS, distanceFromVertex: 10, otherEdgeId: 0, otherEdgeDirection: [1, 0, 0] },
      ],
      b: [],
    });
    // edge 3 is 1-2: only brace 1, at A (vertex 1)
    expect(strut(3, 10).a).toHaveLength(1);
    expect(strut(3, 10).b).toEqual([]);
    // edge 2 has none
    expect(strut(2, 10)).toEqual({ a: [], b: [] });
  });
});

describe("brace plate properties shared by all braces", () => {
  const plate = { ...DEFAULT_BRACE_PLATE_PARAMS, width: 80, plateThickness: 3 };

  it("new braces take the given plate properties, and the default shift", () => {
    const scene = addBrace(makeScene(), new Set([0, 1]), plate);
    expect(scene.braces.get(0)!.params).toEqual({ ...DEFAULT_BRACE_PARAMS, ...plate });
    expect(scene.braces.get(0)!.params.shift).toBe(DEFAULT_BRACE_SHIFT);
  });

  it("applyBracePlateParams gives every brace the plate properties but keeps each shift", () => {
    let scene = addBrace(addBrace(makeScene(), new Set([0, 1])), new Set([1, 2]));
    scene = setBraceParam(scene, new Set([1]), "shift", 0.3);
    expect(bracePlateParamsDiffer(scene, plate)).toBe(true);

    const applied = applyBracePlateParams(scene, plate);
    expect(bracePlateParamsDiffer(applied, plate)).toBe(false);
    expect(applied.braces.get(0)!.params.width).toBe(80);
    expect(applied.braces.get(1)!.params.plateThickness).toBe(3);
    expect(applied.braces.get(0)!.params.shift).toBe(DEFAULT_BRACE_SHIFT);
    expect(applied.braces.get(1)!.params.shift).toBe(0.3);
    expect(firstBracePlateParams(applied.braces)).toEqual(plate);
    expect(firstBracePlateParams(new Map())).toEqual(DEFAULT_BRACE_PLATE_PARAMS);
  });
});

describe("bracePlatePlane", () => {
  const strutPlane = () => ({
    origin: new THREE.Vector3(0, 0, 0),
    normal: new THREE.Vector3(0, 0, 1),
    xDir: new THREE.Vector3(1, 0, 0),
  });
  const brace = (dir: [number, number, number]): StrutBraceEnd => ({
    braceId: 0,
    params: { ...DEFAULT_BRACE_PARAMS, plateThickness: 6 },
    distanceFromVertex: 0,
    otherEdgeId: 0,
    otherEdgeDirection: dir,
  });

  it("sits half the strut thickness plus half the plate thickness out, on the other edge's side", () => {
    // strut 30 thick -> plate spans z = 15 .. 21, centred on 18
    expect(bracePlatePlane(strutPlane(), 30, brace([0.2, 0.1, 0.9])).origin.toArray()).toEqual([0, 0, 18]);
    expect(bracePlatePlane(strutPlane(), 30, brace([0.2, 0.1, -0.9])).origin.toArray()).toEqual([0, 0, -18]);
  });

  it("keeps the strut plane's own normal and x direction", () => {
    const plane = bracePlatePlane(strutPlane(), 30, brace([0, 0, -1]));
    expect(plane.normal.toArray()).toEqual([0, 0, 1]);
    expect(plane.xDir.toArray()).toEqual([1, 0, 0]);
  });
});

