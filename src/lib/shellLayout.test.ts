import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { flattenShellPanels, placePanelPoint, resolveShellLayout, shellPanelConnections } from './shellLayout'
import { initialHistory, commitHistory, undoHistory, redoHistory } from './useHistory'

const data = {
  faces: new Map([[7, [0, 1, 2]], [11, [1, 3, 2]]]),
  edges: new Map<number, [number, number]>([[10, [0, 1]], [20, [1, 2]], [30, [2, 0]], [40, [1, 3]], [50, [3, 2]]]),
}
const vertices = new Map([
  [0, new THREE.Vector3(0, 0, 10)], [1, new THREE.Vector3(4, 0, 10)],
  [2, new THREE.Vector3(0, 3, 10)], [3, new THREE.Vector3(4, 3, 12)],
])

describe('shell fabric layout', () => {
  it('labels panels top to bottom and clockwise within each elevation using export conventions', () => {
    const centers: [number, number, number][] = [
      [1, 200, 0], [0, 100, 1], [-1, 100, 0], [0, 100, -1], [1, 100, 0],
      [0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0],
    ]
    const points = new Map<number, THREE.Vector3>()
    const faces = new Map<number, number[]>()
    centers.forEach((center, i) => {
      const ids = [i * 3, i * 3 + 1, i * 3 + 2]
      const offsets = [[-0.1, -0.1, 0], [0.1, -0.1, 0], [0, 0.2, 0]] as const
      ids.forEach((id, j) => points.set(id, new THREE.Vector3(...center).add(new THREE.Vector3(...offsets[j]))))
      faces.set(100 + i, ids)
    })
    const panels = flattenShellPanels({ faces, edges: new Map() }, points)
    const labels = new Map(panels.map(panel => [panel.faceId, panel.label]))
    expect([100, 104, 103, 102, 101, 108, 107, 106, 105].map(id => labels.get(id)))
      .toEqual(['1', '2', '3', '4', '5', '6.', '7', '8', '9.'])
  })

  it('keeps saved layouts keyed by face IDs when geometry changes the labels', () => {
    const saved = new Map([[7, { x: 300, y: -100, rotation: 45 }], [11, { x: 700, y: 400, rotation: -30 }]])
    const before = flattenShellPanels(data, vertices)
    expect(before.find(p => p.faceId === 11)!.label).toBe('1')
    const changed = new Map(vertices)
    changed.set(0, vertices.get(0)!.clone().add(new THREE.Vector3(0, 100, 0)))
    const after = flattenShellPanels(data, changed)
    expect(after.find(p => p.faceId === 7)!.label).toBe('1')
    expect(resolveShellLayout(before, saved)).toEqual(saved)
    expect(resolveShellLayout(after, saved)).toEqual(saved)
  })

  it('flattens each face without changing side lengths and centers the panels', () => {
    const panels = flattenShellPanels(data, vertices)
    expect(panels.map(p => p.faceId)).toEqual([7, 11])
    for (const panel of panels) {
      const face = data.faces.get(panel.faceId)!
      const originalLengths = face.map((id, i) => vertices.get(id)!.distanceTo(vertices.get(face[(i + 1) % 3])!)).sort((a,b) => a-b)
      const flatLengths = panel.points.map((point, i) => {
        const next = panel.points[(i + 1) % 3]
        return Math.hypot(next[0] - point[0], next[1] - point[1])
      }).sort((a,b) => a-b)
      originalLengths.forEach((length, i) => expect(flatLengths[i]).toBeCloseTo(length, 10))
      expect(panel.points.reduce((sum, p) => sum + p[0], 0)).toBeCloseTo(0)
      expect(panel.points.reduce((sum, p) => sum + p[1], 0)).toBeCloseTo(0)
    }
  })

  it('connects only the two sides belonging to the same dome edge', () => {
    const panels = flattenShellPanels(data, vertices)
    const connections = shellPanelConnections(panels)
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ edgeId: 20, a: { faceId: 7 }, b: { faceId: 11 } })
    const pose = { x: 100, y: 200, rotation: 90 }
    const midpoint = connections[0].a.midpoint
    expect(placePanelPoint(midpoint, pose)[0]).toBeCloseTo(100 - midpoint[1])
    expect(placePanelPoint(midpoint, pose)[1]).toBeCloseTo(200 + midpoint[0])
  })

  it('retains saved positions and puts new panels beyond existing panels', () => {
    const panels = flattenShellPanels(data, vertices)
    const pose = { x: 1000, y: -500, rotation: 37.5 }
    const resolved = resolveShellLayout(panels, new Map([[7, pose], [99, pose]]))
    expect(resolved.get(7)).toEqual(pose)
    expect(resolved.has(99)).toBe(false)
    expect(resolved.get(11)!.x).toBeGreaterThan(1000)
    expect(resolveShellLayout(panels, resolved)).toEqual(resolved)
  })

  it('restores a complete move and rotation through document history', () => {
    const layout = resolveShellLayout(flattenShellPanels(data, vertices), new Map())
    const initial = initialHistory({ shellLayout: layout })
    const moved = new Map(layout)
    moved.set(7, { x: 200, y: -300, rotation: 15 })
    const committed = commitHistory(initial, { shellLayout: moved }, 50)
    expect(committed.past).toHaveLength(1)
    const undone = undoHistory(committed)
    expect(undone.present.shellLayout).toEqual(layout)
    expect(redoHistory(undone).present.shellLayout.get(7)).toEqual({ x: 200, y: -300, rotation: 15 })
  })

  it('ignores non-triangular faces and missing shell vertices', () => {
    expect(flattenShellPanels({ ...data, faces: new Map([[7, [0, 1, 2, 3]]]) }, vertices)).toEqual([])
    expect(flattenShellPanels(data, new Map())).toEqual([])
  })
})
