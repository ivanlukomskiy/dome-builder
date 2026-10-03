import { DEFAULT_DXF_LABEL_SETTINGS } from './dxfLabelSettings'
import type { DxfPolyline, DxfVertex } from './dxfExport'

// The DXF sheet for the parts export: the layout of every part's outlines (with circular arcs
// kept as bulged polyline segments) and an ASCII DXF writer (AutoCAD R12 flavor - POLYLINE/TEXT
// only, no handles or subclass markers - which every CAD/CAM package still opens).
// Pure math and string building: no replicad, so it runs anywhere and is unit-tested.

export type DxfPartKind = 'strut' | 'flange' | 'foot' | 'brace-plate' | 'brace'

// One flat part: its outlines (outer boundary and holes) in its own 2D coordinates, and the ID
// it is labeled with.
export interface DxfPart {
  name: string
  kind: DxfPartKind
  loops: DxfPolyline[]
  // Optional preferred red-label center in the part's own coordinates. When absent, the label is
  // centered in the part's bounding box.
  labelAnchor?: { x: number; y: number }
  // Optional red-label angle, in degrees, in the part's own coordinates.
  labelAngleDeg?: number
  // Green annotations about how the part connects to the others (which vertex/strut/brace goes
  // where), in the part's own 2D coordinates - not part of its outline.
  helpers?: DxfHelperText[]
  // Strut centerline reference points in the part's original 2D frame. Used to orient the
  // outline before layout; the sheet packer may subsequently rotate the whole part.
  strutPath?: { endA: [number, number]; endB: [number, number]; middle: [number, number] }
}

// A short text centered on (x, y), written along `angleDeg` and `height` mm tall (both before the
// sheet scale is applied).
export interface DxfHelperText {
  text: string
  x: number
  y: number
  angleDeg: number
  height: number
}

export interface PlacedDxfPart extends DxfPart {
  helpers: DxfHelperText[]
  // Label center and height, in sheet coordinates.
  label: { x: number; y: number; height: number; angleDeg: number }
}

export interface DxfSheet { x: number; y: number; width: number; height: number }

// Layer per part kind (so a CAM package can treat them separately) and one for the ID labels;
// the labels get their own color so they stand out from the outlines. Colors are AutoCAD's ACI
// numbers (7 = white/black, 1 = red).
export const DXF_LAYERS: { name: string; color: number }[] = [
  { name: 'STRUTS', color: 7 },
  { name: 'FLANGES', color: 7 },
  { name: 'FOOT', color: 7 },
  { name: 'BRACE_PLATES', color: 7 },
  { name: 'BRACES', color: 7 },
  { name: 'LABELS', color: 1 },
  { name: 'HELPERS', color: 3 },
]

const LAYER_OF_KIND: Record<DxfPartKind, string> = {
  strut: 'STRUTS',
  flange: 'FLANGES',
  foot: 'FOOT',
  'brace-plate': 'BRACE_PLATES',
  brace: 'BRACES',
}

// Order the kinds appear on the sheet in (each kind starts a fresh row).
const KIND_ORDER: DxfPartKind[] = ['flange', 'strut', 'foot', 'brace-plate', 'brace']

export interface DxfLayoutOptions {
  // Uniform scale applied to every part (and to the label size and gaps, so the sheet stays
  // proportional).
  scale: number
  // Sheet row width, before scaling is applied to it - rows wrap when a part would pass it.
  // Defaults to a roughly square sheet.
  partIdLabelSize?: number
  maxRowWidth?: number
}

const GAP = 20 // mm at scale 1
// Rough width of one label character relative to the text height - only used to keep neighboring
// labels from running into each other.
const CHAR_WIDTH = 0.8

// Points along the segment from `p` to the next vertex `q` (excluding `p`, including `q`) - just
// `q` for a straight one, else samples of the arc its bulge describes.
function segmentPoints(p: DxfVertex, q: DxfVertex): [number, number][] {
  if (!p.bulge) return [[q.x, q.y]]
  const theta = 4 * Math.atan(p.bulge)
  const dx = q.x - p.x
  const dy = q.y - p.y
  const chord = Math.hypot(dx, dy)
  if (chord === 0) return [[q.x, q.y]]
  // Center: from the chord's midpoint, left of p->q by (chord / 2) / tan(theta / 2) (negative
  // theta - a clockwise arc - flips it to the right).
  const offset = chord / 2 / Math.tan(theta / 2)
  const cx = (p.x + q.x) / 2 - (dy / chord) * offset
  const cy = (p.y + q.y) / 2 + (dx / chord) * offset
  const out: [number, number][] = []
  const steps = 16
  for (let i = 1; i <= steps; i++) {
    const a = (theta * i) / steps
    const rx = p.x - cx
    const ry = p.y - cy
    out.push([cx + rx * Math.cos(a) - ry * Math.sin(a), cy + rx * Math.sin(a) + ry * Math.cos(a)])
  }
  return out
}

