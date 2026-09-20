// Pure 2D maths (no replicad) for laying a brace out on a strut: points on the strut body's
// curved sides, and the biggest rectangle that fits between them. Kept separate from
// strutGeometryManual.ts so it can be unit-tested without loading the CAD engine.

export type Pt = [number, number];

// Where the strut body's two long sides (the "inn" and "ext" arcs) start and end.
export interface ArcEndpoints {
  innA: Pt;
  innB: Pt;
  extA: Pt;
  extB: Pt;
}

function sub(p: Pt, q: Pt): Pt {
  return [p[0] - q[0], p[1] - q[1]];
}

function len(p: Pt): number {
  return Math.hypot(p[0], p[1]);
}

function wrapAngle(delta: number): number {
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

// Where the ray from `center` at `angle` (radians) crosses the curve calculateArcPoints
// (strutGeometryManual.ts) approximates between `start` and `end` - i.e. that curve with
// infinitely many segments: the angle sweeps linearly from start's to end's (the short way
// around) while the distance from `center` changes linearly from start's to end's. Null if the ray
// points outside the swept angle range, where the curve doesn't exist.
export function arcPointAtAngle(start: Pt, end: Pt, center: Pt, angle: number): Pt | null {
  const startVec = sub(start, center);
  const endVec = sub(end, center);
  const angleStart = Math.atan2(startVec[1], startVec[0]);
  const angleEnd = Math.atan2(endVec[1], endVec[0]);

  const sweep = wrapAngle(angleEnd - angleStart);
  if (Math.abs(sweep) < 1e-9) return null;

  const t = wrapAngle(angle - angleStart) / sweep;
  if (t < -1e-9 || t > 1 + 1e-9) return null;

  const radius = len(startVec) + (len(endVec) - len(startVec)) * t;
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}

// Whether a point lies between the strut body's inn and ext arcs (and within their angular
// range).
export function isInsideArcBand(p: Pt, center: Pt, ends: ArcEndpoints): boolean {
  const rel = sub(p, center);
  const angle = Math.atan2(rel[1], rel[0]);
  const inn = arcPointAtAngle(ends.innA, ends.innB, center, angle);
  const ext = arcPointAtAngle(ends.extA, ends.extB, center, angle);
  if (!inn || !ext) return false;
  const rInn = len(sub(inn, center));
  const rExt = len(sub(ext, center));
  const r = len(rel);
  const tolerance = 1e-6;
  return r >= Math.min(rInn, rExt) - tolerance && r <= Math.max(rInn, rExt) + tolerance;
}

// The rectangle centered at `c` with half-extents `p` along `u` and `q` along u's perpendicular,
// as its 4 corners going around.
export function rectCorners(c: Pt, u: Pt, p: number, q: number): [Pt, Pt, Pt, Pt] {
  const v: Pt = [-u[1], u[0]];
  const corner = (su: number, sv: number): Pt => [
    c[0] + su * p * u[0] + sv * q * v[0],
    c[1] + su * p * u[1] + sv * q * v[1],
  ];
  return [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
}

const EDGE_SAMPLES = 24;

// Whether the whole rectangle is inside the band. The band is simply connected, so it's enough
// for the rectangle's outline to be - checked at points sampled densely along each side.
export function rectFitsInBand(c: Pt, u: Pt, p: number, q: number, center: Pt, ends: ArcEndpoints): boolean {
  const corners = rectCorners(c, u, p, q);
  for (let i = 0; i < 4; i++) {
    const from = corners[i];
    const to = corners[(i + 1) % 4];
    for (let k = 0; k < EDGE_SAMPLES; k++) {
      const t = k / EDGE_SAMPLES;
      const point: Pt = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      if (!isInsideArcBand(point, center, ends)) return false;
    }
  }
  return true;
}

export interface BraceRect {
  // The 4 corners going around.
  corners: [Pt, Pt, Pt, Pt];
  // Half the rectangle's size along the strut end's axis (`u`) / across it.
  halfAlong: number;
  halfAcross: number;
}

// The brace plate's rectangle: centered at `c`, `width` long along `u` (the strut end's axis, i.e.
// the direction of the strut) and as wide as possible across it (perpendicular to `u`) while
// staying inside the band between the inn and ext arcs, capped at `maxAcrossWidth`. Null if even a
// zero-width sliver `width` long doesn't fit (or `c` isn't in the band).
export function braceRectInArcBand(
  c: Pt,
  u: Pt,
  center: Pt,
  ends: ArcEndpoints,
  width: number,
  maxAcrossWidth: number,
): BraceRect | null {
  const p = width / 2;
  if (!isInsideArcBand(c, center, ends) || !rectFitsInBand(c, u, p, 0, center, ends)) return null;

  const qCap = Math.max(maxAcrossWidth, 0) / 2;
  if (rectFitsInBand(c, u, p, qCap, center, ends)) {
    return { corners: rectCorners(c, u, p, qCap), halfAlong: p, halfAcross: qCap };
  }

  // Fitting is monotone (shrink a fitting rectangle about its center and it still fits), so the
  // widest fit can be bisected.
  let lo = 0;
  let hi = qCap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rectFitsInBand(c, u, p, mid, center, ends)) lo = mid;
    else hi = mid;
  }
  return { corners: rectCorners(c, u, p, lo), halfAlong: p, halfAcross: lo };
}

// The brace plate's 6 bolt holes, as offsets from the plate's center in its own frame (x along the
// strut end's axis, y across it): one in each corner, `offsetLongitudinal` in from the plate's
// ends (along x) and `offsetTransverse` in from its long sides (along y), plus one midway between
// the two corner holes at each end - so those two lie on the line through the center along the
// axis.
export function bracePlateHoleCenters(
  halfAlong: number,
  halfAcross: number,
  offsetLongitudinal: number,
  offsetTransverse: number,
): Pt[] {
  const x = halfAlong - offsetLongitudinal;
  const y = halfAcross - offsetTransverse;
  return [
    [x, y],
    [-x, y],
    [-x, -y],
    [x, -y],
    [x, 0],
    [-x, 0],
  ];
}
