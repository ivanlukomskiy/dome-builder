import { describe, expect, it } from "vitest";
import {
  arcPointAtAngle,
  isInsideArcBand,
  maxRectInArcBand,
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

describe("maxRectInArcBand", () => {
  const cases: { name: string; ends: ArcEndpoints; c: Pt; u: Pt }[] = [
    {
      name: "axis tangent at the brace",
      ends: concentricBand(2500, 60, 0.4),
      c: [2500, 0],
      u: [0, 1],
    },
    {
      name: "axis tilted away from the tangent",
      ends: concentricBand(2500, 60, 0.4),
      c: [2500 * Math.cos(0.1), 2500 * Math.sin(0.1)],
      u: [Math.sin(-0.3), Math.cos(-0.3)],
    },
    {
      name: "band whose radius changes along the strut",
      ends: {
        innA: [2440 * Math.cos(-0.4), 2440 * Math.sin(-0.4)],
        innB: [2300 * Math.cos(0.4), 2300 * Math.sin(0.4)],
        extA: [2560 * Math.cos(-0.4), 2560 * Math.sin(-0.4)],
        extB: [2420 * Math.cos(0.4), 2420 * Math.sin(0.4)],
      },
      c: [2450 * Math.cos(0.05), 2450 * Math.sin(0.05)],
      u: [-Math.sin(-0.35), Math.cos(-0.35)],
    },
  ];

  it.each(cases.map((c) => [c] as [(typeof cases)[number]]))("fits and can't grow: %j", (tc) => {
    const rect = maxRectInArcBand(tc.c, tc.u, origin, tc.ends, 1000)!;
    expect(rect).not.toBeNull();

    // half extents recovered from the corners
    const v: Pt = [-tc.u[1], tc.u[0]];
    const rel = (pt: Pt): Pt => [pt[0] - tc.c[0], pt[1] - tc.c[1]];
    const p = Math.abs(rel(rect[0])[0] * tc.u[0] + rel(rect[0])[1] * tc.u[1]);
    const q = Math.abs(rel(rect[0])[0] * v[0] + rel(rect[0])[1] * v[1]);
    expect(p).toBeGreaterThan(0);
    expect(q).toBeGreaterThan(0);

    for (const corner of rect) expect(isInsideArcBand(corner, origin, tc.ends)).toBe(true);
    expect(rectFitsInBand(tc.c, tc.u, p, q, origin, tc.ends)).toBe(true);
    // Growing either side by 2% leaves the band.
    expect(rectFitsInBand(tc.c, tc.u, p * 1.02, q, origin, tc.ends) &&
      rectFitsInBand(tc.c, tc.u, p, q * 1.02, origin, tc.ends)).toBe(false);

    // Compare with a brute-force search over (p, q) for the largest area.
    let best = 0;
    for (let pi = 1; pi <= 200; pi++) {
      const pp = (pi / 200) * 1000;
      for (let qi = 1; qi <= 100; qi++) {
        const qq = (qi / 100) * 120;
        if (pp * qq > best && rectFitsInBand(tc.c, tc.u, pp, qq, origin, tc.ends)) best = pp * qq;
      }
    }
    expect(p * q).toBeGreaterThan(best * 0.98);
  });

  it("has sides parallel and perpendicular to the axis", () => {
    const u: Pt = [Math.sin(-0.3), Math.cos(-0.3)];
    const rect = maxRectInArcBand([2500, 0], u, origin, concentricBand(2500, 60, 0.4), 1000)!;
    const side: Pt = [rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]];
    const other: Pt = [rect[2][0] - rect[1][0], rect[2][1] - rect[1][1]];
    // one side along u, the other perpendicular to it
    expect(Math.abs(side[0] * u[1] - side[1] * u[0]) < 1e-6 ||
      Math.abs(other[0] * u[1] - other[1] * u[0]) < 1e-6).toBe(true);
    expect(Math.abs(side[0] * other[0] + side[1] * other[1])).toBeLessThan(1e-6);
    expect(rectCorners([0, 0], u, 1, 1)).toHaveLength(4);
  });

  it("returns null when the center isn't in the band", () => {
    expect(maxRectInArcBand([100, 0], [0, 1], origin, concentricBand(2500, 60, 0.4), 1000)).toBeNull();
  });
});
