import type { DxfLayoutOptions, DxfPart, DxfSheet, PlacedDxfPart } from './dxf'
import { DEFAULT_DXF_LABEL_SETTINGS } from './dxfLabelSettings'
import type { DxfPolyline } from './dxfExport'
import { allowedRotations, validateDxfSheetSettings, type DxfSheetSettings } from './dxfSheetSettings'

export type Point2 = [number, number]
export interface NestPlacement { index: number; sheet: number; x: number; y: number; angle: number }
export interface NestingEngine {
  // `rotations`: the angles (radians) a part may be placed at.
  pack(polygons: Point2[][], width: number, height: number, spacing: number, rotations: number[], progress: (done: number, total: number) => void): NestPlacement[]
}
export interface NestedDxf { parts: PlacedDxfPart[]; sheets: DxfSheet[] }

// Native libnest2d coordinates are millionths of a millimeter. Keep its units
// consistent with its geometry backend, and stay well inside JS integer limits.
const UNITS = 1_000_000
const CURVE_TOLERANCE = 0.02 // mm; only the packing envelope is approximated.
const EPSILON = 0.0002 // Includes four-decimal DXF output rounding.

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function convexHull(points: Point2[]): Point2[] {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1])
  const half = (input: Point2[]) => {
    const out: Point2[] = []
    for (const point of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop()
      out.push(point)
    }
    return out.slice(0, -1)
  }
  // Clockwise, without duplicate closing vertex (the native wrapper adds it).
  return [...half(sorted), ...half([...sorted].reverse())].reverse()
}

// Tangent intersections enclose each circular segment. Merely sampling points
// on the curve creates an inscribed polygon, which can allow real arcs to collide.
export function packingEnvelope(loops: DxfPolyline[], scale: number): Point2[] {
  const points: Point2[] = []
  for (const loop of loops) {
    if (!loop.closed || loop.vertices.length < 2) throw new Error('Part has an open or empty outline.')
    loop.vertices.forEach((p, i) => {
      const q = loop.vertices[(i + 1) % loop.vertices.length]
      if (![p.x, p.y, p.bulge].every(Number.isFinite)) throw new Error('Part outline contains invalid coordinates.')
      const a: Point2 = [p.x * scale, p.y * scale]
      const b: Point2 = [q.x * scale, q.y * scale]
      points.push(a)
      if (!p.bulge) return
      const theta = 4 * Math.atan(p.bulge)
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const chord = Math.hypot(dx, dy)
      if (chord === 0) throw new Error('Part contains a degenerate circular arc.')
      const offset = chord / (2 * Math.tan(theta / 2))
      const cx = (a[0] + b[0]) / 2 - dy / chord * offset
      const cy = (a[1] + b[1]) / 2 + dx / chord * offset
      const radius = Math.hypot(a[0] - cx, a[1] - cy)
      const maxAngle = Math.min(Math.PI / 8, 2 * Math.acos(radius / (radius + CURVE_TOLERANCE)))
      const steps = Math.ceil(Math.abs(theta) / maxAngle)
      if (!Number.isFinite(steps) || steps > 100_000) throw new Error('Part circular arc is too large to pack reliably.')
      const start = Math.atan2(a[1] - cy, a[0] - cx)
      const tangentRadius = radius / Math.cos(theta / steps / 2)
      for (let j = 0; j < steps; j++) {
        const angle = start + theta * (j + 0.5) / steps
        points.push([cx + tangentRadius * Math.cos(angle), cy + tangentRadius * Math.sin(angle)])
      }
    })
  }
  // Round outward to the integer grid before computing the convex hull.
  const integerPoints: Point2[] = points.flatMap(([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.max(Math.abs(x), Math.abs(y)) > 1_000_000)
      throw new Error('Part coordinates exceed the supported range.')
    const loX = Math.floor(x * UNITS), hiX = Math.ceil(x * UNITS)
    const loY = Math.floor(y * UNITS), hiY = Math.ceil(y * UNITS)
    return [[loX, loY], [loX, hiY], [hiX, loY], [hiX, hiY]]
  })
  const hull = convexHull(integerPoints)
  if (hull.length < 3) throw new Error('Part has no usable outer boundary.')
  return hull
}

