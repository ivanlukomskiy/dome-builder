import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  addMidpointsBetween,
  buildVertexAdjacency,
  computeVertexHubMetrics,
  type SceneData,
} from "./polyhedra";
import { buildFaceNeighborPairs, directedEdgeKey } from "./edgesInfo";

// Regression: "Add Points" emits its triangle as [a, b, mid] in selection order while mid still
// sits on the a-b chord (a degenerate triangle), so once mid is moved the ring can wind inward.
// hasFaceToNextEdge used to flip to the wrong wedge in that case.
describe("buildFaceNeighborPairs with Add Points faces", () => {
  const R = 10;
  const center = new THREE.Vector3(0, 0, 0);

  function faceFlagsAtNewVertex(selection: [number, number]) {
    const vertices = new Map<number, THREE.Vector3>([
      [0, new THREE.Vector3(R, 0, 0)],
      [1, new THREE.Vector3(0, 0, R)],
    ]);
    const scene: SceneData = {
      vertices,
      edges: new Map(),
      faces: new Map(),
      nextVertexId: 2,
      nextEdgeId: 0,
      nextFaceId: 0,
    };
    const out = addMidpointsBetween(scene, selection, (id) => vertices.get(id)!);

    // The user then lifts the new vertex off the chord.
    const positions = new Map(out.vertices);
    positions.set(2, new THREE.Vector3(7.07, 1.5, 7.07));
    const positionOf = (id: number) => positions.get(id)!;

    const refs = buildVertexAdjacency(out.edges).get(2)!;
    const metrics = computeVertexHubMetrics(positionOf(2), center, refs, positionOf, () => 30);
    const pairs = buildFaceNeighborPairs(out.faces, positionOf, center).get(2)!;

    return metrics.map((m, i) => ({
      angleToNextDeg: m.angleToNextDeg,
      hasFace: pairs.has(directedEdgeKey(m.neighborId, metrics[(i + 1) % metrics.length].neighborId)),
    }));
  }

  it.each([
    [[0, 1] as [number, number]],
    [[1, 0] as [number, number]],
  ])("puts the face on the wedge under 180 degrees regardless of selection order %j", (selection) => {
    const flags = faceFlagsAtNewVertex(selection);
    expect(flags).toHaveLength(2);
    for (const f of flags) expect(f.hasFace).toBe(f.angleToNextDeg < 180);
  });
});
