import type { DxfPolyline, DxfVertex } from './dxfExport'

// The DXF sheet for the parts export: the layout of every part's outlines (with circular arcs
// kept as bulged polyline segments) and an ASCII DXF writer (AutoCAD R12 flavor - POLYLINE/TEXT
// only, no handles or subclass markers - which every CAD/CAM package still opens).
// Pure math and string building: no replicad, so it runs anywhere and is unit-tested.

export type DxfPartKind = 'strut' | 'flange' | 'brace-plate' | 'brace'

// One flat part: its outlines (outer boundary and holes) in its own 2D coordinates, and the ID
// it is labeled with.
export interface DxfPart {
  name: string
  kind: DxfPartKind
  loops: DxfPolyline[]
}

export interface PlacedDxfPart extends DxfPart {
  // Label position (left/baseline) and height, in sheet coordinates.
  label: { x: number; y: number; height: number }
}

// Layer per part kind (so a CAM package can treat them separately) and one for the ID labels;
// the labels get their own color so they stand out from the outlines. Colors are AutoCAD's ACI
// numbers (7 = white/black, 1 = red).
export const DXF_LAYERS: { name: string; color: number }[] = [
  { name: 'STRUTS', color: 7 },
  { name: 'FLANGES', color: 7 },
  { name: 'BRACE_PLATES', color: 7 },
  { name: 'BRACES', color: 7 },
  { name: 'LABELS', color: 1 },
]

const LAYER_OF_KIND: Record<DxfPartKind, string> = {
  strut: 'STRUTS',
  flange: 'FLANGES',
  'brace-plate': 'BRACE_PLATES',
  brace: 'BRACES',
}

// Order the kinds appear on the sheet in (each kind starts a fresh row).
const KIND_ORDER: DxfPartKind[] = ['strut', 'flange', 'brace-plate', 'brace']

export interface DxfLayoutOptions {
  // Uniform scale applied to every part (and to the label size and gaps, so the sheet stays
  // proportional).
  scale: number
  // Sheet row width, before scaling is applied to it - rows wrap when a part would pass it.
  // Defaults to a roughly square sheet.
  maxRowWidth?: number
}

const LABEL_HEIGHT = 8 // mm at scale 1
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

// Arranges the parts on one sheet: scaled, without rotation, in rows (one kind per row group, in
// KIND_ORDER, IDs ascending as given), each part with its label just under it. Parts with no
// geometry are dropped.
export function layoutDxfParts(parts: DxfPart[], options: DxfLayoutOptions): PlacedDxfPart[] {
  const { scale } = options
  const labelHeight = LABEL_HEIGHT * scale
  const gap = GAP * scale
  const labelBlock = labelHeight * 1.8

  interface Item {
    part: DxfPart
    loops: DxfPolyline[]
    width: number
    height: number
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
    items.push({ part, loops, width, height, slotWidth: Math.max(width, labelWidth) })
  }
  items.sort((a, b) => KIND_ORDER.indexOf(a.part.kind) - KIND_ORDER.indexOf(b.part.kind))

  const totalArea = items.reduce((sum, it) => sum + (it.slotWidth + gap) * (it.height + labelBlock + gap), 0)
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

    placed.push({
      ...item.part,
      loops: transformLoops(item.loops, x, rowY + labelBlock, 1),
      label: { x, y: rowY + labelHeight * 0.4, height: labelHeight },
    })
    x += item.slotWidth + gap
    rowHeight = Math.max(rowHeight, item.height + labelBlock)
  }
  return placed
}

const num = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4))

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

// The DXF file text for the laid-out parts: each outline a closed POLYLINE on its kind's layer,
// each ID a TEXT on the LABELS layer.
export function writeDxf(parts: PlacedDxfPart[]): string {
  let out = ''
  out += pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009')
  out += pair(9, '$INSUNITS') + pair(70, 4) // millimeters
  out += pair(0, 'ENDSEC')

  out += pair(0, 'SECTION') + pair(2, 'TABLES')
  out += pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1)
  out += pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, 0)
  out += pair(0, 'ENDTAB')
  out += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, DXF_LAYERS.length)
  for (const layer of DXF_LAYERS) {
    out += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color) + pair(6, 'CONTINUOUS')
  }
  out += pair(0, 'ENDTAB')
  out += pair(0, 'ENDSEC')

  out += pair(0, 'SECTION') + pair(2, 'ENTITIES')
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
      pair(1, part.name)
  }
  out += pair(0, 'ENDSEC') + pair(0, 'EOF')
  return out
}