function box(points: Point2[]) {
  return points.reduce((b, [x, y]) => ({ minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
}

function transform([x, y]: Point2, angle: number, dx: number, dy: number): Point2 {
  return [x * Math.cos(angle) - y * Math.sin(angle) + dx, x * Math.sin(angle) + y * Math.cos(angle) + dy]
}

function overlaps(a: Point2[], b: Point2[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length]
      const length = Math.hypot(q[0] - p[0], q[1] - p[1])
      const nx = -(q[1] - p[1]) / length, ny = (q[0] - p[0]) / length
      const projections = [a, b].map((poly) => poly.map(([x, y]) => x * nx + y * ny))
      if (Math.max(...projections[0]) <= Math.min(...projections[1]) + EPSILON
        || Math.max(...projections[1]) <= Math.min(...projections[0]) + EPSILON) return false
    }
  }
  return true
}

function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function polygonDistance(a: Point2[], b: Point2[]): number {
  let distance = Infinity
  for (const [points, edges] of [[a, b], [b, a]]) {
    for (const point of points) for (let i = 0; i < edges.length; i++)
      distance = Math.min(distance, pointSegmentDistance(point, edges[i], edges[(i + 1) % edges.length]))
  }
  return distance
}

export function nestDxfParts(parts: DxfPart[], options: DxfLayoutOptions, settings: DxfSheetSettings,
  engine: NestingEngine, progress: (done: number, total: number) => void = () => {}): NestedDxf {
  validateDxfSheetSettings(settings)
  if (!Number.isFinite(options.scale) || options.scale <= 0) throw new Error('Export scale must be greater than zero.')
  if (!parts.length) throw new Error('There are no parts to arrange on a sheet.')
  const width = settings.width - 2 * settings.margin, height = settings.height - 2 * settings.margin
  const rotations = allowedRotations(settings.rotationStep)
  const polygons = parts.map((part) => {
    let hull: Point2[]
    try { hull = packingEnvelope(part.loops, options.scale) }
    catch (error) { throw new Error(`Part ${part.name}: ${error instanceof Error ? error.message : String(error)}`) }
    const size = (angle: number) => {
      const bounds = box(angle ? hull.map((point) => transform(point, angle, 0, 0)) : hull)
      return { w: (bounds.maxX - bounds.minX) / UNITS, h: (bounds.maxY - bounds.minY) / UNITS }
    }
    if (!rotations.some((angle) => { const { w, h } = size(angle); return w <= width + EPSILON && h <= height + EPSILON })) {
      const { w, h } = size(0)
      throw new Error(`Part ${part.name} (${w.toFixed(2)} × ${h.toFixed(2)} mm) is larger than the usable sheet (${width.toFixed(2)} × ${height.toFixed(2)} mm), including allowed rotations.`)
    }
    return hull
  })
  const placements = engine.pack(polygons, Math.floor(width * UNITS), Math.floor(height * UNITS), Math.ceil(settings.spacing * UNITS), rotations, progress)
  if (placements.length !== parts.length) throw new Error('Packing failed: not every part was placed.')
  const seen = new Set<number>()
  const usedSheets = new Set<number>()
  const placedEnvelopes: { polygon: Point2[]; bounds: ReturnType<typeof box>; sheet: number; name: string }[] = []
  for (const placement of placements) {
    const { index, sheet, x, y, angle } = placement
    if (!Number.isInteger(index) || index < 0 || index >= parts.length || seen.has(index)
      || !Number.isInteger(sheet) || sheet < 0 || sheet >= parts.length || ![x, y, angle].every(Number.isFinite))
      throw new Error('Packing failed: invalid part placement.')
    if (!rotations.some((allowed) => Math.abs(Math.sin((angle - allowed) / 2)) < 1e-9))
      throw new Error(`Packing failed: part ${parts[index].name} was turned by an angle that is not allowed.`)
    seen.add(index)
    usedSheets.add(sheet)
    const polygon = polygons[index].map(([px, py]) => transform([px / UNITS, py / UNITS], angle, x / UNITS, y / UNITS))
    const bounds = box(polygon)
    if (bounds.minX < -EPSILON || bounds.minY < -EPSILON || bounds.maxX > width + EPSILON || bounds.maxY > height + EPSILON)
      throw new Error(`Packing failed: part ${parts[index].name} crosses the sheet margin.`)
    for (const other of placedEnvelopes) {
      if (other.sheet !== sheet) continue
      const dx = Math.max(bounds.minX - other.bounds.maxX, other.bounds.minX - bounds.maxX, 0)
      const dy = Math.max(bounds.minY - other.bounds.maxY, other.bounds.minY - bounds.maxY, 0)
      if (Math.hypot(dx, dy) > settings.spacing + EPSILON) continue
      if (overlaps(polygon, other.polygon) || polygonDistance(polygon, other.polygon) < settings.spacing - EPSILON)
        throw new Error(`Packing failed: parts ${parts[index].name} and ${other.name} overlap or violate spacing.`)
    }
    placedEnvelopes.push({ polygon, bounds, sheet, name: parts[index].name })
  }
  const sheetIds = [...usedSheets].sort((a, b) => a - b)
  const sheetGap = Math.max(20, settings.spacing)
  const sheets = sheetIds.map((_, i) => ({ x: i * (settings.width + sheetGap), y: 0, width: settings.width, height: settings.height }))
  const placed = placements.map(({ index, sheet, x, y, angle }): PlacedDxfPart => {
    const part = parts[index], sheetRect = sheets[sheetIds.indexOf(sheet)]
    const dx = x / UNITS + settings.margin + sheetRect.x, dy = y / UNITS + settings.margin
    const point = (px: number, py: number) => transform([px * options.scale, py * options.scale], angle, dx, dy)
    const angleDeg = angle * 180 / Math.PI
    const bounds = box(polygons[index])
    const anchor = part.labelAnchor ?? { x: (bounds.minX + bounds.maxX) / (2 * UNITS * options.scale), y: (bounds.minY + bounds.maxY) / (2 * UNITS * options.scale) }
    const [labelX, labelY] = point(anchor.x, anchor.y)
    return {
      ...part,
      loops: part.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((v) => {
        const [px, py] = point(v.x, v.y)
        return { x: px, y: py, bulge: v.bulge }
      }) })),
      helpers: (part.helpers ?? []).map((helper) => {
        const [px, py] = point(helper.x, helper.y)
        return { ...helper, x: px, y: py, height: helper.height * options.scale, angleDeg: helper.angleDeg + angleDeg }
      }),
      label: { x: labelX, y: labelY, height: (options.partIdLabelSize ?? DEFAULT_DXF_LABEL_SETTINGS.partIdLabelSize) * options.scale, angleDeg: (part.labelAngleDeg ?? 0) + angleDeg },
    }
  })
  return { parts: placed, sheets }
}
