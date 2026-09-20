import { describe, expect, it } from 'vitest'
import { layoutDxfParts, writeDxf, type DxfPart } from './dxf'
import type { DxfPolyline } from './dxfExport'

const rect = (w: number, h: number, x = 0, y = 0): DxfPolyline => ({
  closed: true,
  vertices: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ].map(([vx, vy]) => ({ x: vx, y: vy, bulge: 0 })),
})
const part = (name: string, kind: DxfPart['kind'], w: number, h: number, x = 100, y = -50): DxfPart => ({
  name,
  kind,
  loops: [rect(w, h, x, y)],
})

function bbox(loops: DxfPolyline[]) {
  const pts = loops.flatMap((l) => l.vertices)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

describe('layoutDxfParts', () => {
  const parts = [
    part('brace-1', 'brace', 30, 20),
    part('strut-1', 'strut', 400, 50),
    part('flange-1', 'flange', 60, 60),
    part('strut-2', 'strut', 400, 50),
  ]

  it('never overlaps parts or their labels', () => {
    const placed = layoutDxfParts(parts, { scale: 1 })
    const boxes = placed.map((p) => {
      const b = bbox(p.loops)
      // The part plus the label strip under it.
      return { name: p.name, minX: b.minX, maxX: b.maxX, minY: p.label.y, maxY: b.maxY }
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
        expect(overlap).toBe(false)
      }
    }
  })

  it('keeps part sizes (scaled) and groups by kind', () => {
    const placed = layoutDxfParts(parts, { scale: 0.5 })
    const strut = placed.find((p) => p.name === 'strut-1')!
    const b = bbox(strut.loops)
    expect(b.maxX - b.minX).toBeCloseTo(200, 5)
    expect(b.maxY - b.minY).toBeCloseTo(25, 5)
    expect(placed.map((p) => p.kind)).toEqual(['strut', 'strut', 'flange', 'brace'])
  })

  it('puts each label under its part', () => {
    const [first] = layoutDxfParts(parts, { scale: 1 })
    expect(first.label.y).toBeLessThan(bbox(first.loops).minY)
  })

  it('drops parts with no geometry', () => {
    expect(layoutDxfParts([{ name: 'x', kind: 'strut', loops: [] }], { scale: 1 })).toEqual([])
  })
})

describe('arcs', () => {
  // A half-disc: the diameter on the x axis from (0,0) to (10,0), closed by a semicircle (bulge
  // magnitude 1 = 180 degrees) from (10,0) back to (0,0) that reaches 5 away from the axis.
  const halfDisc: DxfPart = {
    name: 'arc',
    kind: 'flange',
    loops: [
      {
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: -1 },
        ],
      },
    ],
  }

  it('counts the arc\'s extent in the part\'s size, and keeps bulges through the layout', () => {
    const [placed] = layoutDxfParts([halfDisc], { scale: 2 })
    const b = bbox(placed.loops)
    expect(b.maxX - b.minX).toBeCloseTo(20, 4)
    // The arc bulges 5 mm (10 scaled) below the axis, so the part is lifted by that much above its
    // label strip (8 * 2 * 1.8 tall) - the axis vertices aren't its lowest point.
    expect(b.minY).toBeCloseTo(8 * 2 * 1.8 + 10, 3)
    expect(placed.loops[0].vertices[1].bulge).toBe(-1)
  })

  it('writes bulges as group 42', () => {
    expect(writeDxf(layoutDxfParts([halfDisc], { scale: 1 })).includes('\n42\n-1.000000\n')).toBe(true)
  })
})

describe('writeDxf', () => {
  it('writes a well-formed file with outlines and colored labels', () => {
    const text = writeDxf(layoutDxfParts([part('strut-7', 'strut', 10, 5)], { scale: 1 }))
    const lines = text.split('\n')
    expect(lines.slice(0, 2)).toEqual(['0', 'SECTION'])
    expect(text.trimEnd().endsWith('EOF')).toBe(true)
    expect(text.split('\nPOLYLINE\n').length - 1).toBe(1)
    expect(text.split('\nVERTEX\n').length - 1).toBe(4)
    expect(text.includes('\nstrut-7\n')).toBe(true)
    // Labels sit on their own layer, defined with a different color (red) than the outlines.
    expect(text.includes('LAYER\n2\nLABELS\n70\n0\n62\n1\n')).toBe(true)
    expect(text.includes('LAYER\n2\nSTRUTS\n70\n0\n62\n7\n')).toBe(true)
    // Every group is a code/value line pair.
    expect(lines.length % 2).toBe(1) // trailing newline leaves one empty element
  })
})
