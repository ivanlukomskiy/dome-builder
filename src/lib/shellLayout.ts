import * as THREE from 'three'
import type { SceneData } from './polyhedra'

export interface ShellPanelPose { x: number; y: number; rotation: number }
export type ShellLayout = ReadonlyMap<number, ShellPanelPose>
export interface ShellPanel {
  faceId: number
  points: [number, number][]
  edges: (number | null)[]
}
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`

export function flattenShellPanels(data: Pick<SceneData, 'faces' | 'edges'>, vertices: ReadonlyMap<number, THREE.Vector3>): ShellPanel[] {
  const edgeIds = new Map([...data.edges].map(([id, [a, b]]) => [edgeKey(a, b), id]))
  const panels: ShellPanel[] = []
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
    panels.push({ faceId, points, edges: ids.map((id, i) => edgeIds.get(edgeKey(id, ids[(i + 1) % 3])) ?? null) })
  }
  return panels
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
