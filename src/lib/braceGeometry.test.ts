import { describe, expect, it } from "vitest";
import {
  arcPointAtAngle,
  isInsideArcBand,
  braceRectInArcBand,
  bracePlateHoleCenters,
  rectCorners,
  rectFitsInBand,
  type ArcEndpoints,
  type Pt,
} from "./braceGeometry";

// A strut body that's a concentric band: inn arc at radius R - hw, ext arc at R + hw, sweeping
// from angle -theta to +theta around the origin.
function concentricBand(R: number, hw: number, theta: number): ArcEndpoints {
  const at = (r: number, a: number): Pt => [r * Math.cos(a), r * Math.sin(a)];
  return {
    innA: at(R - hw, -theta),
    innB: at(R - hw, theta),
    extA: at(R + hw, -theta),
    extB: at(R + hw, theta),
  };
}

const origin: Pt = [0, 0];

describe("arcPointAtAngle", () => {
  const ends = concentricBand(2500, 60, 0.4);

  it("stays on the circle for a concentric arc", () => {
    const p = arcPointAtAngle(ends.innA, ends.innB, origin, 0.1)!;
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(2440, 6);
    expect(Math.atan2(p[1], p[0])).toBeCloseTo(0.1, 9);
  });

  it("is null outside the swept angles", () => {
    expect(arcPointAtAngle(ends.innA, ends.innB, origin, 0.5)).toBeNull();
    expect(arcPointAtAngle(ends.innA, ends.innB, origin, Math.PI)).toBeNull();
  });

  it("interpolates the radius linearly with the angle", () => {
    const start: Pt = [1000, 0];
    const end: Pt = [0, 2000]; // 90 degrees, radius 1000 -> 2000
    const p = arcPointAtAngle(start, end, origin, Math.PI / 4)!;
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(1500, 6);
  });
});

describe("braceRectInArcBand", () => {
  const ends = concentricBand(2500, 60, 0.4);
  const c: Pt = [2500, 0];
  const u: Pt = [0, 1];

  // half extents of a rect built around c with axis u
  const halfExtents = (rect: Pt[], axis: Pt, center: Pt): [number, number] => {
    const v: Pt = [-axis[1], axis[0]];
    const rel: Pt = [rect[0][0] - center[0], rect[0][1] - center[1]];
    return [Math.abs(rel[0] * axis[0] + rel[1] * axis[1]), Math.abs(rel[0] * v[0] + rel[1] * v[1])];
  };

  it("is `width` long along the axis and capped at the max width across it", () => {
    const rect = braceRectInArcBand(c, u, origin, ends, 50, 50)!.corners;
    const [p, q] = halfExtents(rect, u, c);
    expect(p).toBeCloseTo(25, 6);
    expect(q).toBeCloseTo(25, 6);
    for (const corner of rect) expect(isInsideArcBand(corner, origin, ends)).toBe(true);
  });

  it("is as wide as fits between the arcs when the cap allows more", () => {
    const rect = braceRectInArcBand(c, u, origin, ends, 50, 500)!.corners;
    const [p, q] = halfExtents(rect, u, c);
    expect(p).toBeCloseTo(25, 6);
    // the band is 120 wide, so at most 60 each side, and a bit less because of the curvature
    expect(q).toBeGreaterThan(50);
    expect(q).toBeLessThan(60.0001);
    expect(rectFitsInBand(c, u, p, q, origin, ends)).toBe(true);
    expect(rectFitsInBand(c, u, p, q * 1.02, origin, ends)).toBe(false);
  });

  it("keeps its sides parallel / perpendicular to a tilted axis", () => {
    const tilted: Pt = [Math.sin(-0.3), Math.cos(-0.3)];
    const rect = braceRectInArcBand(c, tilted, origin, ends, 50, 500)!.corners;
    const side: Pt = [rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]];
    const other: Pt = [rect[2][0] - rect[1][0], rect[2][1] - rect[1][1]];
    // `side` runs along the strut (parallel to the axis), `other` across it (perpendicular)
    expect(Math.abs(side[0] * tilted[1] - side[1] * tilted[0])).toBeLessThan(1e-6);
    expect(Math.abs(other[0] * tilted[0] + other[1] * tilted[1])).toBeLessThan(1e-6);
    expect(Math.hypot(side[0], side[1])).toBeCloseTo(50, 6);
    expect(rectCorners(origin, tilted, 1, 1)).toHaveLength(4);
  });

  it("returns null when the width can't fit, or the center isn't in the band", () => {
    expect(braceRectInArcBand(c, u, origin, ends, 5000, 50)).toBeNull();
    expect(braceRectInArcBand([100, 0], u, origin, ends, 50, 50)).toBeNull();
  });
});

describe("braceRectInArcBand dimensions", () => {
  it("reports the half extents it built the rectangle from", () => {
    const r = braceRectInArcBand([2500, 0], [0, 1], origin, concentricBand(2500, 60, 0.4), 50, 50)!;
    expect(r.halfAlong).toBe(25);
    expect(r.halfAcross).toBe(25);
    expect(r.corners).toHaveLength(4);
  });
});

describe("bracePlateHoleCenters", () => {
  it("puts holes in the 4 corners plus one midway across each end", () => {
    const holes = bracePlateHoleCenters(25, 40, 7, 9);
    expect(holes).toHaveLength(6);
    // corners: 7 in from each end (x), 9 in from each long side (y)
    expect(holes.slice(0, 4)).toEqual([
      [18, 31],
      [-18, 31],
      [-18, -31],
      [18, -31],
    ]);
    // the other two lie on the line through the center along the axis (y = 0), at the ends' columns
    expect(holes.slice(4)).toEqual([
      [18, 0],
      [-18, 0],
    ]);
  });
});