function bounds(loops: DxfPolyline[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const loop of loops) {
    const { vertices } = loop
    vertices.forEach((v, i) => {
      add(v.x, v.y)
      const next = i + 1 < vertices.length ? vertices[i + 1] : loop.closed ? vertices[0] : null
      if (next) for (const [x, y] of segmentPoints(v, next)) add(x, y)
    })
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

function transformLoops(loops: DxfPolyline[], dx: number, dy: number, scale: number): DxfPolyline[] {
  // A uniform scale and a translation leave the bulges as they are.
  return loops.map((loop) => ({
    closed: loop.closed,
    vertices: loop.vertices.map((v) => ({ x: (v.x + dx) * scale, y: (v.y + dy) * scale, bulge: v.bulge })),
  }))
}

// Align the two vertex ends of a strut on a horizontal line, with its curved middle below
// that line. A half-turn, rather than a mirror, preserves arc bulges and contour winding.
// Work in the part's own coordinates before either row layout or sheet nesting so all outlines,
// labels and green connection annotations receive exactly the same transform.
export function orientDxfStrut(part: DxfPart): DxfPart {
  const path = part.kind === 'strut' ? part.strutPath : undefined
  if (!path) return part
  const { endA, endB, middle } = path
  const dx = endB[0] - endA[0], dy = endB[1] - endA[1]
  if (Math.hypot(dx, dy) < 1e-9) return part
  let angle = -Math.atan2(dy, dx)
  const midY = (middle[0] - endA[0]) * Math.sin(angle) + (middle[1] - endA[1]) * Math.cos(angle)
  if (midY > 1e-9) angle += Math.PI
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const point = (x: number, y: number) => ({
    x: (x - endA[0]) * cos - (y - endA[1]) * sin,
    y: (x - endA[0]) * sin + (y - endA[1]) * cos,
  })
  const angleDeg = angle * 180 / Math.PI
  const oriented: DxfPart = {
    ...part,
    loops: part.loops.map((loop) => ({
      ...loop,
      vertices: loop.vertices.map((vertex) => ({ ...vertex, ...point(vertex.x, vertex.y) })),
    })),
    labelAnchor: part.labelAnchor ? point(part.labelAnchor.x, part.labelAnchor.y) : undefined,
    labelAngleDeg: (part.labelAngleDeg ?? 0) + angleDeg,
    helpers: part.helpers?.map((helper) => ({ ...helper, ...point(helper.x, helper.y), angleDeg: helper.angleDeg + angleDeg })),
  }
  delete oriented.strutPath
  return oriented
}

// Arranges the parts on one sheet: scaled, without rotation, in rows (one kind per row group, in
// KIND_ORDER, IDs ascending as given), each part with its label centered on it. Parts with no
// geometry are dropped.
export function layoutDxfParts(parts: DxfPart[], options: DxfLayoutOptions): PlacedDxfPart[] {
  const { scale } = options
  const labelHeight = (options.partIdLabelSize ?? DEFAULT_DXF_LABEL_SETTINGS.partIdLabelSize) * scale
  const gap = GAP * scale

  interface Item {
    part: DxfPart
    loops: DxfPolyline[]
    width: number
    height: number
    helpers: DxfHelperText[]
    labelAnchor: { x: number; y: number } | null
    slotWidth: number
  }

  const items: Item[] = []
  for (const part of parts) {
    const box = bounds(part.loops)
    if (!box) continue
    // Scaled and moved so the part's bounding box starts at the origin.
    const loops = transformLoops(part.loops, -box.minX, -box.minY, scale)
    const width = (box.maxX - box.minX) * scale
    const height = (box.maxY - box.minY) * scale
    const labelWidth = part.name.length * labelHeight * CHAR_WIDTH
    const helpers = (part.helpers ?? []).map((h) => ({
      ...h,
      x: (h.x - box.minX) * scale,
      y: (h.y - box.minY) * scale,
      height: h.height * scale,
    }))
    const labelAnchor = part.labelAnchor
      ? { x: (part.labelAnchor.x - box.minX) * scale, y: (part.labelAnchor.y - box.minY) * scale }
      : null
    items.push({ part, loops, helpers, labelAnchor, width, height, slotWidth: Math.max(width, labelWidth) })
  }
  items.sort((a, b) => KIND_ORDER.indexOf(a.part.kind) - KIND_ORDER.indexOf(b.part.kind))

  const totalArea = items.reduce((sum, it) => sum + (it.slotWidth + gap) * (it.height + gap), 0)
  const widest = items.reduce((m, it) => Math.max(m, it.slotWidth), 0)
  const rowWidth =
    options.maxRowWidth !== undefined
      ? Math.max(options.maxRowWidth * scale, widest)
      : Math.max(Math.sqrt(totalArea) * 1.5, widest)

  const placed: PlacedDxfPart[] = []
  let x = 0
  let rowY = 0
  let rowHeight = 0
  let rowKind: DxfPartKind | null = null

  for (const item of items) {
    const wraps = x > 0 && x + item.slotWidth > rowWidth
    const kindChanged = rowKind !== null && rowKind !== item.part.kind
    if (wraps || kindChanged) {
      rowY += rowHeight + gap
      x = 0
      rowHeight = 0
    }
    rowKind = item.part.kind
    const slotInset = (item.slotWidth - item.width) / 2

    placed.push({
      ...item.part,
      loops: transformLoops(item.loops, x + slotInset, rowY, 1),
      helpers: item.helpers.map((h) => ({ ...h, x: h.x + x + slotInset, y: h.y + rowY })),
      label: item.part.labelAnchor
        ? { x: item.labelAnchor!.x + x + slotInset, y: item.labelAnchor!.y + rowY, height: labelHeight, angleDeg: item.part.labelAngleDeg ?? 0 }
        : { x: x + slotInset + item.width / 2, y: rowY + item.height / 2, height: labelHeight, angleDeg: item.part.labelAngleDeg ?? 0 },
    })
    x += item.slotWidth + gap
    rowHeight = Math.max(rowHeight, item.height)
  }
  return placed
}

// The text angle in (-90, 90]: a label written "backwards" (pointing left) is turned around.
export function readableAngle(angleDeg: number): number {
  let a = ((angleDeg % 360) + 360) % 360
  if (a > 180) a -= 360
  if (a > 90) a -= 180
  else if (a <= -90) a += 180
  return a
}

const num = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4))

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

