import { describe, expect, it } from 'vitest'
import { deserializeConfig, serializeConfig } from './config'

type LoadableConfig = Parameters<typeof deserializeConfig>[0]

const legacyConfig: LoadableConfig = {
  version: 16 as const,
  diameter: 1000,
  vertices: [],
  edges: [],
  faces: [],
  braces: [],
  nextVertexId: 0,
  nextEdgeId: 0,
  nextFaceId: 0,
  nextBraceId: 0,
  selectionMode: 'point' as const,
  extrudeDistance: 100,
  thickness: 20,
  cornerLength: 120,
  offsetModifier: 0,
  endGrooveLengthPercent: 25,
  midGrooveLengthPercent: 35,
  grooveDepth: 10,
  millingDiameter: 5,
  chamferLength: 4,
  toleranceLongitudinal: 2,
  toleranceTransverse: 1,
  centerHoleDiameter: 8,
  sideHoleDiameter: 7,
  sideHoleDiameterOffset: 6,
  overshoot: 0,
  minSide: 20,
  flangeMillingDiameter: 5,
  vertexTransforms: [],
  edgeThickness: [],
  vertexCornerLength: [],
  vertexFlangeParams: [[42, { sideHoleDiameter: 9, toleranceTransverse: 3 }]],
  footParams: undefined,
  footVertices: [],
}

describe('config migration', () => {
  it('copies the legacy flange side-hole diameter to outer and inner fields', () => {
    const state = deserializeConfig(legacyConfig)

    expect(state.sideHoleDiameterOuter).toBe(7)
    expect(state.sideHoleDiameterInner).toBe(7)
    expect(state.vertexFlangeParams.get(42)).toEqual({
      sideHoleDiameterOuter: 9,
      sideHoleDiameterInner: 9,
      toleranceTransverse: 3,
    })
  })

  it('serializes the split outer and inner side-hole diameters as config v17', () => {
    const state = deserializeConfig(legacyConfig)
    const config = serializeConfig({
      ...state,
      sideHoleDiameterOuter: 11,
      sideHoleDiameterInner: 13,
    })

    expect(config.version).toBe(17)
    expect(config.sideHoleDiameterOuter).toBe(11)
    expect(config.sideHoleDiameterInner).toBe(13)
    expect('sideHoleDiameter' in config).toBe(false)
  })
})
