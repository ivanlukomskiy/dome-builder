import { describe, expect, it } from 'vitest'
import { layoutDxfParts, orientDxfStrut, readableAngle, tagHoleLoops, writeDxf, type DxfPart } from './dxf'
import { createPartNameMaps, flangeNameKey } from './partNames'
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
  thickness: 10,
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
      return { name: p.name, minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY }
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
    expect(placed.map((p) => p.kind)).toEqual(['flange', 'strut', 'strut', 'brace'])
  })

  it('puts each label on its part', () => {
    const [first] = layoutDxfParts(parts, { scale: 1 })
    const b = bbox(first.loops)
    expect(first.label.x).toBeGreaterThan(b.minX)
    expect(first.label.x).toBeLessThan(b.maxX)
    expect(first.label.y).toBeGreaterThan(b.minY)
    expect(first.label.y).toBeLessThan(b.maxY)
  })

  it('uses a part-provided label anchor when present', () => {
    const [placed] = layoutDxfParts([{ ...part('anchored', 'flange', 20, 20, -10, -10), labelAnchor: { x: 0, y: 6 } }], { scale: 2 })
    const b = bbox(placed.loops)
    expect(placed.label.x).toBeCloseTo(b.minX + 20, 5)
    expect(placed.label.y).toBeCloseTo(b.minY + 32, 5)
  })

  it('drops parts with no geometry', () => {
    expect(layoutDxfParts([{ name: 'x', kind: 'strut', thickness: 10, loops: [] }], { scale: 1 })).toEqual([])
  })
})

describe('strut orientation before DXF layout', () => {
  const bowed: DxfPart = {
    name: '1', kind: 'strut', thickness: 10,
    loops: [{ closed: true, vertices: [
      { x: 0, y: 0, bulge: 0.25 },
      { x: 0, y: 10, bulge: 0 },
      { x: 3, y: 5, bulge: 0 },
    ] }],
    strutPath: { endA: [0, 0], endB: [0, 10], middle: [3, 5] },
    labelAnchor: { x: 3, y: 5 }, labelAngleDeg: 90,
    helpers: [{ text: '2', x: 0, y: 10, height: 2, angleDeg: 90 }],
  }

  it('puts both ends level and the center below, rotating annotations with the outline', () => {
    const result = orientDxfStrut(bowed)
    const [a, b, middle] = result.loops[0].vertices
    expect(a.y).toBeCloseTo(b.y)
    expect(middle.y).toBeLessThan(a.y)
    expect(result.labelAnchor?.x).toBeCloseTo(middle.x)
    expect(result.labelAnchor?.y).toBeCloseTo(middle.y)
    expect(result.labelAngleDeg).toBeCloseTo(0)
    expect(result.helpers![0].y).toBeCloseTo(b.y)
    expect(result.helpers![0].angleDeg).toBeCloseTo(0)
    expect(result.loops[0].vertices[0].bulge).toBe(0.25)
    expect(result.strutPath).toBeUndefined()
    const [placed] = layoutDxfParts([result], { scale: 1 })
    expect(placed.loops[0].vertices[0].y).toBeCloseTo(placed.loops[0].vertices[1].y)
  })

  it('uses a half-turn when the middle would otherwise be above the ends', () => {
    const result = orientDxfStrut({
      ...bowed,
      strutPath: { endA: [0, 0], endB: [0, 10], middle: [-3, 5] },
      loops: [{ closed: true, vertices: bowed.loops[0].vertices.map((vertex) => ({ ...vertex, x: -vertex.x })) }],
    })
    const [a, b, middle] = result.loops[0].vertices
    expect(a.y).toBeCloseTo(b.y)
    expect(middle.y).toBeLessThan(a.y)
    expect(result.loops[0].vertices[0].bulge).toBe(0.25)
  })

  it('leaves other part kinds alone', () => {
    const flange = { ...bowed, kind: 'flange' as const }
    expect(orientDxfStrut(flange)).toBe(flange)
  })
})

describe('arcs', () => {
  // A half-disc: the diameter on the x axis from (0,0) to (10,0), closed by a semicircle (bulge
  // magnitude 1 = 180 degrees) from (10,0) back to (0,0) that reaches 5 away from the axis.
  const halfDisc: DxfPart = {
    name: 'arc',
    kind: 'flange', thickness: 10,
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
    // The arc bulges 5 mm (10 scaled) below the axis - the axis vertices aren't its lowest point.
    expect(b.minY).toBeCloseTo(10, 3)
    expect(placed.loops[0].vertices[1].bulge).toBe(-1)
  })

  it('writes bulges as group 42', () => {
    expect(writeDxf(layoutDxfParts([halfDisc], { scale: 1 })).includes('\n42\n-1.000000\n')).toBe(true)
  })
})