// The DXF file text for the laid-out parts: each outline a closed POLYLINE on its kind's layer,
// each ID a TEXT on the LABELS layer.
export function writeDxf(parts: PlacedDxfPart[], sheets: DxfSheet[] = []): string {
  let out = ''
  out += pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009')
  out += pair(9, '$INSUNITS') + pair(70, 4) // millimeters
  out += pair(0, 'ENDSEC')

  out += pair(0, 'SECTION') + pair(2, 'TABLES')
  out += pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1)
  out += pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, 0)
  out += pair(0, 'ENDTAB')
  const layers = sheets.length ? [...DXF_LAYERS, { name: 'SHEETS', color: 5 }] : DXF_LAYERS
  out += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length)
  for (const layer of layers) {
    out += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color) + pair(6, 'CONTINUOUS')
  }
  out += pair(0, 'ENDTAB')
  out += pair(0, 'ENDSEC')

  out += pair(0, 'SECTION') + pair(2, 'ENTITIES')
  for (const sheet of sheets) {
    out += pair(0, 'POLYLINE') + pair(8, 'SHEETS') + pair(66, 1) + pair(70, 1)
    out += pair(10, 0) + pair(20, 0) + pair(30, 0)
    for (const [x, y] of [[sheet.x, sheet.y], [sheet.x + sheet.width, sheet.y], [sheet.x + sheet.width, sheet.y + sheet.height], [sheet.x, sheet.y + sheet.height]])
      out += pair(0, 'VERTEX') + pair(8, 'SHEETS') + pair(10, num(x)) + pair(20, num(y)) + pair(30, 0)
    out += pair(0, 'SEQEND') + pair(8, 'SHEETS')
  }
  for (const part of parts) {
    const layer = LAYER_OF_KIND[part.kind]
    for (const loop of part.loops) {
      out += pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(70, loop.closed ? 1 : 0)
      out += pair(10, 0) + pair(20, 0) + pair(30, 0)
      for (const v of loop.vertices) {
        out += pair(0, 'VERTEX') + pair(8, layer) + pair(10, num(v.x)) + pair(20, num(v.y)) + pair(30, 0)
        if (v.bulge) out += pair(42, v.bulge.toFixed(6))
      }
      out += pair(0, 'SEQEND') + pair(8, layer)
    }
    out +=
      pair(0, 'TEXT') +
      pair(8, 'LABELS') +
      pair(10, num(part.label.x)) +
      pair(20, num(part.label.y)) +
      pair(30, 0) +
      pair(40, num(part.label.height)) +
      pair(1, part.name) +
      pair(50, num(readableAngle(part.label.angleDeg))) +
      pair(72, 1) +
      pair(11, num(part.label.x)) +
      pair(21, num(part.label.y)) +
      pair(31, 0) +
      pair(73, 2)
    for (const h of part.helpers) {
      // Centered on its point (horizontal/vertical alignment 1/2, whose reference point is the
      // 11/21 pair), turned so it never reads upside down.
      const angle = readableAngle(h.angleDeg)
      out +=
        pair(0, 'TEXT') +
        pair(8, 'HELPERS') +
        pair(10, num(h.x)) +
        pair(20, num(h.y)) +
        pair(30, 0) +
        pair(40, num(h.height)) +
        pair(1, h.text) +
        pair(50, num(angle)) +
        pair(72, 1) +
        pair(11, num(h.x)) +
        pair(21, num(h.y)) +
        pair(31, 0) +
        pair(73, 2)
    }
  }
  out += pair(0, 'ENDSEC') + pair(0, 'EOF')
  return out
}
