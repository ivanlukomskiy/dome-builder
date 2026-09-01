import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { SketchPath, Vec2 } from '../lib/strutGeometry'

const DEG2RAD = Math.PI / 180

const BOUNDARY_COLOR = '#5b9bd5'
const CENTERLINE_COLOR = '#f5a623'
const ARC_COLOR = '#2dd4bf'
const OFFSET_LINE_COLOR = '#e0729f'
const REFERENCE_CIRCLE_COLOR = '#5c6270'
const CENTER_MARKER_COLOR = '#f5e050'
const VERTEX_MARKER_COLOR = '#4fd97e'

function rotate2(p: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]
}

function normalizeAngle(a: number): number {
  let x = a
  while (x <= -Math.PI) x += 2 * Math.PI
  while (x > Math.PI) x -= 2 * Math.PI
  return x
}

// The center of the circle passing through all three points (standard circumcenter formula).
// Every arc in this sketch construction - the wide bridge/boundary arcs (centered on the gravity
// center) and the small tooth-corner fillets (centered wherever they need to be) alike - is a
// true circular arc, so this always recovers the right center regardless of which kind it is.
function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  const aSq = a[0] * a[0] + a[1] * a[1]
  const bSq = b[0] * b[0] + b[1] * b[1]
  const cSq = c[0] * c[0] + c[1] * c[1]
  const ux = (aSq * (b[1] - c[1]) + bSq * (c[1] - a[1]) + cSq * (a[1] - b[1])) / d
  const uy = (aSq * (c[0] - b[0]) + bSq * (a[0] - c[0]) + cSq * (b[0] - a[0])) / d
  return [ux, uy]
}

function sampleArc(from: Vec2, via: Vec2, to: Vec2, segments = 32): Vec2[] {
  const center = circumcenter(from, via, to)
  const r = Math.hypot(from[0] - center[0], from[1] - center[1])
  const a0 = Math.atan2(from[1] - center[1], from[0] - center[0])
  const aVia = Math.atan2(via[1] - center[1], via[0] - center[0])
  const a1 = Math.atan2(to[1] - center[1], to[0] - center[0])
  const sweep = normalizeAngle(aVia - a0) + normalizeAngle(a1 - aVia)
  const points: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const a = a0 + sweep * (i / segments)
    points.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)])
  }
  return points
}

// Expands a sketch path (lines + arcs) into a flat polyline of world points, transforming every
// raw local point via `transform` first.
function pathToPoints(sketch: SketchPath, transform: (p: Vec2) => Vec2): THREE.Vector3[] {
  const start = transform(sketch.start)
  const points: THREE.Vector3[] = [new THREE.Vector3(start[0], start[1], 0)]
  let current = start
  for (const { to, seg } of sketch.path) {
    const target = transform(to)
    if (seg.kind === 'line') {
      points.push(new THREE.Vector3(target[0], target[1], 0))
    } else {
      const via = transform(seg.via)
      for (const p of sampleArc(current, via, target).slice(1)) points.push(new THREE.Vector3(p[0], p[1], 0))
    }
    current = target
  }
  return points
}

interface PathRun {
  kind: 'line' | 'arc'
  points: THREE.Vector3[]
}

// Same expansion as `pathToPoints`, but split into runs of consecutive same-kind segments (line
// vs arc), so each run can be colored differently. Runs share their boundary point with their
// neighbor, so there's no visual gap between them. When `closed`, a final straight segment back
// to `start` is appended first (matching how the sketcher itself closes an open path) - always a
// line, since every arc in this construction is bridged by straight lead-ins on both sides.
function splitPathByKind(sketch: SketchPath, transform: (p: Vec2) => Vec2, closed = false): PathRun[] {
  const runs: PathRun[] = []
  const startScreen = transform(sketch.start)
  let current = startScreen

  const appendSegment = (target: Vec2, kind: 'line' | 'arc', via?: Vec2) => {
    const expanded = kind === 'line' ? [current, target] : sampleArc(current, via as Vec2, target)
    const points = expanded.map((p) => new THREE.Vector3(p[0], p[1], 0))
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.points.push(...points.slice(1))
    else runs.push({ kind, points })
    current = target
  }

  for (const { to, seg } of sketch.path) {
    const target = transform(to)
    if (seg.kind === 'line') appendSegment(target, 'line')
    else appendSegment(target, 'arc', transform(seg.via))
  }
  if (closed) appendSegment(startScreen, 'line')

  return runs
}

function circlePoints(radius: number, segments = 96): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    points.push(new THREE.Vector3(radius * Math.cos(a), radius * Math.sin(a), -1))
  }
  return points
}

// A properly thick, screen-space-width line (regular THREE.Line/LineBasicMaterial ignores
// `linewidth` on most platforms) - built on Line2/LineMaterial so it stays clearly legible and
// clearly colored against the filled boundary, however this sketch grows. `resolution` has to
// track the canvas's pixel size for the width to come out right.
function ThickLine({
  points,
  color,
  z = 0,
  width = 3,
  dashed = false,
  closed = false,
}: {
  points: THREE.Vector3[]
  color: string
  z?: number
  width?: number
  dashed?: boolean
  closed?: boolean
}) {
  const { size } = useThree((state) => state)
  const line = useMemo(() => {
    const positions: number[] = []
    const ordered = closed ? [...points, points[0]] : points
    for (const p of ordered) positions.push(p.x, p.y, z)
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    const material = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: width,
      dashed,
      dashSize: 14,
      gapSize: 10,
      resolution: new THREE.Vector2(size.width, size.height),
    })
    const line2 = new Line2(geometry, material)
    if (dashed) line2.computeLineDistances()
    return line2
  }, [points, z, color, width, dashed, closed, size.width, size.height])
  return <primitive object={line} />
}

