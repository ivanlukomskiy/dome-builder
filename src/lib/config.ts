import type { Edge, Face, SceneData, SelectionMode, VertexTransform } from './polyhedra'
import { DEFAULT_BRACE_PARAMS, type Brace } from './braces'
import { DEFAULT_FOOT_PARAMS, type FlangeShapeParams, type FootParams } from './flangeGeometry'
import { downloadJson } from './download'

// A saved config captures the *result* of picking a shape in the "New" tab - the concrete,
// already-pruned vertex/face/edge data - plus every edit and view/preview setting made on top of
// it. It does not capture the shape/axis/subdivisions/layers recipe (that's only meaningful
// while still choosing a shape), which tab is active, or the undo history (session-only, not
// worth persisting).
export interface DomeConfig {
  version: 16
  // The dome's sphere diameter in mm (SceneData.diameter).
  diameter: number
  // Polar coordinates about the origin: [r (mm), azimuth (rad), elevation (rad)] - see PolarCoord.
  vertices: [number, [number, number, number]][]
  edges: [number, Edge][]
  faces: [number, Face][]
  // Cross-links between two edges at a vertex (see braces.ts).
  braces?: [number, Brace][]
  nextVertexId: number
  nextEdgeId: number
  nextFaceId: number
  nextBraceId?: number
  selectionMode: SelectionMode
  extrudeDistance: number
  thickness: number
  cornerLength: number
  // Added to every edge-end's computed minOffset (see computeVertexHubMetrics) before it's
  // applied in Preview - a global fudge factor, in mm, to push every strut end further from
  // (positive) or closer to (negative) its vertex than the raw miter math calls for. 0 means no
  // change.
  offsetModifier: number
  // Shouldered tenon cut into each strut end (see computeStrutBoundary's groove/mill
  // params in strutGeometry.ts).
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
  // Per-vertex corner length override, in mm, keyed by vertex id; absent means "use the global
  // `cornerLength` above". Missing in configs older than version 15.
  vertexCornerLength?: [number, number][]
  // Per-vertex overrides of any flange parameter, keyed by vertex id (only the overridden ones are
  // present). Missing in configs saved before this existed.
  vertexFlangeParams?: [number, Partial<FlangeShapeParams>][]
  // The global foot dimensions, and the ids of the vertices marked as feet (see flangeGeometry.ts's
  // FootParams). Missing in configs saved before this existed.
  footParams?: FootParams
  footVertices?: number[]
}

// The subset of App's state a config captures - plain data in, plain data out, so App can
// build one straight from its own state variables and apply one straight back onto them.
export interface DomeState {
  sceneData: SceneData
  selectionMode: SelectionMode
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
  vertexCornerLength: ReadonlyMap<number, number>
  vertexFlangeParams: ReadonlyMap<number, Partial<FlangeShapeParams>>
  footParams: FootParams
  footVertices: ReadonlySet<number>
}

export function serializeConfig(state: DomeState): DomeConfig {
  return {
    version: 16,
    diameter: state.sceneData.diameter,
    vertices: Array.from(state.sceneData.vertices.entries()).map(([id, v]) => [
      id,
      [v.r, v.azimuth, v.elevation],
    ]),
    edges: Array.from(state.sceneData.edges.entries()),
    faces: Array.from(state.sceneData.faces.entries()),
    braces: Array.from(state.sceneData.braces.entries()),
    nextVertexId: state.sceneData.nextVertexId,
    nextEdgeId: state.sceneData.nextEdgeId,
    nextFaceId: state.sceneData.nextFaceId,
    nextBraceId: state.sceneData.nextBraceId,
    selectionMode: state.selectionMode,
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
    vertexCornerLength: Array.from(state.vertexCornerLength.entries()),
    vertexFlangeParams: Array.from(state.vertexFlangeParams.entries()),
    footParams: state.footParams,
    footVertices: Array.from(state.footVertices),
  }
}

export function deserializeConfig(config: DomeConfig): DomeState {
  return {
    sceneData: {
      diameter: config.diameter,
      vertices: new Map(config.vertices.map(([id, [r, azimuth, elevation]]) => [id, { r, azimuth, elevation }])),
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
    vertexCornerLength: new Map(config.vertexCornerLength ?? []),
    vertexFlangeParams: new Map(config.vertexFlangeParams ?? []),
    footParams: { ...DEFAULT_FOOT_PARAMS, ...config.footParams },
    footVertices: new Set(config.footVertices ?? []),
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
    return parsed.version === 16 ? parsed : null
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