describe('writeDxf', () => {
  it('writes a well-formed file with outlines and colored labels', () => {
    const text = writeDxf(layoutDxfParts([{ ...part('strut-7', 'strut', 10, 5), labelAngleDeg: 200 }], { scale: 1 }))
    const lines = text.split('\n')
    expect(lines.slice(0, 2)).toEqual(['0', 'SECTION'])
    expect(text.trimEnd().endsWith('EOF')).toBe(true)
    expect(text.split('\nPOLYLINE\n').length - 1).toBe(1)
    expect(text.split('\nVERTEX\n').length - 1).toBe(4)
    expect(text.includes('\nstrut-7\n')).toBe(true)
    expect(text.includes('\n72\n1\n')).toBe(true)
    expect(text.includes('\n73\n2\n')).toBe(true)
    expect(text.includes('\n50\n20.0000\n')).toBe(true)
    // Labels sit on their own layer, defined with a different color (red) than the outlines.
    expect(text.includes('LAYER\n2\nLABELS\n70\n0\n62\n1\n')).toBe(true)
    expect(text.includes('LAYER\n2\nSTRUTS\n70\n0\n62\n7\n')).toBe(true)
    // Every group is a code/value line pair.
    expect(lines.length % 2).toBe(1) // trailing newline leaves one empty element
  })
})

