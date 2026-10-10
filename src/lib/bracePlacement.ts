import * as THREE from 'three'
import type { StrutBraceEnd } from './braces'
import type { PreviewBuildInputParams, StrutGeometryEntry } from './previewBuildInputs'
import { arcEndpoints, strutBridgeSides, computeStrutPlane, precalculateStrutEnd } from './strutGeometry'
import { arcPointAtAngle, interpolatePoint, plateCenterSegments, plateHalfAcross, type PlateBand, type Pt } from './braceGeometry'
import { dot2, normalize2, scale2, sub2 } from './vec2'

export type BracePlacementParams = Pick<PreviewBuildInputParams,
  'endGrooveLengthPercent' | 'midGrooveLengthPercent' | 'chamferLength' |
  'millingDiameter' | 'grooveDepth' | 'extrudeDistance' | 'roundStrutBridge'>

interface PlateSite {
  brace: StrutBraceEnd
  band: PlateBand
  axis: Pt
  radial: Pt
  origin: Pt
  preferred: Pt
  minimumAcross: number
  segments: [Pt, Pt][]
}

function plateSite(entry: StrutGeometryEntry, end: 'a' | 'b', brace: StrutBraceEnd, params: BracePlacementParams): PlateSite {
  const a3 = new THREE.Vector3(...entry.posA), b3 = new THREE.Vector3(...entry.posB)
  const plane = computeStrutPlane(a3, b3, new THREE.Vector3())
  const yDir = plane.normal.clone().cross(plane.xDir)
  const project = (p: THREE.Vector3): Pt => [p.dot(plane.xDir), p.dot(yDir)]
  const a = project(a3), b = project(b3)
  const origin = end === 'a' ? a : b, other = end === 'a' ? b : a
  const radial = normalize2(origin)
  const toward = sub2(other, origin)
  const axis = normalize2(sub2(toward, scale2(radial, dot2(toward, radial))))
  const measurements = (offset: number, corner: number, added = 0) => precalculateStrutEnd(
    offset, corner, params.endGrooveLengthPercent, params.midGrooveLengthPercent,
    params.chamferLength, params.millingDiameter, params.grooveDepth, params.extrudeDistance / 2, added,
  )
  const ends = arcEndpoints(a, b, [0, 0], measurements(entry.offsetA, entry.cornerLengthA, entry.addedThicknessA), measurements(entry.offsetB, entry.cornerLengthB, entry.addedThicknessB))
  const { inner, outer } = strutBridgeSides(ends, [0, 0], params.roundStrutBridge)
  const band: PlateBand = {
    polygon: [...inner, ...outer.slice().reverse()],
    centerline: inner.map((point, i) => interpolatePoint(point, outer[i], 0.5)),
  }
  const nominal = interpolatePoint(origin, other, brace.params.shift)
  let preferred = nominal
  if (params.roundStrutBridge) {
    const angle = Math.atan2(nominal[1], nominal[0])
    const inn = arcPointAtAngle(ends.innA, ends.innB, [0, 0], angle)
    const ext = arcPointAtAngle(ends.extA, ends.extB, [0, 0], angle)
    if (inn && ext) preferred = interpolatePoint(inn, ext, 0.5)
  } else {
    const start = band.centerline[0], finish = band.centerline[1], v = sub2(finish, start)
    const t = dot2(sub2(nominal, start), v) / dot2(v, v)
    preferred = interpolatePoint(start, finish, Math.max(0, Math.min(1, t)))
  }
  // Keep the brace's thickness and its bolt holes inside the mounting plate.
  const minimumAcross = Math.max(
    0.01, brace.params.thickness / 2,
    brace.params.plateHoleDiameter > 0 ? brace.params.plateHoleOffsetTransverse + brace.params.plateHoleDiameter / 2 : 0,
    brace.params.plateHoleCenterDiameter / 2,
  )
  const segments = minimumAcross <= brace.params.maxPlateWidth / 2 && brace.params.width > 0
    ? plateCenterSegments(band, axis, brace.params.width / 2, minimumAcross)
    : []
  return { brace, band, axis, radial, origin, preferred, minimumAcross, segments }
}

const height = (site: PlateSite, point: Pt) => dot2(sub2(point, site.origin), site.radial)

// Resolve both plates together before splitting work into independent strut jobs.
// The hub radial is the flange normal. Equal heights plus tangent-aligned plate
// endpoints make the connecting brace exactly parallel to that flange.
export function resolveBracePlacements(entries: StrutGeometryEntry[], params: BracePlacementParams): void {
  const groups = new Map<number, PlateSite[]>()
  for (const entry of entries) {
    for (const end of ['a', 'b'] as const) {
      for (const brace of entry.braces[end]) {
        const sites = groups.get(brace.braceId) ?? []
        sites.push(plateSite(entry, end, brace, params))
        groups.set(brace.braceId, sites)
      }
    }
  }
  for (const sites of groups.values()) {
    sites.forEach((site) => { site.brace.placement = null })
    if (sites.length !== 2) continue
    const [a, b] = sites
    const target = (height(a, a.preferred) + height(b, b.preferred)) / 2
    let best: { centers: [Pt, Pt]; distance: number; travel: number } | undefined
    for (const sa of a.segments) for (const sb of b.segments) {
      const ha = sa.map((p) => height(a, p)), hb = sb.map((p) => height(b, p))
      const lo = Math.max(Math.min(...ha), Math.min(...hb))
      const hi = Math.min(Math.max(...ha), Math.max(...hb))
      if (lo > hi) continue
      const h = Math.max(lo, Math.min(hi, target))
      const point = (site: PlateSite, segment: [Pt, Pt], heights: number[]): Pt => {
        if (Math.abs(heights[1] - heights[0]) > 1e-10) return interpolatePoint(segment[0], segment[1], (h - heights[0]) / (heights[1] - heights[0]))
        const v = sub2(segment[1], segment[0]), lengthSq = dot2(v, v)
        const t = lengthSq > 0 ? dot2(sub2(site.preferred, segment[0]), v) / lengthSq : 0
        return interpolatePoint(segment[0], segment[1], Math.max(0, Math.min(1, t)))
      }
      const centers: [Pt, Pt] = [point(a, sa, ha), point(b, sb, hb)]
      const distance = Math.abs(h - target)
      const travel = centers.reduce((sum, p, i) => {
        const delta = sub2(p, sites[i].preferred)
        return sum + dot2(delta, delta)
      }, 0)
      if (!best || distance < best.distance - 1e-9 ||
        (Math.abs(distance - best.distance) <= 1e-9 && travel < best.travel)) best = { centers, distance, travel }
    }
    if (!best) continue
    sites.forEach((site, i) => {
      const center = best.centers[i]
      site.brace.placement = {
        center,
        halfAcross: plateHalfAcross(center, site.axis, site.brace.params.width / 2,
          site.minimumAcross, site.brace.params.maxPlateWidth / 2, site.band.polygon),
      }
    })
  }
}
