import * as THREE from 'three'
import type { Edge, Face, SceneData, SelectionMode, VertexTransform } from './polyhedra'
import { DEFAULT_BRACE_PARAMS, type Brace } from './braces'
import { downloadJson } from './download'

// A saved config captures the *result* of picking a shape in the "New" tab - the concrete,
// already-pruned vertex/face/edge data - plus every edit and view/preview setting made on top of
// it. It does not capture the shape/axis/subdivisions/layers recipe (that's only meaningful
// while still choosing a shape), which tab is active, or the undo history (session-only, not
// worth persisting).
export interface DomeConfig {
  version: 13 | 14
  // The "Adjust to a Sphere" target size in Edit, or the shape recipe's own size while still in
  // "New" - kept here (rather than left to reset to its hardcoded default) since it's live,
  // user-facing state either way.
  diameter: number
  vertices: [number, [number, number, number]][]
  edges: [number, Edge][]
  faces: [number, Face][]
  // Cross-links between two edges at a vertex (see braces.ts). Absent in version-13 configs, which
  // load with no braces.
  braces?: [number, Brace][]
  nextVertexId: number
  nextEdgeId: number
  nextFaceId: number
  nextBraceId?: number
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
  // The flat connector plate pair built at every hub vertex (see flangeGeometry.ts) - shares the
  // strut fields above (cornerLength, halfWidth from extrudeDistance, offsetModifier, groove/
  // chamfer/milling params) for its own tenon layout, plus these of its own.
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameter: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  flangeMillingDiameter: number
  vertexTransforms: [number, VertexTransform][]
  // Per-edge thickness override, in mm, keyed by edge id; absent means "use the global
  // `thickness` above".
  edgeThickness: [number, number][]
}

// The subset of App's state a config captures - plain data in, plain data out, so App can
// build one straight from its own state variables and apply one straight back onto them.
export interface DomeState {
  diameter: number
  sceneData: SceneData
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
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameter: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  flangeMillingDiameter: number
  vertexTransforms: ReadonlyMap<number, VertexTransform>
  edgeThickness: ReadonlyMap<number, number>
}

export function serializeConfig(state: DomeState): DomeConfig {
  return {
    version: 14,
    diameter: state.diameter,
    vertices: Array.from(state.sceneData.vertices.entries()).map(([id, v]) => [
      id,
      [v.x, v.y, v.z],
    ]),
    edges: Array.from(state.sceneData.edges.entries()),
    faces: Array.from(state.sceneData.faces.entries()),
    braces: Array.from(state.sceneData.braces.entries()),
    nextVertexId: state.sceneData.nextVertexId,
    nextEdgeId: state.sceneData.nextEdgeId,
    nextFaceId: state.sceneData.nextFaceId,
    nextBraceId: state.sceneData.nextBraceId,
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
    toleranceLongitudinal: state.toleranceLongitudinal,
    toleranceTransverse: state.toleranceTransverse,
    centerHoleDiameter: state.centerHoleDiameter,
    sideHoleDiameter: state.sideHoleDiameter,
    sideHoleDiameterOffset: state.sideHoleDiameterOffset,
    overshoot: state.overshoot,
    minSide: state.minSide,
    flangeMillingDiameter: state.flangeMillingDiameter,
    vertexTransforms: Array.from(state.vertexTransforms.entries()),
    edgeThickness: Array.from(state.edgeThickness.entries()),
  }
}

export function deserializeConfig(config: DomeConfig): DomeState {
  return {
    diameter: config.diameter,
    sceneData: {
      vertices: new Map(config.vertices.map(([id, [x, y, z]]) => [id, new THREE.Vector3(x, y, z)])),
      edges: new Map(config.edges),
      faces: new Map(config.faces),
      nextVertexId: config.nextVertexId,
      nextEdgeId: config.nextEdgeId,
      nextFaceId: config.nextFaceId,
      // Braces saved before a property existed get its default.
      braces: new Map(
        (config.braces ?? []).map(([id, brace]) => [
          id,
          { ...brace, params: { ...DEFAULT_BRACE_PARAMS, ...brace.params } },
        ]),
      ),
      nextBraceId: config.nextBraceId ?? 0,
    },
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
    toleranceLongitudinal: config.toleranceLongitudinal,
    toleranceTransverse: config.toleranceTransverse,
    centerHoleDiameter: config.centerHoleDiameter,
    sideHoleDiameter: config.sideHoleDiameter,
    sideHoleDiameterOffset: config.sideHoleDiameterOffset,
    overshoot: config.overshoot,
    minSide: config.minSide,
    flangeMillingDiameter: config.flangeMillingDiameter,
    vertexTransforms: new Map(config.vertexTransforms),
    edgeThickness: new Map(config.edgeThickness),
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
    // Version 13 predates braces; deserializeConfig fills in an empty set for them.
    return parsed.version === 13 || parsed.version === 14 ? parsed : null
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
  downloadJson(config, filename)
}

export function readConfigFromFile(file: File): Promise<DomeConfig> {
  return file.text().then((text) => JSON.parse(text) as DomeConfig)
}
