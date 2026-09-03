import * as THREE from 'three'
import type { Edge, Face, PolyhedronData, SelectionMode, VertexTransform } from './polyhedra'
import { computeLayers } from './polyhedra'

// A saved config captures the *result* of picking a shape in the "New" tab - the concrete
// vertex/face/edge data - plus every edit and view/preview setting made on top of it. It does
// not capture the shape/axis/subdivisions recipe (that's only meaningful while still choosing
// a shape), which tab is active, or the redo stack (session-only, not worth persisting).
export interface DomeConfig {
  version: 10
  vertices: [number, number, number][]
  faces: Face[]
  edges: Edge[]
  layerCount: number
  selectionMode: SelectionMode
  centerZ: number
  extrudeDistance: number
  thickness: number
  cornerLength: number
  // Added to every edge-end's computed minOffset (see computeVertexHubMetrics) before it's
  // applied in Preview - a global fudge factor, in mm, to push every strut end further from
  // (positive) or closer to (negative) its vertex than the raw miter math calls for. 0 means no
  // change.
  offsetModifier: number
  // Shouldered tenon cut into each strut end (see computeStrutBoundaryManual's groove/mill
  // params in strutGeometryManual.ts).
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  deletedGroups: number[][]
  vertexTransforms: [number, VertexTransform][]
  addedVertices: [number, [number, number, number]][]
  addedFaces: Face[]
  nextAddedVertexId: number
  // Extra edges beyond the canonical `edges` - e.g. the sides "Add Points" creates that didn't
  // already exist. Selectable/deletable/overridable just like canonical edges, signed the same
  // way added vertices/faces are: referenced elsewhere as -(index here) - 1.
  addedEdges: Edge[]
  // Per-edge thickness override, in mm, keyed by index into `edges` (canonical) or the signed
  // id of an entry in `addedEdges`; absent means "use the global `thickness` above".
  edgeThickness: [number, number][]
  // Deleted faces - indices into `faces` (canonical) or -(index into addedFaces + 1) (added).
  deletedFaceIndices: number[]
  // Deleted edges - indices into `edges` (canonical) or -(index into addedEdges + 1) (added).
  deletedEdgeIndices: number[]
}

// The subset of App's state a config captures - plain data in, plain data out, so App can
// build one straight from its own state variables and apply one straight back onto them.
export interface DomeState {
  baseData: PolyhedronData
  layerCount: number
  selectionMode: SelectionMode
  centerZ: number
  extrudeDistance: number
  thickness: number
  cornerLength: number
  offsetModifier: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  deletedGroups: number[][]
  vertexTransforms: ReadonlyMap<number, VertexTransform>
  addedVertices: ReadonlyMap<number, THREE.Vector3>
  addedFaces: Face[]
  nextAddedVertexId: number
  addedEdges: Edge[]
  edgeThickness: ReadonlyMap<number, number>
  deletedFaceIndices: ReadonlySet<number>
  deletedEdgeIndices: ReadonlySet<number>
}

export function serializeConfig(state: DomeState): DomeConfig {
  return {
    version: 10,
    vertices: state.baseData.vertices.map((v) => [v.x, v.y, v.z]),
    faces: state.baseData.faces,
    edges: state.baseData.edges,
    layerCount: state.layerCount,
    selectionMode: state.selectionMode,
    centerZ: state.centerZ,
    extrudeDistance: state.extrudeDistance,
    thickness: state.thickness,
    cornerLength: state.cornerLength,
    offsetModifier: state.offsetModifier,
    endGrooveLengthPercent: state.endGrooveLengthPercent,
    midGrooveLengthPercent: state.midGrooveLengthPercent,
    grooveDepth: state.grooveDepth,
    millingDiameter: state.millingDiameter,
    chamferLength: state.chamferLength,
    deletedGroups: state.deletedGroups,
    vertexTransforms: Array.from(state.vertexTransforms.entries()),
    addedVertices: Array.from(state.addedVertices.entries()).map(([id, v]) => [
      id,
      [v.x, v.y, v.z],
    ]),
    addedFaces: state.addedFaces,
    nextAddedVertexId: state.nextAddedVertexId,
    addedEdges: state.addedEdges,
    edgeThickness: Array.from(state.edgeThickness.entries()),
    deletedFaceIndices: Array.from(state.deletedFaceIndices),
    deletedEdgeIndices: Array.from(state.deletedEdgeIndices),
  }
}

export function deserializeConfig(config: DomeConfig): DomeState {
  const vertices = config.vertices.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  return {
    baseData: {
      vertices,
      faces: config.faces,
      edges: config.edges,
      layers: computeLayers(vertices),
    },
    layerCount: config.layerCount,
    selectionMode: config.selectionMode,
    centerZ: config.centerZ,
    extrudeDistance: config.extrudeDistance,
    thickness: config.thickness,
    cornerLength: config.cornerLength,
    offsetModifier: config.offsetModifier,
    endGrooveLengthPercent: config.endGrooveLengthPercent,
    midGrooveLengthPercent: config.midGrooveLengthPercent,
    grooveDepth: config.grooveDepth,
    millingDiameter: config.millingDiameter,
    chamferLength: config.chamferLength,
    deletedGroups: config.deletedGroups,
    vertexTransforms: new Map(config.vertexTransforms),
    addedVertices: new Map(
      config.addedVertices.map(([id, [x, y, z]]) => [id, new THREE.Vector3(x, y, z)]),
    ),
    addedFaces: config.addedFaces,
    nextAddedVertexId: config.nextAddedVertexId,
    addedEdges: config.addedEdges,
    edgeThickness: new Map(config.edgeThickness),
    deletedFaceIndices: new Set(config.deletedFaceIndices),
    deletedEdgeIndices: new Set(config.deletedEdgeIndices),
  }
}

const STORAGE_KEY = 'dome-builder-config'

export function saveConfigToLocalStorage(config: DomeConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function loadConfigFromLocalStorage(): DomeConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DomeConfig
    return parsed.version === 10 ? parsed : null
  } catch {
    return null
  }
}

// The state to start a fresh page load from: whatever was auto-saved last time, or null if
// there's nothing saved (or it's unreadable/outdated), in which case App falls back to its own
// defaults and starts on the "New" tab.
export function loadInitialState(): DomeState | null {
  const config = loadConfigFromLocalStorage()
  if (!config) return null
  try {
    return deserializeConfig(config)
  } catch {
    return null
  }
}

export function downloadConfigAsJson(config: DomeConfig, filename = 'dome-config.json'): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function readConfigFromFile(file: File): Promise<DomeConfig> {
  return file.text().then((text) => JSON.parse(text) as DomeConfig)
}
