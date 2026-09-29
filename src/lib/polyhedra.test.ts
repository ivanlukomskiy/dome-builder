import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  alignVerticesVertically,
  applyVertexTransform,
  applyVertexTransforms,
  cartesianToPolar,
  computePolyhedron,
  polarToCartesian,
  pruneToLayerCount,
  scaleSceneDiameter,
} from "./polyhedra";

const close = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-6);

describe("polar coordinates", () => {
  it("round-trips arbitrary points, including the axis", () => {
    for (const v of [
      new THREE.Vector3(3, 4, 5),
      new THREE.Vector3(-3, -4, 5),
      new THREE.Vector3(0, 7, 0),
      new THREE.Vector3(0, -7, 0),
      new THREE.Vector3(2, 0, -9),
    ]) {
      close(polarToCartesian(cartesianToPolar(v)), v);
    }
  });

  it("uses y as up: elevation 0 is the equator, PI/2 the apex, azimuth 0 is +x", () => {
    close(polarToCartesian({ r: 10, azimuth: 0, elevation: 0 }), new THREE.Vector3(10, 0, 0));
    close(polarToCartesian({ r: 10, azimuth: Math.PI / 2, elevation: 0 }), new THREE.Vector3(0, 0, 10));
    close(polarToCartesian({ r: 10, azimuth: 0, elevation: Math.PI / 2 }), new THREE.Vector3(0, 10, 0));
  });
});

describe("applyVertexTransform", () => {
  const p = cartesianToPolar(new THREE.Vector3(10, 0, 0));

  it("is a no-op for a zero diff", () => {
    close(applyVertexTransform(p, { r: 0, azimuth: 0, elevation: 0 }), new THREE.Vector3(10, 0, 0));
  });

  it("radius diff slides the vertex along its ray from the center", () => {
    const q = cartesianToPolar(new THREE.Vector3(3, 4, 0));
    close(applyVertexTransform(q, { r: 5, azimuth: 0, elevation: 0 }), new THREE.Vector3(6, 8, 0));
  });

  it("azimuth diff rotates around the vertical axis, keeping height and distance", () => {
    close(applyVertexTransform(p, { r: 0, azimuth: Math.PI / 2, elevation: 0 }), new THREE.Vector3(0, 0, 10));
  });

  it("elevation diff tilts the vertex up along its meridian at constant distance", () => {
    close(applyVertexTransform(p, { r: 0, azimuth: 0, elevation: Math.PI / 2 }), new THREE.Vector3(0, 10, 0));
  });
});

describe("computePolyhedron -> SceneData", () => {
  it("bakes vertices onto the requested sphere, in polar form", () => {
    const scene = pruneToLayerCount(computePolyhedron("icosahedron", "vertex", 2, 4000), 100);
    expect(scene.diameter).toBe(4000);
    for (const p of scene.vertices.values()) expect(p.r).toBeCloseTo(2000, 6);
    const xyz = applyVertexTransforms(scene.vertices, new Map());
    for (const v of xyz.values()) expect(v.length()).toBeCloseTo(2000, 6);
  });
});

describe("scaleSceneDiameter", () => {
  const base = () => pruneToLayerCount(computePolyhedron("icosahedron", "vertex", 2, 4000), 100);

  it("scales every vertex's distance from the center, keeping its direction", () => {
    const scene = base();
    const scaled = scaleSceneDiameter(scene, 1000);
    expect(scaled.diameter).toBe(1000);
    for (const [id, p] of scene.vertices) {
      const q = scaled.vertices.get(id)!;
      expect(q.r).toBeCloseTo(p.r / 4, 6);
      expect(q.azimuth).toBe(p.azimuth);
      expect(q.elevation).toBe(p.elevation);
    }
  });

  it("does not touch the original scene and round-trips", () => {
    const scene = base();
    const back = scaleSceneDiameter(scaleSceneDiameter(scene, 700), 4000);
    for (const [id, p] of scene.vertices) expect(back.vertices.get(id)!.r).toBeCloseTo(p.r, 6);
    expect(scene.diameter).toBe(4000);
  });

  it("ignores a non-positive or unchanged diameter", () => {
    const scene = base();
    expect(scaleSceneDiameter(scene, 0)).toBe(scene);
    expect(scaleSceneDiameter(scene, -5)).toBe(scene);
    expect(scaleSceneDiameter(scene, 4000)).toBe(scene);
  });
});


describe("alignVerticesVertically", () => {
  it("uses the transformed lowest point and preserves heights, radii, and unselected points", () => {
    const vertices = new Map([
      [0, { r: 10, azimuth: 0.2, elevation: 0.5 }],
      [1, { r: 10, azimuth: 1, elevation: 0 }],
      [2, { r: 12, azimuth: 3.5, elevation: 0.2 }],
      [3, { r: 10, azimuth: 2, elevation: 0.1 }],
    ]);
    const transforms = new Map([
      [0, { r: 2, azimuth: 0.3, elevation: -1 }],
      [1, { r: 1, azimuth: 0.2, elevation: 0.1 }],
      [3, { r: 3, azimuth: 0.1, elevation: 0.2 }],
    ]);
    const before = applyVertexTransforms(vertices, transforms);
    const aligned = alignVerticesVertically(vertices, transforms, new Set([1, 2, 0]));
    const after = applyVertexTransforms(vertices, aligned);
    expect(aligned.get(0)).toEqual(transforms.get(0));
    expect(aligned.get(3)).toEqual(transforms.get(3));
    for (const id of [0, 1, 2]) {
      expect(after.get(id)!.y).toBeCloseTo(before.get(id)!.y, 10);
      expect(after.get(id)!.length()).toBeCloseTo(before.get(id)!.length(), 10);
      expect(after.get(id)!.z * before.get(0)!.x - after.get(id)!.x * before.get(0)!.z).toBeCloseTo(0, 10);
    }
    // A point near the opposite side of the plane stays on that side.
    expect(Math.abs(aligned.get(2)!.azimuth)).toBeLessThan(Math.PI / 2);
    expect(alignVerticesVertically(vertices, aligned, new Set([1, 2, 0]))).toEqual(aligned);
    expect(transforms.has(2)).toBe(false);
  });

  it("requires two valid points and handles a basis on the vertical axis", () => {
    const vertices = new Map([
      [0, { r: 10, azimuth: 0.7, elevation: -Math.PI / 2 }],
      [1, { r: 10, azimuth: 1.2, elevation: 0 }],
    ]);
    expect(alignVerticesVertically(vertices, new Map(), new Set([0, 99])).size).toBe(0);
    const aligned = alignVerticesVertically(vertices, new Map(), new Set([0, 1]));
    expect(aligned.get(1)!.azimuth).toBeCloseTo(-0.5);
    expect(aligned.has(0)).toBe(false);
  });
});
