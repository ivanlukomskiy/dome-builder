import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { EditTarget, ViewMode } from '../App'
import type { SceneData } from '../lib/polyhedra'
import { computeBraceEndpoints } from '../lib/braces'
import { buildBraceSolids, type BracePoints } from '../lib/braceSolid'
import { computePreviewBuildInputs } from '../lib/previewBuildInputs'
import { createPreviewProfileRecorder, isPreviewProfilingEnabled } from '../lib/previewProfile'
import type { FlangeShapeParams } from '../lib/flangeGeometry'
import {
  flangeFrame,
  flangeMeshCache,
  flangeSignatureContext,
  groupFlanges,
  placeMesh,
  type LocalFlange,
} from '../lib/flangeInstances'
import type {
  FlangeBuildJob,
  PreviewBuildPhase,
  PreviewBuildRequest,
  PreviewPiece,
  PreviewWorkerMessage,
  StrutBuildJob,
} from '../workers/previewBuilder.worker'

// How many struts (or flange outlines) one worker builds before it's torn down and a fresh one
// takes over - see the preview-build effect's runBatch. Small enough to keep a bound on how much
// opencascade garbage any one instance accumulates, large enough that most domes don't pay the
// WASM-reinit cost more than a handful of times.
const BATCH_SIZE = 12
// How many workers (each with its own opencascade heap) may build batches at once. Batches are
// independent, so the build time scales down almost linearly with this; it's capped because
// every live worker holds a full WASM instance in memory.
const MAX_WORKERS = 4

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
// Marks a vertex (Edit) and its flanges (Preview) that have any override of their own (corner
// length or flange parameters).
const CORNER_OVERRIDE_COLOR = new THREE.Color('#22d3ee')
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
  vertexCornerLength: ReadonlyMap<number, number>
  vertexFlangeParams: ReadonlyMap<number, Partial<FlangeShapeParams>>
  selectedFaceIndices: ReadonlySet<number>
  selectedBraceIndices: ReadonlySet<number>
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
  vertexCornerLength,
  vertexFlangeParams,
  selectedFaceIndices,
  selectedBraceIndices,
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
  const workersRef = useRef<Set<Worker>>(new Set())
  const nextRequestIdRef = useRef(0)

  useEffect(() => {
    const terminateWorkers = () => {
      for (const worker of workersRef.current) worker.terminate()
      workersRef.current.clear()
    }

    if (mode !== 'preview') {
      terminateWorkers()
      onPreviewProgress(null)
      return
    }

    const requestId = ++nextRequestIdRef.current
    onPreviewProgress({ phase: 'loading', done: 0, total: 0 })

    // Opt-in (`?profile` in the URL, see previewProfile.ts): times every stage of this build and
    // logs a report at the end.
    const profiler = isPreviewProfilingEnabled() ? createPreviewProfileRecorder() : null
    const timedMain = <T,>(label: string, fn: () => T): T => (profiler ? profiler.mainStep(label, fn) : fn())

    // Each edge's offsets and angular layout - all cheap, pure-JS work shared with the
    // "Download STEP Archive" export (see previewBuildInputs.ts).
    const { strutEntries, vertices, halfWidth } = timedMain('computePreviewBuildInputs', () =>
      computePreviewBuildInputs({
        data,
        transformedVertices,
        edgeThickness,
        thickness,
        extrudeDistance,
        cornerLength,
        vertexCornerLength,
        vertexFlangeParams,
        offsetModifier,
        endGrooveLengthPercent,
        midGrooveLengthPercent,
        grooveDepth,
        millingDiameter,
        chamferLength,
      }),
    )

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
      halfWidth,
      endGrooveLengthPercent,
      midGrooveLengthPercent,
      grooveDepth,
      millingDiameter,
      chamferLength,
      flangeParams,
    }

    // Flanges: hubs with identical inputs (up to rotation about their normal) share one built
    // mesh, and meshes built earlier are reused as they are - see flangeInstances.ts. Only the
    // groups without a cached mesh are sent to the workers.
    const flangeGroups = timedMain('groupFlanges', () =>
      groupFlanges(vertices, flangeSignatureContext(flangeParams, grooveDepth)),
    )
    const builtFlanges = new Map<string, LocalFlange>()
    const flangesToBuild: FlangeBuildJob[] = []
    let cachedVertexCount = 0
    for (const group of flangeGroups) {
      const cached = flangeMeshCache.get(group.key)
      if (cached) {
        builtFlanges.set(group.key, cached)
        cachedVertexCount += group.members.length
      } else {
        flangesToBuild.push({ key: group.key, vertex: group.representative.vertex })
      }
    }
    const flangeGroupByKey = new Map(flangeGroups.map((g) => [g.key, g]))

    const poolSize = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1))

    // Progress, in units the user recognizes: struts, and vertices (a built flange counts for
    // every vertex it stands for). Batches run concurrently, so each reports into shared counters.
    const progress = { struts: 0, flanges: cachedVertexCount }
    const strutTotal = strutJobs.length
    const flangeTotal = vertices.length
    const emitProgress = () => {
      // Flange batches are scheduled first (they're the long ones), so show them while any remain.
      if (progress.flanges < flangeTotal) {
        onPreviewProgress({ phase: 'flanges', done: progress.flanges, total: flangeTotal })
      } else {
        onPreviewProgress({ phase: 'struts', done: progress.struts, total: strutTotal })
      }
    }

    // Runs one batch (a handful of struts, or of flange outlines - never both) in its own fresh
    // worker, terminated the moment its result comes back. A single opencascade instance building
    // *everything* for a large dome in one go is what was running out of memory - splitting the
    // work across many short-lived instances instead means no single one ever has to hold more
    // than one batch's worth of accumulated geometry before its whole heap gets reclaimed.
    // `weights[k]` is how many progress units the batch's k-th item is worth.
    const runBatch = (
      batch: { strutJobs: StrutBuildJob[]; flangeJobs: FlangeBuildJob[] },
      phase: PreviewBuildPhase,
      weights: number[],
    ): Promise<Extract<PreviewWorkerMessage, { type: 'result' }>> =>
      new Promise((resolve, reject) => {
        const createdAt = performance.now()
        let readyAt = createdAt
        const worker = new Worker(new URL('../workers/previewBuilder.worker.ts', import.meta.url), {
          type: 'module',
        })
        workersRef.current.add(worker)

        // Progress units already reported for this batch.
        let reported = 0
        const report = (itemsDone: number) => {
          let units = 0
          for (let k = 0; k < itemsDone; k++) units += weights[k]
          progress[phase] += units - reported
          reported = units
          emitProgress()
        }

        const settle = (fn: () => void) => {
          worker.terminate()
          workersRef.current.delete(worker)
          fn()
        }

        worker.onmessage = (event: MessageEvent<PreviewWorkerMessage>) => {
          const msg = event.data
          if (msg.requestId !== requestId) return

          if (msg.type === 'ready') {
            readyAt = performance.now()
          } else if (msg.type === 'progress') {
            report(msg.done)
          } else if (msg.type === 'result') {
            report(weights.length)
            profiler?.addBatch({
              phase,
              items: weights.length,
              createToReadyMs: readyAt - createdAt,
              readyToResultMs: performance.now() - readyAt,
              worker: msg.profile ?? null,
            })
            settle(() => resolve(msg))
          } else if (msg.type === 'error') {
            settle(() => reject(new Error(msg.message)))
          }
        }
        worker.onerror = (event) => {
          settle(() => reject(new Error(event.message)))
        }

        const request: PreviewBuildRequest = {
          ...sharedRequestFields,
          strutJobs: batch.strutJobs,
          flangeJobs: batch.flangeJobs,
          profile: profiler !== null,
        }
        worker.postMessage(request)
      })

    let cancelled = false
    ;(async () => {
      const allPieces: PreviewPiece[] = []
      // Every strut's brace plate end points, across all batches - a brace's two struts can land
      // in different batches, so its body is only built once they're all in.
      const allBracePoints: BracePoints[] = []
      const strutResults: Extract<PreviewWorkerMessage, { type: 'result' }>[] = []

      // Independent batches, longest first. A batch failing to build flanges shouldn't sink the
      // whole preview (a degenerate wedge angle, an opencascade edge case, ...): log which vertices
      // were in it and skip them, same as a single strut failing to build. A failing strut batch
      // fails the build.
      const flangeBatchSize = Math.max(1, Math.min(BATCH_SIZE, Math.ceil(flangesToBuild.length / poolSize)))
      const tasks: (() => Promise<void>)[] = []
      for (const jobs of chunk(flangesToBuild, flangeBatchSize)) {
        tasks.push(async () => {
          try {
            const weights = jobs.map((job) => flangeGroupByKey.get(job.key)?.members.length ?? 1)
            const result = await runBatch({ strutJobs: [], flangeJobs: jobs }, 'flanges', weights)
            for (const { key, mesh } of result.flangeMeshes) {
              const group = flangeGroupByKey.get(key)
              if (!mesh || !group) continue
              const local: LocalFlange = { mesh, startAngleDeg: group.representative.startAngleDeg }
              builtFlanges.set(key, local)
              flangeMeshCache.set(key, local)
            }
          } catch (err) {
            console.error(
              `Failed to build flanges for vertices ${jobs.map((j) => j.vertex.vertexId).join(', ')}`,
              err,
            )
          }
        })
      }
      chunk(strutJobs, BATCH_SIZE).forEach((jobs, i) => {
        tasks.push(async () => {
          strutResults[i] = await runBatch(
            { strutJobs: jobs, flangeJobs: [] },
            'struts',
            jobs.map(() => 1),
          )
        })
      })

      try {
        emitProgress()
        let next = 0
        const runner = async () => {
          while (!cancelled) {
            const task = tasks[next++]
            if (!task) return
            await task()
          }
        }
        await Promise.all(Array.from({ length: Math.min(poolSize, tasks.length) }, runner))

        if (cancelled) return
        for (const result of strutResults) {
          allPieces.push(...result.pieces)
          allBracePoints.push(...result.bracePoints)
        }

        // Both plates of every hub: the group's mesh, turned to this vertex's orientation and
        // pushed out `flangeSpan` either way along its normal. Each plate is `grooveDepth` thick
        // and seated flush in the shoulder notch cut into the struts' own ends - one plate's outer
        // face level with the struts' own outer surface (halfWidth from the vertex), the other's
        // inner face level with their inner surface. The local mesh is centered on z = 0, so each
        // plate sits at the midpoint of its span, `halfWidth - grooveDepth / 2` out from the vertex.
        timedMain('placeFlanges', () => {
          const flangeSpan = halfWidth - grooveDepth / 2
          for (const group of flangeGroups) {
            const built = builtFlanges.get(group.key)
            if (!built) continue
            for (const { vertex, startAngleDeg } of group.members) {
              const color =
                vertex.cornerLengthOverride !== undefined || vertex.flangeOverrides !== undefined
                  ? CORNER_OVERRIDE_COLOR
                  : FLANGE_COLOR
              for (const sign of [1, -1] as const) {
                const placed = placeMesh(
                  built.mesh,
                  flangeFrame(vertex, startAngleDeg - built.startAngleDeg, sign * flangeSpan),
                )
                allPieces.push({ ...placed, color: [color.r, color.g, color.b] })
              }
            }
          }
        })

        for (const { braceId, mesh } of timedMain('buildBraceSolids', () => buildBraceSolids(allBracePoints))) {
          try {
            allPieces.push({ ...mesh, color: BRACE_BODY_COLOR })
          } catch (err) {
            console.error(`Failed to build brace ${braceId}`, err)
          }
        }
        const merged = timedMain('buildColoredGeometry + mergeGeometries', () => {
          const geometries = allPieces.map(buildColoredGeometry)
          const result = geometries.length > 0 ? mergeGeometries(geometries, false) : null
          geometries.forEach((g) => g.dispose())
          return result
        })
        setPreviewGeometry((prev) => {
          prev?.dispose()
          return merged
        })
        profiler?.finish({
          struts: strutJobs.length,
          vertices: vertices.length,
          poolSize,
          flangeGroups: flangeGroups.length,
          flangeGroupsBuilt: flangesToBuild.length,
          flangeGroupsCached: flangeGroups.length - flangesToBuild.length,
        })
      } catch (err) {
        console.error('Failed to build preview', err)
        // Batches still running would only build a preview nobody is waiting for.
        terminateWorkers()
      } finally {
        if (!cancelled) onPreviewProgress(null)
      }
    })()

    return () => {
      cancelled = true
      terminateWorkers()
    }
  }, [
    mode,
    data,
    transformedVertices,
    edgeThickness,
    thickness,
    extrudeDistance,
    cornerLength,
    vertexCornerLength,
    vertexFlangeParams,
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
              <meshStandardMaterial
                color={
                  isSelected
                    ? '#f5a623'
                    : vertexCornerLength.has(idx) || vertexFlangeParams.has(idx)
                      ? `#${CORNER_OVERRIDE_COLOR.getHexString()}`
                      : '#4fd97e'
                }
              />
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
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[vertexMarkerRadius, 16, 16]} />
        <meshStandardMaterial color="#f5e050" />
      </mesh>
    </group>
  )
}
