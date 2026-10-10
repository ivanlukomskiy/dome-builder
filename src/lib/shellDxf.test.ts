import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { flattenShellPanels, resolveShellLayout, toggleShellStitch } from './shellLayout'
import { shellDxfParts, shellEdgeLabels } from './shellDxf'
import { layoutDxfParts, writeDxf } from './dxf'
import { DEFAULT_DXF_LABEL_SETTINGS } from './dxfLabelSettings'
import { packingEnvelope } from './dxfNesting'

const data = { faces: new Map([[7, [0, 1, 2]], [11, [1, 3, 2]]]),
  edges: new Map<number, [number, number]>([[10, [0, 1]], [20, [1, 2]], [30, [2, 0]], [40, [1, 3]], [50, [3, 2]]]) }
const vertices = new Map([[0, new THREE.Vector3(0, 0, 10)], [1, new THREE.Vector3(40, 0, 10)], [2, new THREE.Vector3(0, 30, 10)], [3, new THREE.Vector3(40, 30, 12)]])
const panels = flattenShellPanels(data, vertices)
const names = { 10: '5', 20: '6.', 30: '7', 40: '8', 50: '9.' }
const poses = resolveShellLayout(panels, new Map([[7, { x: 100, y: -150, rotation: 37 }]]))

describe('shell DXF', () => {
  it('exports individual panels when decoupled and one rigid packing unit when stitched', () => {
    expect(shellDxfParts(panels, poses, new Set(), names, 0, DEFAULT_DXF_LABEL_SETTINGS)).toHaveLength(2)
    const joined = toggleShellStitch(panels, poses, new Set(), 20, 7)
    const parts = shellDxfParts(panels, joined.layout, joined.stitches, names, 2, DEFAULT_DXF_LABEL_SETTINGS)
    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('shell')
    expect(parts[0].thickness).toBe(2)
    expect(parts[0].loops).toHaveLength(2)
    expect(packingEnvelope(parts[0].loops, 1).length).toBeGreaterThanOrEqual(3)
    const placed = layoutDxfParts(parts, { scale: 2 })[0]
    for (const id of [1, 2]) {
      const points = panels.map((p, i) => placed.loops[i].vertices[p.vertices.indexOf(id)])
      expect(points[0].x).toBeCloseTo(points[1].x, 10)
      expect(points[0].y).toBeCloseTo(points[1].y, 10)
    }
    expect(parts[0].helpers!.filter(h => !h.isPartLabel).map(h => h.text).sort()).toEqual(['5', '6.', '6.', '7', '8', '9.'])
    const dxf = writeDxf([placed])
    expect(dxf).toContain('\nSHELL\n')
    expect(dxf).toContain('\n6.\n')
    expect(parts[0].helpers!.filter(h => h.isPartLabel).map(h => h.text)).toEqual([panels.find(p => p.label !== parts[0].name)!.label])
  })
  it('places edge labels inside each triangle, parallel to its edge, using export strut IDs', () => {
    for (const panel of panels) {
      const labels = shellEdgeLabels(panel, names, 5)
      expect(labels).toHaveLength(3)
      labels.forEach((label, i) => {
        expect(label.text).toBe(names[panel.edges[i]! as keyof typeof names])
        expect(label.height).toBeGreaterThan(0)
        const a = panel.points[i], b = panel.points[(i + 1) % 3]
        expect(label.angleDeg).toBeCloseTo(Math.atan2(b[1]-a[1], b[0]-a[0]) * 180 / Math.PI)
        const crosses = panel.points.map((p, j) => {
          const q = panel.points[(j + 1) % 3]
          return (q[0]-p[0])*(label.y-p[1])-(q[1]-p[1])*(label.x-p[0])
        })
        expect(crosses.every(v => v > 0) || crosses.every(v => v < 0)).toBe(true)
      })
    }
  })
  it('skips edges without a strut and handles empty shells', () => {
    expect(shellEdgeLabels(panels[0], {}, 5)).toEqual([])
    expect(shellDxfParts([], new Map(), new Set(), names, 2, DEFAULT_DXF_LABEL_SETTINGS)).toEqual([])
  })
})
