import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { EditTarget, ViewMode } from '../App'
import type { SceneData } from '../lib/polyhedra'
import { computeBraceEndpoints } from '../lib/braces'
import { buildBraceSolids, type BracePoints } from '../lib/braceSolid'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import { computePreviewBuildInputs } from '../lib/previewBuildInputs'
import type { FlangeShapeParams } from '../lib/flangeGeometry'
import type {
  PreviewBuildPhase,
  PreviewBuildRequest,
  PreviewPiece,
  PreviewWorkerMessage,
  StrutBuildJob,
} from '../workers/previewBuilder.worker'

// How many struts (or flange vertices) one worker builds before it's torn down and a fresh one
// takes over - see the preview-build effect's runBatch. Small enough to keep a bound on how much
// opencascade garbage any one instance accumulates, large enough that most domes don't pay the
// WASM-reinit cost more than a handful of times.
const BATCH_SIZE = 12

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

export interface PreviewProgress {
  phase: 'loading' | 'struts' | 'flanges'
  done: number
  total: number
}

const SELECTED_COLOR = '#f5a623'
const EDGE_DEFAULT_COLOR = new THREE.Color('#3a5a7a')
const EDGE_OVERRIDE_MIN_COLOR = new THREE.Color('#4fd97e')
const EDGE_OVERRIDE_MAX_COLOR = new THREE.Color('#ff3b3b')
// Override magnitude (mm) at which the color heatmap maxes out.
const EDGE_OVERRIDE_COLOR_REFERENCE = 300
// A neutral steel-plate tone for flange solids, distinct from any strut color so the hub
// hardware reads as its own part rather than blending into the beams it connects.
const FLANGE_COLOR = new THREE.Color('#b0b4bc')
const BRACE_COLOR = '#e05ad0'

// The heatmap color for a given thickness override (or the default tone if there isn't one) -
// shared between the clickable edge markers in Edit mode and the beam mesh in Preview, so a
// dome's strut coloring means the same thing in both places.
function edgeThicknessColor(override: number | undefined): THREE.Color {
  if (override === undefined) return EDGE_DEFAULT_COLOR.clone()
  const t = Math.min(override / EDGE_OVERRIDE_COLOR_REFERENCE, 1)
  return EDGE_OVERRIDE_MIN_COLOR.clone().lerp(EDGE_OVERRIDE_MAX_COLOR, t)
}

function edgeMarkerColor(override: number | undefined, isSelected: boolean): string {
  if (isSelected) return SELECTED_COLOR
  return `#${edgeThicknessColor(override).getHexString()}`
}

// A BufferGeometry from one piece the preview worker built, flat-shaded with a single solid
// vertex color - shared by strut and flange solids alike, since both merge into the same preview
// geometry (see the preview-build effect below) and mergeGeometries needs every piece to carry
// the same set of attributes.
// The brace bodies (bars between the struts' brace plates) - distinct from the plates' magenta.
const BRACE_BODY_COLOR: [number, number, number] = [0.96, 0.62, 0.13]

function buildColoredGeometry(piece: PreviewPiece): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(piece.positions, 3))
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(piece.normals, 3))
  geom.setIndex(new THREE.Uint32BufferAttribute(piece.indices, 1))

  const [r, g, b] = piece.color
  const vertexCount = piece.positions.length / 3
  const colors = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geom
}

