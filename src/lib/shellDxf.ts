import type { DxfPart } from './dxf'
import type { DxfLabelSettings } from './dxfLabelSettings'
import { placePanelPoint, resolveShellLayout, shellPanelGroup, type ShellPanel, type ShellLayout } from './shellLayout'

/** Labels sit along the edge, inset toward the triangle interior. */
export function shellEdgeLabels(panel: ShellPanel, strutNames: Readonly<Record<number, string>>, requestedHeight: number) {
  return panel.edges.flatMap((edgeId, i) => {
    const text = edgeId === null ? undefined : strutNames[edgeId]
    if (!text) return []
    const a = panel.points[i], b = panel.points[(i + 1) % 3], c = panel.points[(i + 2) % 3]
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    const side = Math.sign(dx * (c[1] - a[1]) - dy * (c[0] - a[0]))
    const nx = -dy / length * side, ny = dx / length * side
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const centroid = panel.points.reduce((sum, p) => [sum[0] + p[0] / 3, sum[1] + p[1] / 3], [0, 0])
    const distance = (centroid[0] - midpoint[0]) * nx + (centroid[1] - midpoint[1]) * ny
    const fraction = Math.min(0.6, requestedHeight * 1.4 / distance)
    const x = midpoint[0] + (centroid[0] - midpoint[0]) * fraction
    const y = midpoint[1] + (centroid[1] - midpoint[1]) * fraction
    // Bound the complete text rectangle by all three sides, including obtuse triangles.
    let height = requestedHeight
    for (let j = 0; j < 3; j++) {
      const p = panel.points[j], q = panel.points[(j + 1) % 3]
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      const ex = -(q[1] - p[1]) / len * side, ey = (q[0] - p[0]) / len * side
      const clearance = (x - p[0]) * ex + (y - p[1]) * ey
      const extent = 0.45 * text.length * Math.abs(dx / length * ex + dy / length * ey) + 0.6 * Math.abs(nx * ex + ny * ey)
      if (extent > 0) height = Math.min(height, clearance / extent * 0.85)
    }
    return [{ text, x, y, height, angleDeg: Math.atan2(dy, dx) * 180 / Math.PI }]

  })
}

/** A stitched assembly is a single packing unit, so nesting cannot separate its panels. */
export function shellDxfParts(panels: ShellPanel[], saved: ShellLayout, stitches: ReadonlySet<number>, strutNames: Readonly<Record<number, string>>, thickness: number, labels: DxfLabelSettings): DxfPart[] {
  const poses = resolveShellLayout(panels, saved), seen = new Set<number>(), parts: DxfPart[] = []
  for (const root of [...panels].sort((a, b) => parseInt(a.label) - parseInt(b.label))) {
    if (seen.has(root.faceId)) continue
    const group = shellPanelGroup(panels, stitches, root.faceId)
    const members = panels.filter(p => group.has(p.faceId))
    members.forEach(p => seen.add(p.faceId))
    // SVG coordinates have Y down; reflect into DXF's Y-up frame without mirroring the fabric.
    const point = (p: readonly [number, number], id: number) => {
      const [x, y] = placePanelPoint(p, poses.get(id)!)
      return { x, y: -y }
    }
    const rootPose = poses.get(root.faceId)!
    parts.push({ name: root.label, kind: 'shell', thickness,
      labelAnchor: { x: rootPose.x, y: -rootPose.y }, labelAngleDeg: -rootPose.rotation,
      loops: members.map(panel => ({ closed: true, vertices: panel.points.map(p => ({ ...point(p, panel.faceId), bulge: 0 })) })),
      helpers: members.flatMap(panel => {
        const pose = poses.get(panel.faceId)!
        return [
          ...(panel.faceId === root.faceId ? [] : [{ text: panel.label, x: pose.x, y: -pose.y, height: labels.partIdLabelSize, angleDeg: -pose.rotation, isPartLabel: true }]),
          ...shellEdgeLabels(panel, strutNames, labels.connectedPartIdLabelSize).map(label => ({ ...label,
            ...point([label.x, label.y], panel.faceId), angleDeg: -(label.angleDeg + pose.rotation) })),
        ]
      }),
    })
  }
  return parts
}