function Marker({ position, color }: { position: Vec2; color: string }) {
  return (
    <mesh position={[position[0], position[1], 1]}>
      <circleGeometry args={[18, 24]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

interface EdgeSketchSceneProps {
  boundary: SketchPath
  centerline: SketchPath
  vertexA: Vec2
  vertexB: Vec2
  radius: number
  angleDeg: number
}

function SketchContents({ boundary, centerline, vertexA, vertexB, radius, angleDeg }: EdgeSketchSceneProps) {
  // Rotates the A/B bisector to point straight up, purely cosmetic (never touches the sketch
  // math). Recomputed as the angle changes, so the picture stays consistently oriented.
  const rotation = useMemo(() => Math.PI / 2 - (angleDeg * DEG2RAD) / 2, [angleDeg])
  const transform = useMemo(() => (p: Vec2) => rotate2(p, rotation), [rotation])

  const boundaryPoints = useMemo(() => pathToPoints(boundary, transform), [boundary, transform])
  const centerlinePoints = useMemo(() => pathToPoints(centerline, transform), [centerline, transform])
  const boundaryRuns = useMemo(() => splitPathByKind(boundary, transform, true), [boundary, transform])
  const centerlineRuns = useMemo(() => splitPathByKind(centerline, transform), [centerline, transform])
  const referenceCirclePoints = useMemo(() => circlePoints(radius), [radius])

  const boundaryShapeGeometry = useMemo(() => {
    const shape = new THREE.Shape(boundaryPoints.map((p) => new THREE.Vector2(p.x, p.y)))
    return new THREE.ShapeGeometry(shape)
  }, [boundaryPoints])

  const aScreen = transform(vertexA)
  const bScreen = transform(vertexB)
  const centerScreen: Vec2 = [0, 0]

  const offsetALine = useMemo(
    () => [new THREE.Vector3(aScreen[0], aScreen[1], 0), centerlinePoints[0]],
    [aScreen, centerlinePoints],
  )
  const offsetBLine = useMemo(
    () => [centerlinePoints[centerlinePoints.length - 1], new THREE.Vector3(bScreen[0], bScreen[1], 0)],
    [bScreen, centerlinePoints],
  )

  return (
    <group>
      <ThickLine points={referenceCirclePoints} color={REFERENCE_CIRCLE_COLOR} width={1.5} dashed closed />
      <mesh geometry={boundaryShapeGeometry} position={[0, 0, 0]}>
        <meshBasicMaterial color={BOUNDARY_COLOR} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
      {boundaryRuns.map((run, i) => (
        <ThickLine
          key={`boundary-${i}`}
          points={run.points}
          color={run.kind === 'arc' ? ARC_COLOR : BOUNDARY_COLOR}
          z={0.1}
          width={3}
        />
      ))}
      {centerlineRuns.map((run, i) => (
        <ThickLine
          key={`centerline-${i}`}
          points={run.points}
          color={run.kind === 'arc' ? ARC_COLOR : CENTERLINE_COLOR}
          z={0.2}
          width={4}
          dashed
        />
      ))}
      <ThickLine points={offsetALine} color={OFFSET_LINE_COLOR} z={0.2} width={4} dashed />
      <ThickLine points={offsetBLine} color={OFFSET_LINE_COLOR} z={0.2} width={4} dashed />
      <Marker position={centerScreen} color={CENTER_MARKER_COLOR} />
      <Marker position={aScreen} color={VERTEX_MARKER_COLOR} />
      <Marker position={bScreen} color={VERTEX_MARKER_COLOR} />
    </group>
  )
}

// A fixed, orientation-locked camera (no rotation - this is a flat 2D sketch) that the user can
// still pan and zoom, same as the main dome viewport. Fit once to the sketch present on mount;
// further parameter edits reshape the geometry without yanking the camera around, since the user
// is expected to be panning/zooming manually by then.
function useInitialCameraFit(props: EdgeSketchSceneProps) {
  const [fit] = useState(() => {
    const rotation = Math.PI / 2 - (props.angleDeg * DEG2RAD) / 2
    const transform = (p: Vec2) => rotate2(p, rotation)
    const points = [...pathToPoints(props.boundary, transform), ...pathToPoints(props.centerline, transform)]
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const width = maxX - minX
    const height = maxY - minY
    const maxDim = Math.max(width, height, 100)
    const fov = 45
    const distance = (maxDim / 2 / Math.tan((fov * DEG2RAD) / 2)) * 1.7
    const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, 0]
    return { target, distance, fov }
  })
  return fit
}

export function EdgeSketchScene(props: EdgeSketchSceneProps) {
  const { target, distance, fov } = useInitialCameraFit(props)

  return (
    <Canvas>
      <color attach="background" args={['#12141a']} />
      <PerspectiveCamera
        makeDefault
        position={[target[0], target[1], target[2] + distance]}
        up={[0, 1, 0]}
        fov={fov}
        near={1}
        far={distance * 100}
      />
      <OrbitControls
        makeDefault
        enableRotate={false}
        target={target}
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
      <SketchContents {...props} />
    </Canvas>
  )
}
