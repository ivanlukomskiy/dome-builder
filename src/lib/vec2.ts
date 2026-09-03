import type { Point2D } from "replicad";

// Pure, dependency-free 2D vector math shared by every module that works with flat (replicad or
// hand-rolled) 2D geometry - strutGeometry.ts, strutGeometryManual.ts, and flangeGeometry.ts all
// need the same handful of primitives.

export function add2(p: Point2D, q: Point2D): Point2D {
  return [p[0] + q[0], p[1] + q[1]];
}

export function sub2(p: Point2D, q: Point2D): Point2D {
  return [p[0] - q[0], p[1] - q[1]];
}

export function scale2(p: Point2D, s: number): Point2D {
  return [p[0] * s, p[1] * s];
}

export function dot2(p: Point2D, q: Point2D): number {
  return p[0] * q[0] + p[1] * q[1];
}

export function cross2(p: Point2D, q: Point2D): number {
  return p[0] * q[1] - p[1] * q[0];
}

export function length2(p: Point2D): number {
  return Math.hypot(p[0], p[1]);
}

export function normalize2(p: Point2D): Point2D {
  const l = length2(p);
  return l < 1e-9 ? [1, 0] : [p[0] / l, p[1] / l];
}