// Fan-triangulates a face (a triangle, or a pentagon/hexagon for a Goldberg dual face) from its
// first vertex, into its own small standalone geometry - used for individually clickable faces.
function buildFanGeometry(positions: THREE.Vector3[]): THREE.BufferGeometry {
  const verts: number[] = []
  const v0 = positions[0]
  for (let i = 1; i < positions.length - 1; i++) {
    const v1 = positions[i]
    const v2 = positions[i + 1]
    verts.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geom.computeVertexNormals()
  return geom
}

interface DomeMeshProps {
  mode: ViewMode
  editTarget: EditTarget
  diameter: number
  data: SceneData
  transformedVertices: ReadonlyMap<number, THREE.Vector3>
  selectedVertexIndices: ReadonlySet<number>
  selectedEdgeIndices: ReadonlySet<number>
  edgeThickness: ReadonlyMap<number, number>
  selectedFaceIndices: ReadonlySet<number>
  selectedBraceIndices: ReadonlySet<number>
  centerY: number
  extrudeDistance: number
  thickness: number
  cornerLength: number
  offsetModifier: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameter: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  flangeMillingDiameter: number
  onVertexClick: (index: number) => void
  onEdgeClick: (index: number) => void
  onFaceClick: (id: number) => void
  onBraceClick: (id: number) => void
  onPreviewProgress: (progress: PreviewProgress | null) => void
}

export function DomeMesh({
  mode,
  editTarget,
  diameter,
  data,
  transformedVertices,
  selectedVertexIndices,
  selectedEdgeIndices,
  edgeThickness,
  selectedFaceIndices,
  selectedBraceIndices,
  centerY,
  extrudeDistance,
  thickness,
  cornerLength,
  offsetModifier,
  endGrooveLengthPercent,
  midGrooveLengthPercent,
  grooveDepth,
  millingDiameter,
  chamferLength,
  toleranceLongitudinal,
  toleranceTransverse,
  centerHoleDiameter,
  sideHoleDiameter,
  sideHoleDiameterOffset,
  overshoot,
  minSide,
  flangeMillingDiameter,
  onVertexClick,
  onEdgeClick,
  onFaceClick,
  onBraceClick,
  onPreviewProgress,
}: DomeMeshProps) {
  const resolvePosition = useCallback((idx: number) => transformedVertices.get(idx)!, [transformedVertices])

  // Vertex/center/edge marker sizes, in mm - purely visual, scaled to the dome's own diameter so
  // they stay proportionate (rather than dwarfing or disappearing into) domes of very different
  // sizes.
  const vertexMarkerRadius = diameter / 100
  const selectedVertexMarkerRadius = vertexMarkerRadius * 1.2
  const edgeMarkerRadius = diameter / 150

  const faceGeometry = useMemo(() => {
    const positions: number[] = []
    for (const face of data.faces.values()) {
      // Fan-triangulate each face (a triangle for triangular meshes, or a
      // pentagon/hexagon for a Goldberg polyhedron's dual faces) from vertex 0.
      const v0 = resolvePosition(face[0])
      for (let i = 1; i < face.length - 1; i++) {
        const v1 = resolvePosition(face[i])
        const v2 = resolvePosition(face[i + 1])
        positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.computeVertexNormals()
    return geom
  }, [data.faces, resolvePosition])

  const edgeGeometry = useMemo(() => {
    const positions: number[] = []
    for (const [a, b] of data.edges.values()) {
      const va = resolvePosition(a)
      const vb = resolvePosition(b)
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geom
  }, [data.edges, resolvePosition])

  // Preview mode turns each edge into a real solid strut and each hub vertex into a flange plate
  // pair, built with replicad/opencascade.js (see strutGeometry.ts, flangeGeometry.ts). The 2D
  // drawing and extrude/mesh steps both need opencascade's WASM module and are, by far, the
  // expensive part - so they run entirely inside previewBuilder.worker.ts, off this thread, with
  // this effect only doing the cheap, pure-JS bookkeeping (each edge's offsets and angles)
  // before handing it off. Running each build in a fresh worker (and terminating it once done)
  // also reclaims that worker's whole opencascade heap on its own, rather than relying on every
  // intermediate shape being individually .delete()'d.
  const [previewGeometry, setPreviewGeometry] = useState<THREE.BufferGeometry | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const nextRequestIdRef = useRef(0)

  useEffect(() => {
    if (mode !== 'preview') {
      workerRef.current?.terminate()
      workerRef.current = null
      onPreviewProgress(null)
      return
    }

    const requestId = ++nextRequestIdRef.current
    onPreviewProgress({ phase: 'loading', done: 0, total: 0 })

    // Each edge's offsets and angular layout - all cheap, pure-JS work shared with the
    // "Download STEP Archive" export (see previewBuildInputs.ts).
    const { strutEntries, vertices, halfWidth } = computePreviewBuildInputs({
      data,
      transformedVertices,
      centerY,
      edgeThickness,
      thickness,
      extrudeDistance,
      cornerLength,
      offsetModifier,
      endGrooveLengthPercent,
      midGrooveLengthPercent,
      grooveDepth,
      millingDiameter,
      chamferLength,
    })

    // Colored the same way the clickable edge markers are in Edit mode, so a strut's color means
    // the same thing (thickness override, and by how much) in both places.
    const strutJobs: StrutBuildJob[] = strutEntries.map((entry) => {
      const color = edgeThicknessColor(entry.thicknessOverride)
      return { ...entry, color: [color.r, color.g, color.b] }
    })

    const flangeParams: FlangeShapeParams = {
      toleranceLongitudinal,
      toleranceTransverse,
      centerHoleDiameter,
      sideHoleDiameter,
      sideHoleDiameterOffset,
      overshoot,
      minSide,
      millingDiameter: flangeMillingDiameter,
    }

    const sharedRequestFields = {
      requestId,
      centerY,
      cornerLength,
      halfWidth,
      endGrooveLengthPercent,
      midGrooveLengthPercent,
      grooveDepth,
      millingDiameter,
      chamferLength,
      flangeParams,
      flangeColor: [FLANGE_COLOR.r, FLANGE_COLOR.g, FLANGE_COLOR.b] as [number, number, number],
    }

    // Runs one batch (a handful of struts, or of flange vertices - never both) in its own fresh
    // worker, terminated the moment its result comes back. A single opencascade instance building
    // *everything* for a large dome in one go is what was running out of memory - splitting the
    // work across many short-lived instances instead means no single one ever has to hold more
    // than one batch's worth of accumulated geometry before its whole heap gets reclaimed.
    const runBatch = (
      jobs: StrutBuildJob[],
      vertices: VertexEdgesInfo[],
      phase: PreviewBuildPhase,
      doneBefore: number,
      total: number,
    ): Promise<{ pieces: PreviewPiece[]; bracePoints: BracePoints[] }> =>
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/previewBuilder.worker.ts', import.meta.url), {
          type: 'module',
        })
        workerRef.current = worker

        const settle = (fn: () => void) => {
          worker.terminate()
          if (workerRef.current === worker) workerRef.current = null
          fn()
        }

        worker.onmessage = (event: MessageEvent<PreviewWorkerMessage>) => {
          const msg = event.data
          if (msg.requestId !== requestId) return

          if (msg.type === 'progress') {
            onPreviewProgress({ phase, done: doneBefore + msg.done, total })
          } else if (msg.type === 'result') {
            settle(() => resolve({ pieces: msg.pieces, bracePoints: msg.bracePoints }))
          } else if (msg.type === 'error') {
            settle(() => reject(new Error(msg.message)))
          }
        }
        worker.onerror = (event) => {
          settle(() => reject(new Error(event.message)))
        }

        const request: PreviewBuildRequest = { ...sharedRequestFields, strutJobs: jobs, vertices }
        worker.postMessage(request)
      })

    let cancelled = false
    ;(async () => {
      const allPieces: PreviewPiece[] = []
      // Every strut's brace plate end points, across all batches - a brace's two struts can land
      // in different batches, so its body is only built once they're all in.
      const allBracePoints: BracePoints[] = []
      try {
        onPreviewProgress({ phase: 'struts', done: 0, total: strutJobs.length })
        const strutBatches = chunk(strutJobs, BATCH_SIZE)
        for (let i = 0; i < strutBatches.length; i++) {
          if (cancelled) return
          const { pieces, bracePoints } = await runBatch(
            strutBatches[i],
            [],
            'struts',
            i * BATCH_SIZE,
            strutJobs.length,
          )
          allPieces.push(...pieces)
          allBracePoints.push(...bracePoints)
        }

        onPreviewProgress({ phase: 'flanges', done: 0, total: vertices.length })
        const vertexBatches = chunk(vertices, BATCH_SIZE)
        for (let i = 0; i < vertexBatches.length; i++) {
          if (cancelled) return
          const batch = vertexBatches[i]
          try {
            const { pieces } = await runBatch([], batch, 'flanges', i * BATCH_SIZE, vertices.length)
            allPieces.push(...pieces)
          } catch (err) {
            // A single vertex's flange geometry failing (a degenerate wedge angle, an
            // opencascade edge case, ...) shouldn't sink the whole preview - log which vertices
            // were in the failing batch and skip them, same as a single strut failing to build.
            console.error(`Failed to build flanges for vertices ${batch.map((v) => v.vertexId).join(', ')}`, err)
          }
        }

        if (cancelled) return
        for (const { braceId, mesh } of buildBraceSolids(allBracePoints)) {
          try {
            allPieces.push({ ...mesh, color: BRACE_BODY_COLOR })
          } catch (err) {
            console.error(`Failed to build brace ${braceId}`, err)
          }
        }
        const geometries = allPieces.map(buildColoredGeometry)
        const merged = geometries.length > 0 ? mergeGeometries(geometries, false) : null
        geometries.forEach((g) => g.dispose())
        setPreviewGeometry((prev) => {
          prev?.dispose()
          return merged
        })
      } catch (err) {
        console.error('Failed to build preview', err)
      } finally {
        if (!cancelled) onPreviewProgress(null)
      }
    })()

    return () => {
      cancelled = true
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [
    mode,
    data,
    transformedVertices,
    centerY,
    edgeThickness,
    thickness,
    extrudeDistance,
    cornerLength,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameter,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    flangeMillingDiameter,
    onPreviewProgress,
  ])

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }
  const handlePointerOut = () => {
    document.body.style.cursor = 'auto'
  }

  const editingVertices = mode === 'edit' && editTarget === 'vertices'
  const editingEdges = mode === 'edit' && editTarget === 'edges'
  const editingFaces = mode === 'edit' && editTarget === 'faces'
  const editingBraces = mode === 'edit' && editTarget === 'braces'

  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  // One small standalone geometry per face, only needed while individually clickable.
  const faceMeshEntries = useMemo(() => {
    if (!editingFaces) return []
    return Array.from(data.faces.entries()).map(([id, face]) => ({
      id,
      geometry: buildFanGeometry(face.map(resolvePosition)),
    }))
  }, [editingFaces, data.faces, resolvePosition])

  // Each brace as a straight line between its two points, `shift * edge length` from the shared
  // vertex along each edge. Shown in Edit mode only, whichever thing is being edited.
  const braceMarkerEntries = useMemo(() => {
    if (mode !== 'edit') return []
    const entries: { id: number; mid: THREE.Vector3; length: number; quaternion: THREE.Quaternion }[] = []
    for (const [id, brace] of data.braces) {
      const endpoints = computeBraceEndpoints(brace, data.edges, resolvePosition)
      if (!endpoints) continue
      const [p1, p2] = endpoints
      const direction = p2.clone().sub(p1)
      const length = direction.length()
      if (length === 0) continue
      entries.push({
        id,
        mid: p1.clone().add(p2).multiplyScalar(0.5),
        length,
        quaternion: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()),
      })
    }
    return entries
  }, [mode, data.braces, data.edges, resolvePosition, up])

  return (
    <group>
      {!editingFaces && (mode === 'edit' || mode === 'new') && (
        <mesh geometry={faceGeometry}>
          <meshStandardMaterial
            color="#5b9bd5"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            roughness={0.6}
          />
        </mesh>
      )}
      {(mode === 'new' || editingVertices || editingFaces) && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color="#1b3a57" />
        </lineSegments>
      )}
      {mode === 'preview' && previewGeometry && (
        <mesh geometry={previewGeometry}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.5} />
        </mesh>
      )}
      {editingVertices &&
        Array.from(data.vertices.keys()).map((idx) => {
          const v = resolvePosition(idx)
          const isSelected = selectedVertexIndices.has(idx)
          return (
            <mesh
              key={idx}
              position={[v.x, v.y, v.z]}
              onClick={(e) => {
                e.stopPropagation()
                onVertexClick(idx)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <sphereGeometry
                args={[isSelected ? selectedVertexMarkerRadius : vertexMarkerRadius, 16, 16]}
              />
              <meshStandardMaterial color={isSelected ? '#f5a623' : '#4fd97e'} />
            </mesh>
          )
        })}
      {editingEdges &&
        Array.from(data.edges.entries()).map(([index, [a, b]]) => {
          const va = resolvePosition(a)
          const vb = resolvePosition(b)
          const mid = va.clone().add(vb).multiplyScalar(0.5)
          const direction = vb.clone().sub(va)
          const length = direction.length()
          const quaternion = new THREE.Quaternion().setFromUnitVectors(
            up,
            direction.normalize(),
          )
          const isSelected = selectedEdgeIndices.has(index)
          return (
            <mesh
              key={index}
              position={[mid.x, mid.y, mid.z]}
              quaternion={quaternion}
              onClick={(e) => {
                e.stopPropagation()
                onEdgeClick(index)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <cylinderGeometry args={[edgeMarkerRadius, edgeMarkerRadius, length, 8]} />
              <meshStandardMaterial
                color={edgeMarkerColor(edgeThickness.get(index), isSelected)}
              />
            </mesh>
          )
        })}
      {editingFaces &&
        faceMeshEntries.map(({ id, geometry }) => {
          const isSelected = selectedFaceIndices.has(id)
          return (
            <mesh
              key={id}
              geometry={geometry}
              onClick={(e) => {
                e.stopPropagation()
                onFaceClick(id)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <meshStandardMaterial
                color={isSelected ? SELECTED_COLOR : '#5b9bd5'}
                side={THREE.DoubleSide}
                roughness={0.6}
              />
            </mesh>
          )
        })}
      {braceMarkerEntries.map(({ id, mid, length, quaternion }) => {
        const isSelected = selectedBraceIndices.has(id)
        // Thick enough to click while editing braces, a thin line otherwise.
        const radius = edgeMarkerRadius * (editingBraces ? 0.6 : 0.2)
        return (
          <mesh
            key={`brace-${id}`}
            position={[mid.x, mid.y, mid.z]}
            quaternion={quaternion}
            onClick={
              editingBraces
                ? (e) => {
                    e.stopPropagation()
                    onBraceClick(id)
                  }
                : undefined
            }
            onPointerOver={editingBraces ? handlePointerOver : undefined}
            onPointerOut={editingBraces ? handlePointerOut : undefined}
          >
            <cylinderGeometry args={[radius, radius, length, 8]} />
            <meshStandardMaterial color={isSelected ? SELECTED_COLOR : BRACE_COLOR} />
          </mesh>
        )
      })}
      <mesh position={[0, centerY, 0]}>
        <sphereGeometry args={[vertexMarkerRadius, 16, 16]} />
        <meshStandardMaterial color="#f5e050" />
      </mesh>
    </group>
  )
}
