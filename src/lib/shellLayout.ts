import * as THREE from 'three'
import type { SceneData } from './polyhedra'
import { assignNumericNames } from './partNames'

export interface ShellPanelPose { x: number; y: number; rotation: number }
export type ShellLayout = ReadonlyMap<number, ShellPanelPose>
export interface ShellPanel {
  faceId: number
  label: string
  vertices: number[]
  points: [number, number][]
  edges: (number | null)[]
}
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`

export function flattenShellPanels(data: Pick<SceneData, 'faces' | 'edges'>, vertices: ReadonlyMap<number, THREE.Vector3>): ShellPanel[] {
  const edgeIds = new Map([...data.edges].map(([id, [a, b]]) => [edgeKey(a, b), id]))
  const panels: Omit<ShellPanel, 'label'>[] = []
  for (const [faceId, face] of [...data.faces].sort(([a], [b]) => a - b)) {
    if (face.length !== 3 || face.some(id => !vertices.has(id))) continue
    const ids = [...face]
    let [a, b, c] = ids.map(id => vertices.get(id)!)
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    if (normal.dot(a.clone().add(b).add(c)) < 0) {
      ;[ids[1], ids[2]] = [ids[2], ids[1]]
      ;[b, c] = [c, b]
    }
    const axis = b.clone().sub(a)
    const length = axis.length()
    if (length < 1e-9) throw new Error(`Shell face ${faceId}: zero-length side`)
    axis.normalize()
    const ac = c.clone().sub(a)
    const x = ac.dot(axis)
    const height = ac.clone().addScaledVector(axis, -x).length()
    if (height < 1e-9) throw new Error(`Shell face ${faceId}: degenerate triangle`)
    const cx = (length + x) / 3, cy = -height / 3
    const points: [number, number][] = [[-cx, -cy], [length - cx, -cy], [x - cx, -height - cy]]
    panels.push({ faceId, vertices: ids, points, edges: ids.map((id, i) => edgeIds.get(edgeKey(id, ids[(i + 1) % 3])) ?? null) })
  }
  const names = assignNumericNames(panels.map(panel => ({
    id: panel.faceId,
    center: data.faces.get(panel.faceId)!.reduce((sum, id) => sum.add(vertices.get(id)!), new THREE.Vector3())
      .divideScalar(3).toArray(),
  })))
  return panels.map(panel => ({ ...panel, label: names[panel.faceId] }))
}

export function placePanelPoint(point: readonly [number, number], pose: ShellPanelPose): [number, number] {
  const angle = pose.rotation * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return [pose.x + point[0] * cos - point[1] * sin, pose.y + point[0] * sin + point[1] * cos]
}

export function resolveShellLayout(panels: ShellPanel[], saved: ShellLayout): Map<number, ShellPanelPose> {
  const result = new Map<number, ShellPanelPose>()
  for (const panel of panels) {
    const pose = saved.get(panel.faceId)
    if (pose) result.set(panel.faceId, pose)
  }
  const size = Math.max(1, ...panels.flatMap(p => {
    const xs = p.points.map(pt => pt[0]), ys = p.points.map(pt => pt[1])
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
  }))
  const cell = size * 1.25
  const missing = panels.filter(p => !result.has(p.faceId))
  const columns = Math.max(1, Math.ceil(Math.sqrt(missing.length)))
  let startX = 0
  for (const panel of panels) {
    const pose = result.get(panel.faceId)
    if (pose) for (const point of panel.points) startX = Math.max(startX, placePanelPoint(point, pose)[0] + cell)
  }
  missing.forEach((panel, i) => result.set(panel.faceId, { x: startX + (i % columns) * cell, y: Math.floor(i / columns) * cell, rotation: 0 }))
  return result
}

export function shellPanelConnections(panels: ShellPanel[]) {
  const edges = new Map<number, { faceId: number; midpoint: [number, number] }[]>()
  for (const panel of panels) panel.edges.forEach((id, i) => {
    if (id === null) return
    const a = panel.points[i], b = panel.points[(i + 1) % 3]
    const refs = edges.get(id) ?? []
    refs.push({ faceId: panel.faceId, midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] })
    edges.set(id, refs)
  })
  return [...edges].filter(([, refs]) => refs.length === 2).map(([edgeId, refs]) => ({ edgeId, a: refs[0], b: refs[1] }))
}

/** Connected panels form a rigid assembly, even when a seam is part of a cycle. */
export function shellPanelGroup(panels: ShellPanel[], stitches: ReadonlySet<number>, faceId: number): Set<number> {
  const group = new Set([faceId])
  const connections = shellPanelConnections(panels).filter(c => stitches.has(c.edgeId))
  for (const id of group) for (const { a, b } of connections) {
    if (a.faceId === id) group.add(b.faceId)
    if (b.faceId === id) group.add(a.faceId)
  }
  return group
}

export function transformShellGroup(layout: ShellLayout, group: ReadonlySet<number>, from: ShellPanelPose, to: ShellPanelPose): Map<number, ShellPanelPose> {
  const next = new Map(layout)
  for (const id of group) {
    const pose = layout.get(id)!
    const [x, y] = placePanelPoint([pose.x - from.x, pose.y - from.y], { ...to, rotation: to.rotation - from.rotation })
    next.set(id, { x, y, rotation: pose.rotation + to.rotation - from.rotation })
  }
  return next
}

export function toggleShellStitch(panels: ShellPanel[], layout: ShellLayout, stitches: ReadonlySet<number>, edgeId: number, fixedFaceId: number) {
  const nextStitches = new Set(stitches)
  if (nextStitches.delete(edgeId)) return { layout: new Map(layout), stitches: nextStitches }
  const connection = shellPanelConnections(panels).find(c => c.edgeId === edgeId && [c.a.faceId, c.b.faceId].includes(fixedFaceId))
  if (!connection) throw new Error('This edge has no matching panel.')
  const movingId = connection.a.faceId === fixedFaceId ? connection.b.faceId : connection.a.faceId
  const fixed = panels.find(p => p.faceId === fixedFaceId)!, moving = panels.find(p => p.faceId === movingId)!
  const edgeIndex = fixed.edges.indexOf(edgeId)
  const ids = [fixed.vertices[edgeIndex], fixed.vertices[(edgeIndex + 1) % 3]]
  const target = ids.map(id => placePanelPoint(fixed.points[fixed.vertices.indexOf(id)], layout.get(fixedFaceId)!))
  const source = ids.map(id => moving.points[moving.vertices.indexOf(id)])
  const rotation = (Math.atan2(target[1][1] - target[0][1], target[1][0] - target[0][0]) -
    Math.atan2(source[1][1] - source[0][1], source[1][0] - source[0][0])) * 180 / Math.PI
  const offset = placePanelPoint(source[0], { x: 0, y: 0, rotation })
  const aligned = { x: target[0][0] - offset[0], y: target[0][1] - offset[1], rotation }
  const group = shellPanelGroup(panels, stitches, movingId)
  if (group.has(fixedFaceId)) {
    const tolerance = Math.max(1, Math.hypot(target[1][0] - target[0][0], target[1][1] - target[0][1])) * 1e-7
    if (source.some((point, i) => {
      const actual = placePanelPoint(point, layout.get(movingId)!)
      return Math.hypot(actual[0] - target[i][0], actual[1] - target[i][1]) > tolerance
    })) throw new Error('These panels already belong to the same assembly. Decouple a seam before joining these edges.')
  }
  nextStitches.add(edgeId)
  return { layout: group.has(fixedFaceId) ? new Map(layout) : transformShellGroup(layout, group, layout.get(movingId)!, aligned), stitches: nextStitches }
}
