import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { flattenShellPanels, placePanelPoint, resolveShellLayout, shellPanelConnections, shellPanelGroup, transformShellGroup, toggleShellStitch } from './shellLayout'
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


describe('shell stitching', () => {
  const panels = flattenShellPanels(data, vertices)
  const layout = resolveShellLayout(panels, new Map([[7, { x: 30, y: 50, rotation: 37 }]]))
  it('aligns corresponding vertices and keeps panels on opposite sides of the seam', () => {
    const joined = toggleShellStitch(panels, layout, new Set(), 20, 7)
    expect(joined.layout.get(7)).toEqual(layout.get(7))
    const a = panels[0], b = panels[1]
    for (const id of [1, 2]) {
      const p = placePanelPoint(a.points[a.vertices.indexOf(id)], joined.layout.get(7)!)
      const q = placePanelPoint(b.points[b.vertices.indexOf(id)], joined.layout.get(11)!)
      expect(p[0]).toBeCloseTo(q[0], 10)
      expect(p[1]).toBeCloseTo(q[1], 10)
    }
    const p = placePanelPoint(a.points[a.vertices.indexOf(1)], joined.layout.get(7)!)
    const q = placePanelPoint(a.points[a.vertices.indexOf(2)], joined.layout.get(7)!)
    const side = (id: number) => { const pose = joined.layout.get(id)!; return (q[0]-p[0])*(pose.y-p[1])-(q[1]-p[1])*(pose.x-p[0]) }
    expect(side(7) * side(11)).toBeLessThan(0)
  })
  it('moves and rotates the entire assembly, then splits it without moving panels', () => {
    const joined = toggleShellStitch(panels, layout, new Set(), 20, 11)
    const group = shellPanelGroup(panels, joined.stitches, 7)
    expect(group).toEqual(new Set([7, 11]))
    const from = joined.layout.get(7)!, to = { x: -150, y: 200, rotation: from.rotation + 90 }
    const moved = transformShellGroup(joined.layout, group, from, to)
    const distance = (poses: typeof moved) => Math.hypot(poses.get(7)!.x-poses.get(11)!.x, poses.get(7)!.y-poses.get(11)!.y)
    expect(distance(moved)).toBeCloseTo(distance(joined.layout), 10)
    expect(moved.get(11)!.rotation).toBeCloseTo(joined.layout.get(11)!.rotation + 90)
    const split = toggleShellStitch(panels, moved, joined.stitches, 20, 7)
    expect(split.layout).toEqual(moved)
    expect(shellPanelGroup(panels, split.stitches, 7)).toEqual(new Set([7]))
  })
  it('undoes and redoes stitching and alignment as a single operation', () => {
    const original = { layout, stitches: new Set<number>() }
    const joined = toggleShellStitch(panels, layout, original.stitches, 20, 7)
    const history = commitHistory(initialHistory(original), joined, 50)
    expect(undoHistory(history).present).toEqual(original)
    expect(redoHistory(undoHistory(history)).present).toEqual(joined)
  })
  it('attaches an existing assembly rigidly and rejects a curved loop that cannot close flat', () => {
    const mesh = { faces: new Map([...data.faces, [12, [0, 2, 3]]]), edges: new Map([...data.edges, [60, [3, 0] as [number, number]]]) }
    const three = flattenShellPanels(mesh, vertices)
    const initial = resolveShellLayout(three, new Map())
    const pair = toggleShellStitch(three, initial, new Set(), 20, 7)
    // Clicking the third panel brings both previously stitched panels to it.
    const joined = toggleShellStitch(three, pair.layout, pair.stitches, 50, 12)
    expect(joined.layout.get(12)).toEqual(initial.get(12))
    expect(shellPanelGroup(three, joined.stitches, 12)).toEqual(new Set([12, 11, 7]))
    const distance = (poses: typeof initial) => Math.hypot(poses.get(7)!.x-poses.get(11)!.x, poses.get(7)!.y-poses.get(11)!.y)
    expect(distance(joined.layout)).toBeCloseTo(distance(pair.layout), 10)
    expect(() => toggleShellStitch(three, joined.layout, joined.stitches, 30, 7)).toThrow('same assembly')
    const split = toggleShellStitch(three, joined.layout, joined.stitches, 20, 7)
    expect(shellPanelGroup(three, split.stitches, 7)).toEqual(new Set([7]))
    expect(shellPanelGroup(three, split.stitches, 11)).toEqual(new Set([11, 12]))
  })

  it('rejects orphan edges', () => {
    expect(() => toggleShellStitch(panels, layout, new Set(), 10, 7)).toThrow('no matching panel')
  })
})
