import * as THREE from 'three'
import type { SceneData } from './polyhedra'
import { computeEdgeEndOffsets } from './strutGeometry'
import { computeEdgesInfo, type VertexEdgesInfo } from './edgesInfo'
import type { FlangeShapeParams, FootParams } from './flangeGeometry'
import { computeStrutBraces, indexBracesByEdge, type StrutBraces } from './braces'

// Everything DomeMesh.tsx's live Preview build and the "Download STEP Archive" export both need
// before handing off to a worker: each edge's per-edge offsets (computeEdgeEndOffsets) and
// per-vertex angular layout (computeEdgesInfo). All of this is cheap, pure-JS work with no
// opencascade involved, kept out of the workers themselves (see previewBuilder.worker.ts/
// stepExportWorker.ts, which only do the actual 2D drawing + solid building) and out of React so
// it's usable from a plain callback (App.tsx's export handler) as well as DomeMesh's own effect.

export interface StrutGeometryEntry {
  index: number
  // The vertices at the A / B end of this edge (posA / posB are their positions).
  vertexA: number
  vertexB: number
  posA: [number, number, number]
  posB: [number, number, number]
  offsetA: number
  offsetB: number
  // Corner length at each end - its vertex's override, or the global one.
  cornerLengthA: number
  cornerLengthB: number
  beamThickness: number
  // This edge's own thickness override, if any - undefined means "uses the model default". Not
  // needed to build the solid itself; DomeMesh uses it to pick the strut's preview color.
  thicknessOverride: number | undefined
  // Braces lying on this strut's A / B end (empty lists = none) - passed on to
  // computeStrutBoundary.
  braces: StrutBraces
}

export interface PreviewBuildInputs {
  strutEntries: StrutGeometryEntry[]
  vertices: VertexEdgesInfo[]
  halfWidth: number
}

export interface PreviewBuildInputParams {
  data: SceneData
  transformedVertices: ReadonlyMap<number, THREE.Vector3>
  edgeThickness: ReadonlyMap<number, number>
  thickness: number
  extrudeDistance: number
  cornerLength: number
  // Per-vertex corner length overrides, keyed by vertex id (absent = use `cornerLength`).
  vertexCornerLength: ReadonlyMap<number, number>
  // Per-vertex flange parameter overrides, keyed by vertex id.
  vertexFlangeParams: ReadonlyMap<number, Partial<FlangeShapeParams>>
  // Ids of the vertices marked as feet, and the (global) dimensions they're built with.
  footVertices: ReadonlySet<number>
  footParams: FootParams
  offsetModifier: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
}

export function computePreviewBuildInputs(params: PreviewBuildInputParams): PreviewBuildInputs {
  const {
    data,
    transformedVertices,
    edgeThickness,
    thickness,
    extrudeDistance,
    cornerLength,
    vertexCornerLength,
    vertexFlangeParams,
    footVertices,
    footParams,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
  } = params

  const strutEntries3d = Array.from(data.edges.entries()).map(([index, [a, b]]) => ({
    a,
    b,
    index,
    posA: transformedVertices.get(a)!,
    posB: transformedVertices.get(b)!,
  }))

  const offsets = computeEdgeEndOffsets(data, transformedVertices, (edgeId) => edgeThickness.get(edgeId) ?? thickness)
  const halfWidth = extrudeDistance / 2
  const bracesByEdge = indexBracesByEdge(data.braces)

  const strutEntries: StrutGeometryEntry[] = strutEntries3d.map(({ a, b, index, posA, posB }) => {
    const override = edgeThickness.get(index)
    return {
      index,
      vertexA: a,
      vertexB: b,
      posA: [posA.x, posA.y, posA.z],
      posB: [posB.x, posB.y, posB.z],
      offsetA: (offsets.get(index)?.get(a) ?? 0) + offsetModifier,
      offsetB: (offsets.get(index)?.get(b) ?? 0) + offsetModifier,
      cornerLengthA: vertexCornerLength.get(a) ?? cornerLength,
      cornerLengthB: vertexCornerLength.get(b) ?? cornerLength,
      beamThickness: override ?? thickness,
      thicknessOverride: override,
      braces: computeStrutBraces(
        index,
        [a, b],
        posA.distanceTo(posB),
        bracesByEdge,
        data.edges,
        (id) => transformedVertices.get(id)!,
      ),
    }
  })

  const edgesInfo = computeEdgesInfo({
    data,
    transformedVertices,
    edgeThicknessOf: (edgeId) => edgeThickness.get(edgeId) ?? thickness,
    cornerLength,
    vertexCornerLength,
    vertexFlangeParams,
    footVertices,
    footParams,
    halfWidth,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
  })

  return { strutEntries, vertices: edgesInfo.vertices, halfWidth }
}