describe('hole layers', () => {
  // A two-vertex full circle, the way drawingToPolylines returns one.
  const circle = (cx: number, cy: number, r: number): DxfPolyline => ({
    closed: true,
    vertices: [{ x: cx + r, y: cy, bulge: 1 }, { x: cx - r, y: cy, bulge: 1 }],
  })
  const plate: DxfPart = {
    name: 'F1',
    kind: 'flange', thickness: 10,
    // The outer boundary is deliberately not first: replicad's loop order is not relied on.
    loops: tagHoleLoops(
      [circle(50, 50, 4), rect(100, 100), rect(20, 6, 60, 47), circle(30, 20, 3), circle(80, 80, 2)],
      [
        { kind: 'flange-center', center: [50, 50] },
        { kind: 'flange-rect', center: [70, 50] },
        { kind: 'flange-side', center: [30, 20] },
      ],
    ),
  }

  it('labels each hole by the mark at its middle, and leaves the rest alone', () => {
    expect(plate.loops.map((loop) => loop.hole)).toEqual(['flange-center', undefined, 'flange-rect', 'flange-side', undefined])
  })

  it('never labels the outer boundary, even with a mark at its middle', () => {
    const [outer] = tagHoleLoops([rect(100, 100)], [{ kind: 'flange-center', center: [50, 50] }])
    expect(outer.hole).toBeUndefined()
  })

  it('writes each hole on its own kind\'s layer and keeps the outline on the part\'s', () => {
    const text = writeDxf(layoutDxfParts([plate], { scale: 1 }))
    const layers = text.split('\n0\nPOLYLINE\n').slice(1).map((entity) => entity.match(/^8\n([^\n]+)/)![1])
    expect(layers).toEqual(['flange-center-holes', 'FLANGES', 'flange-rect-holes', 'flange-side-holes', 'FLANGES'])
    // Vertices sit on their polyline's layer, and every hole layer is declared in the table.
    expect(text.includes('VERTEX\n8\nflange-rect-holes\n')).toBe(true)
    const colors = ['flange-center-holes', 'flange-side-holes', 'flange-rect-holes', 'flange-foot-side-holes',
      'flange-foot-rect-holes', 'strut-brace-holes', 'foot-holes', 'brace-plate-corner-holes', 'brace-plate-center-holes']
      .map((name) => text.match(new RegExp(`LAYER\\n2\\n${name}\\n70\\n0\\n62\\n(\\d+)\\n`))?.[1])
    // Each hole layer has a color of its own, none shared with the outlines, labels, helpers or sheets.
    expect(colors.every((color) => color !== undefined && !['7', '1', '3', '5'].includes(color))).toBe(true)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('helper labels', () => {
  const withHelper: DxfPart = {
    ...part('flange-1 (x2)', 'flange', 60, 40, 100, -50),
    helpers: [{ text: 'S7', x: 130, y: -30, angleDeg: 200, height: 5 }],
  }

  it('moves and scales helpers along with their part', () => {
    const [placed] = layoutDxfParts([withHelper], { scale: 2 })
    const b = bbox(placed.loops)
    // (130, -30) is the part's center: 30 across and 20 up from its (100, -50) corner.
    expect(placed.helpers[0].x).toBeCloseTo(b.minX + 60, 5)
    expect(placed.helpers[0].y).toBeCloseTo(b.minY + 40, 5)
    expect(placed.helpers[0].height).toBe(10)
  })

  it('writes them green, centered, and right-side up', () => {
    const text = writeDxf(layoutDxfParts([withHelper], { scale: 1 }))
    expect(text.includes('LAYER\n2\nHELPERS\n70\n0\n62\n3\n')).toBe(true)
    const entity = text.split('\n0\nTEXT\n').find((t) => t.startsWith('8\nHELPERS'))!
    expect(entity.includes('\n1\nS7\n')).toBe(true)
    expect(entity.includes('\n50\n20.0000\n')).toBe(true) // 200 degrees is upside down -> 20
    expect(entity.includes('\n72\n1\n')).toBe(true)
    expect(entity.includes('\n73\n2\n')).toBe(true)
  })

  it('readableAngle keeps text within (-90, 90]', () => {
    expect(readableAngle(0)).toBe(0)
    expect(readableAngle(90)).toBe(90)
    expect(readableAngle(180)).toBeCloseTo(0)
    expect(readableAngle(-90)).toBe(90)
    expect(readableAngle(270)).toBe(90)
    expect(readableAngle(135)).toBeCloseTo(-45)
  })
})


describe('numeric part labels', () => {
  it('writes numeric part IDs and matching connection IDs even when kinds share a number', () => {
    const names = createPartNameMaps({
      struts: [{ id: 42, center: [1, 20, 0] }],
      flanges: [
        { vertexId: 7, side: 'outer', center: [1, 30, 0] },
        { vertexId: 7, side: 'inner', center: [1, 10, 0] },
      ],
      feet: [], bracePlates: [], braces: [],
    })
    const parts: DxfPart[] = [
      { ...part(names.struts[42], 'strut', 100, 30), helpers: [
        { text: names.flanges[flangeNameKey(7, 'outer')], x: 10, y: 10, angleDeg: 0, height: 5 },
        { text: names.flanges[flangeNameKey(7, 'inner')], x: 80, y: 10, angleDeg: 0, height: 5 },
      ] },
      ...(['outer', 'inner'] as const).map((side) => ({
        ...part(names.flanges[flangeNameKey(7, side)], 'flange', 30, 30),
        helpers: [{ text: names.struts[42], x: 10, y: 10, angleDeg: 0, height: 5 }],
      })),
    ]
    const dxf = writeDxf(layoutDxfParts(parts, { scale: 1 }))
    const labels = dxf.split('\n0\nTEXT\n').slice(1).map((entity) => ({
      layer: entity.match(/^8\n([^\n]+)/)![1],
      text: entity.match(/\n1\n([^\n]+)/)![1],
    }))
    expect(labels.filter((label) => label.layer === 'LABELS').map((label) => label.text).sort()).toEqual(['1', '1', '2'])
    expect(labels.filter((label) => label.layer === 'HELPERS').map((label) => label.text).sort()).toEqual(['1', '1', '1', '2'])
  })
})


describe('configurable label heights', () => {
  it('scales custom part and connection heights into the DXF text entities', () => {
    const placed = layoutDxfParts([{
      ...part('1', 'strut', 100, 40),
      helpers: [{ text: '2', x: 10, y: 10, angleDeg: 0, height: 7 }],
    }], { scale: 2, partIdLabelSize: 12 })
    expect(placed[0].label.height).toBe(24)
    expect(placed[0].helpers[0].height).toBe(14)
    const entities = writeDxf(placed).split('\n0\nTEXT\n').slice(1)
    expect(entities.find((entity) => entity.startsWith('8\nLABELS'))).toContain('\n40\n24.0000\n')
    expect(entities.find((entity) => entity.startsWith('8\nHELPERS'))).toContain('\n40\n14.0000\n')
  })
})
