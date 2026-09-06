import * as THREE from 'three'
import type { Edge, Face, PolyhedronData } from './polyhedra'
import { removeVertices, resolveVertexPosition, sliceLayers } from './polyhedra'
import { computeEdgeEndOffsets } from './strutGeometry'
import { computeEdgesInfo, type VertexEdgesInfo } from './edgesInfo'

// Everything DomeMesh.tsx's live Preview build and the "Download STEP Archive" export both need
// before handing off to a worker: which edges/vertices are currently visible, their per-edge
// offsets (computeEdgeEndOffsets) and per-vertex angular layout (computeEdgesInfo). All of this is
// cheap, pure-JS work with no opencascade involved, kept out of the workers themselves (see
// previewBuilder.worker.ts/stepExportWorker.ts, which only do the actual 2D drawing + solid
// building) and out of React so it's usable from a plain callback (App.tsx's export handler) as
// well as DomeMesh's own effect.

export interface StrutGeometryEntry {
  index: number
  posA: [number, number, number]
  posB: [number, number, number]
  offsetA: number
  offsetB: number
  beamThickness: number
  // This edge's own thickness override, if any - undefined means "uses the model default". Not
  // needed to build the solid itself; DomeMesh uses it to pick the strut's preview color.
  thicknessOverride: number | undefined
}

export interface PreviewBuildInputs {
  strutEntries: StrutGeometryEntry[]
  vertices: VertexEdgesInfo[]
  halfWidth: number
}

export interface PreviewBuildInputParams {
  data: PolyhedronData
  transformedVertices: THREE.Vector3[]
  addedVertices: ReadonlyMap<number, THREE.Vector3>
  layerCount: number
  deletedVertexIndices: ReadonlySet<number>
  deletedEdgeIndices: ReadonlySet<number>
  deletedFaceIndices: ReadonlySet<number>
  addedFaces: Face[]
  addedEdges: Edge[]
  centerY: number
  edgeThickness: ReadonlyMap<number, number>
  thickness: number
  extrudeDistance: number
  cornerLength: number
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
    addedVertices,
    layerCount,
    deletedVertexIndices,
    deletedEdgeIndices,
    deletedFaceIndices,
    addedFaces,
    addedEdges,
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
  } = params

  const sliced = removeVertices(
    sliceLayers({ ...data, vertices: transformedVertices }, layerCount),
    deletedVertexIndices,
  )
  const keptSet = new Set(sliced.keptVertexIndices)
  const resolvePosition = (idx: number) => resolveVertexPosition(idx, transformedVertices, addedVertices)

  const visibleEdgeEntries = data.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge: [a, b], index }) => keptSet.has(a) && keptSet.has(b) && !deletedEdgeIndices.has(index))
  const visibleAddedEdgeEntries = addedEdges
    .map((edge, i) => ({ edge, index: -(i + 1) }))
    .filter(
      ({ edge: [a, b], index }) =>
        !deletedEdgeIndices.has(index) &&
        (a < 0 ? !deletedVertexIndices.has(a) : keptSet.has(a)) &&
        (b < 0 ? !deletedVertexIndices.has(b) : keptSet.has(b)),
    )

  const strutEntries3d = [
    ...visibleEdgeEntries.map(({ edge: [a, b], index }) => ({
      a,
      b,
      index,
      posA: sliced.vertices[a],
      posB: sliced.vertices[b],
    })),
    ...visibleAddedEdgeEntries.map(({ edge: [a, b], index }) => ({
      a,
      b,
      index,
      posA: resolvePosition(a),
      posB: resolvePosition(b),
    })),
  ]

  const offsets = computeEdgeEndOffsets(
    data,
    transformedVertices,
    addedVertices,
    layerCount,
    deletedVertexIndices,
    deletedEdgeIndices,
    addedFaces,
    addedEdges,
    centerY,
    (edgeId) => edgeThickness.get(edgeId) ?? thickness,
  )
  const halfWidth = extrudeDistance / 2

  const strutEntries: StrutGeometryEntry[] = strutEntries3d.map(({ a, b, index, posA, posB }) => {
    const override = edgeThickness.get(index)
    return {
      index,
      posA: [posA.x, posA.y, posA.z],
      posB: [posB.x, posB.y, posB.z],
      offsetA: (offsets.get(index)?.get(a) ?? 0) + offsetModifier,
      offsetB: (offsets.get(index)?.get(b) ?? 0) + offsetModifier,
      beamThickness: override ?? thickness,
      thicknessOverride: override,
    }
  })

  const edgesInfo = computeEdgesInfo({
    data,
    transformedVertices,
    addedVertices,
    layerCount,
    deletedVertexIndices,
    deletedEdgeIndices,
    deletedFaceIndices,
    addedFaces,
    addedEdges,
    centerY,
    edgeThicknessOf: (edgeId) => edgeThickness.get(edgeId) ?? thickness,
    cornerLength,
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
