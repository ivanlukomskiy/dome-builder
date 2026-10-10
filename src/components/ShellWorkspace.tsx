import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { computePreviewBuildInputs, type PreviewBuildInputParams } from '../lib/previewBuildInputs'
import { flattenShellPanels, placePanelPoint, resolveShellLayout, shellPanelConnections, shellPanelGroup, transformShellGroup, toggleShellStitch, type ShellLayout, type ShellPanelPose } from '../lib/shellLayout'
import { useI18n } from '../lib/i18n'

interface Frame { x: number; y: number; width: number; height: number }
interface Gesture {
  pointerId: number
  kind: 'move' | 'rotate' | 'pan'
  start: [number, number]
  clientStart: [number, number]
  frame: Frame
  faceId?: number
  initial?: ShellPanelPose
  pose?: ShellPanelPose
  layout: ShellLayout
  group: ReadonlySet<number>
}

export function ShellWorkspace({ params, layout, stitches, onLayoutChange, previewParamsDirty, onApplyPreview, onEndHistoryGroup }: {
  params: PreviewBuildInputParams
  layout: ShellLayout
  stitches: ReadonlySet<number>
  onLayoutChange: (layout: ShellLayout, stitches: ReadonlySet<number>) => void
  previewParamsDirty: boolean
  onApplyPreview: () => void
  onEndHistoryGroup: () => void
}) {
  const { t } = useI18n()
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<ShellLayout | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null)
  const [stitchError, setStitchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [view, setView] = useState<Frame | null>(null)
  const [size, setSize] = useState({ width: 1000, height: 800 })
  const computed = useMemo(() => {
    if (!params.shellEnabled || params.roundStrutBridge) return { panels: [], error: null }
    try {
      const { shellVertices } = computePreviewBuildInputs(params)
      return { panels: flattenShellPanels(params.data, shellVertices), error: null }
    } catch (error) {
      return { panels: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [params])
  const { panels, error } = computed
  const labels = new Map(panels.map(panel => [panel.faceId, panel.label]))
  const resolved = useMemo(() => resolveShellLayout(panels, layout), [panels, layout])
  const poses = draft ?? resolved
  const connections = useMemo(() => shellPanelConnections(panels), [panels])
  const fit = useMemo(() => {
    const points = panels.flatMap(p => p.points.map(pt => placePanelPoint(pt, resolved.get(p.faceId)!)))
    if (!points.length) return { x: -500, y: -400, width: 1000, height: 800 }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    const aspect = size.width / size.height
    const height = Math.max(maxY - minY, (maxX - minX) / aspect, 10) * 1.2
    const width = height * aspect
    return { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height }
  }, [panels, resolved, size])
  const frame = view ?? fit
  const selectedPanel = panels.find(p => p.faceId === selected)
  const selectedPose = selected === null ? undefined : poses.get(selected)
  const labelSize = frame.height / size.height * 14

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const worldPoint = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!
    const point = svg.createSVGPoint()
    point.x = clientX; point.y = clientY
    const matrix = svg.getScreenCTM()
    const world = matrix ? point.matrixTransform(matrix.inverse()) : point
    return [world.x, world.y]
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      if (gesture.current) return
      const point = svg.createSVGPoint()
      point.x = e.clientX; point.y = e.clientY
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const anchor = point.matrixTransform(matrix.inverse())
      const factor = Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.001)))
      const width = Math.max(fit.width / 100, Math.min(fit.width * 100, frame.width * factor))
      const height = frame.height * width / frame.width
      setView({ x: anchor.x - (anchor.x - frame.x) * width / frame.width,
        y: anchor.y - (anchor.y - frame.y) * height / frame.height, width, height })
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [frame, fit.width])

  const begin = (e: ReactPointerEvent, kind: Gesture['kind'], faceId?: number) => {
    if (e.button !== 0 || gesture.current) return
    e.stopPropagation()
    onEndHistoryGroup()
    svgRef.current!.focus()
    const initial = faceId === undefined ? undefined : poses.get(faceId)
    gesture.current = { pointerId: e.pointerId, kind, faceId, start: worldPoint(e.clientX, e.clientY), clientStart: [e.clientX, e.clientY], frame, initial, pose: initial, layout: poses, group: faceId === undefined ? new Set<number>() : shellPanelGroup(panels, stitches, faceId) }
    setView(frame)
    setSelected(faceId ?? null)
    svgRef.current!.setPointerCapture(e.pointerId)
  }
  const move = (e: ReactPointerEvent) => {
    const active = gesture.current
    if (!active || active.pointerId !== e.pointerId) return
    if (active.kind === 'pan') {
      const rect = svgRef.current!.getBoundingClientRect()
      const ratio = Math.min(rect.width / active.frame.width, rect.height / active.frame.height)
      if (ratio > 0) setView({ ...active.frame,
        x: active.frame.x - (e.clientX - active.clientStart[0]) / ratio,
        y: active.frame.y - (e.clientY - active.clientStart[1]) / ratio })
      return
    }
    const [x, y] = worldPoint(e.clientX, e.clientY)
    const initial = active.initial!
    let pose: ShellPanelPose
    if (active.kind === 'move') pose = { ...initial, x: initial.x + x - active.start[0], y: initial.y + y - active.start[1] }
    else {
      const startAngle = Math.atan2(active.start[1] - initial.y, active.start[0] - initial.x)
      const angle = Math.atan2(y - initial.y, x - initial.x)
      const rotation = initial.rotation + (angle - startAngle) * 180 / Math.PI
      pose = { ...initial, rotation: e.shiftKey ? Math.round(rotation / 15) * 15 : rotation }
    }
    active.pose = pose
    setDraft(transformShellGroup(active.layout, active.group, initial, pose))
  }
  const finish = (e: ReactPointerEvent, commit: boolean) => {
    const active = gesture.current
    if (!active || active.pointerId !== e.pointerId) return
    gesture.current = null
    if (commit && active.faceId !== undefined && active.pose && active.initial &&
      (Math.abs(active.pose.x - active.initial.x) > 1e-6 || Math.abs(active.pose.y - active.initial.y) > 1e-6 || Math.abs(active.pose.rotation - active.initial.rotation) > 1e-6)) {
      onLayoutChange(transformShellGroup(active.layout, active.group, active.initial, active.pose), stitches)
    }
    setDraft(null)
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
  }
  const toggleStitch = (edgeId: number, faceId: number) => {
    if (gesture.current) return
    onEndHistoryGroup()
    setView(frame)
    try {
      const next = toggleShellStitch(panels, resolved, stitches, edgeId, faceId)
      onLayoutChange(next.layout, next.stitches)
      setSelected(faceId)
      setStitchError(null)
    } catch (error) {
      setStitchError(error instanceof Error ? error.message : String(error))
    }
  }
  const sharedEdges = new Set(connections.map(c => c.edgeId))
  const selectedGroup = selected === null ? new Set<number>() : shellPanelGroup(panels, stitches, selected)
  return (
    <div className="viewport shell-workspace">
      <div className="viewport-actions">
        <button className="viewport-action viewport-action-primary" type="button" onClick={() => setView(null)}>{t('Fit panels')}</button>
        {previewParamsDirty && <button className="viewport-action viewport-action-primary" type="button" onClick={onApplyPreview}>{t('Redraw')}</button>}
      </div>
      <svg ref={svgRef} tabIndex={0} className="shell-canvas" aria-label={t('Shell panel arrangement')} viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        onPointerDown={e => begin(e, 'pan')} onPointerMove={move} onPointerUp={e => finish(e, true)}
        onPointerCancel={e => finish(e, false)} onLostPointerCapture={e => finish(e, false)}>
        <g pointerEvents="none" className="shell-connections">
          {connections.filter(c => !stitches.has(c.edgeId)).map(({ edgeId, a, b }) => {
            const p = placePanelPoint(a.midpoint, poses.get(a.faceId)!), q = placePanelPoint(b.midpoint, poses.get(b.faceId)!)
            return <line key={edgeId} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} vectorEffect="non-scaling-stroke"><title>{t('Edge')} {edgeId}: {labels.get(a.faceId)} ↔ {labels.get(b.faceId)}</title></line>
          })}
        </g>
        {panels.map(panel => {
          const pose = poses.get(panel.faceId)!
          return <g key={panel.faceId} transform={`translate(${pose.x} ${pose.y}) rotate(${pose.rotation})`} onPointerDown={e => begin(e, 'move', panel.faceId)} className="shell-panel">
            <polygon points={panel.points.map(p => p.join(',')).join(' ')} className={selectedGroup.has(panel.faceId) ? 'selected' : ''} vectorEffect="non-scaling-stroke" />
            {panel.edges.map((edgeId, i) => {
              const a = panel.points[i], b = panel.points[(i + 1) % 3]
              const shared = edgeId !== null && sharedEdges.has(edgeId)
              const coupled = shared && stitches.has(edgeId!)
              const action = coupled ? t('Decouple seam') : t('Stitch matching panel')
              return <g key={i}>
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={shared ? coupled ? '#4ade80' : '#60a5fa' : '#fb923c'}
                  strokeWidth={shared && hoveredEdge === edgeId ? 4 : 2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {shared && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={14}
                  vectorEffect="non-scaling-stroke" pointerEvents="stroke" className="shell-seam" role="button" tabIndex={0}
                  aria-label={`${action}: ${t('Edge')} ${edgeId}`} aria-pressed={coupled}
                  onPointerEnter={() => setHoveredEdge(edgeId)} onPointerLeave={() => setHoveredEdge(null)}
                  onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleStitch(edgeId!, panel.faceId) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleStitch(edgeId!, panel.faceId) } }}>
                  <title>{action}</title>
                </line>}
              </g>
            })}
            <text textAnchor="middle" dominantBaseline="central" fontSize={labelSize} pointerEvents="none">{panel.label}</text>
            <title>{t('Panel')} {panel.label} ({t('Face')} {panel.faceId})</title>
          </g>
        })}
        {selectedPanel && selectedPose && (() => {
          const handleY = Math.min(...selectedPanel.points.map(p => p[1])) - labelSize * 2.5
          const handle = placePanelPoint([0, handleY], selectedPose)
          return <g>
            <line x1={selectedPose.x} y1={selectedPose.y} x2={handle[0]} y2={handle[1]} stroke="#facc15" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={handle[0]} cy={handle[1]} r={labelSize * 0.6} fill="#facc15" stroke="#12141a" vectorEffect="non-scaling-stroke" className="shell-rotate-handle"
              aria-label={t('Rotate panel')} onPointerDown={e => begin(e, 'rotate', selected!)}><title>{t('Rotate panel')} · {t('Hold Shift to snap to 15°')}</title></circle>
          </g>
        })()}
      </svg>
      {stitchError && <div className="shell-stitch-error" role="status" onClick={() => setStitchError(null)}>{t(stitchError)}</div>}
      {(!params.shellEnabled || params.roundStrutBridge || error || !panels.length) && <div className="shell-message" role="status">
        {error ?? (params.roundStrutBridge ? t('Disable Round bridge to generate the shell.') : !params.shellEnabled ? t('Enable Shell in Dome geometry to arrange panels.') : t('No triangular shell faces to arrange.'))}
      </div>}
    </div>
  )
}
