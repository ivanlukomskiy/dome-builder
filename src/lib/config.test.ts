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
  it('round-trips shell panel positions and rotations without losing face IDs', () => {
    const shellLayout = new Map([[7, { x: 123.5, y: -200, rotation: 37.25 }], [11, { x: -50, y: 100, rotation: -90 }]])
    const config = serializeConfig({ ...deserializeConfig(legacyConfig), shellLayout, shellStitches: new Set([20]) })
    const restored = deserializeConfig(JSON.parse(JSON.stringify(config)))
    expect(restored.shellLayout).toEqual(shellLayout)
    expect(restored.shellStitches).toEqual(new Set([20]))
    expect(deserializeConfig(legacyConfig).shellStitches.size).toBe(0)
    expect(deserializeConfig(legacyConfig).shellLayout.size).toBe(0)
  })

  it.each([0, 2.5])('preserves shell thickness %s through save and load', thickness => {
    const state = { ...deserializeConfig(legacyConfig), shellThickness: thickness }
    expect(deserializeConfig(serializeConfig(state)).shellThickness).toBe(thickness)
  })

  it('preserves shell enablement through save and load', () => {
    const state = { ...deserializeConfig(legacyConfig), shellEnabled: true }
    expect(deserializeConfig(serializeConfig(state)).shellEnabled).toBe(true)
  })

  it('copies the legacy flange side-hole diameter to outer and inner fields', () => {
    const state = deserializeConfig(legacyConfig)

    expect(state.sideHoleDiameterOuter).toBe(7)
    expect(state.sideHoleDiameterInner).toBe(7)
    expect(state.roundStrutBridge).toBe(true)
    expect(state.shellEnabled).toBe(false)
    expect(state.shellThickness).toBe(2)
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


describe('DXF label settings', () => {
  it('defaults old configs to unpacked DXF and preserves sheet settings', () => {
    const state = deserializeConfig(legacyConfig)
    expect(state.dxfSheetSettings.arrangeOnSheet).toBe(false)
    expect(state.dxfSheetSettings.parts.struts).toBe(true)
    expect(state.dxfSheetSettings.parts.shell).toBe(true)
    expect(state.dxfSheetSettings.rotationStep).toBe(90)
    const settings = { parts: { ...state.dxfSheetSettings.parts, struts: false, flanges: false }, arrangeOnSheet: true, width: 2000, height: 1000, margin: 12, spacing: 3, rotationStep: 30 as const }
    expect(deserializeConfig(serializeConfig({ ...state, dxfSheetSettings: settings })).dxfSheetSettings).toEqual(settings)
  })
  it('migrates frame/shell category choices to individual parts', () => {
    const state = deserializeConfig({ ...legacyConfig, dxfSheetSettings: { includeFrameParts: false, includeShellParts: true } })
    expect(state.dxfSheetSettings.parts).toEqual({ flanges: false, struts: false, braces: false, bracePlates: false, foot: false, shell: true })
    const partial = deserializeConfig({ ...legacyConfig, dxfSheetSettings: { parts: { foot: false } } })
    expect(partial.dxfSheetSettings.parts.foot).toBe(false)
    expect(partial.dxfSheetSettings.parts.struts).toBe(true)
  })
  it('defaults old configs to the original text sizes and preserves custom sizes', () => {
    const state = deserializeConfig(legacyConfig)
    expect(state.partIdLabelSize).toBe(8)
    expect(state.connectedPartIdLabelSize).toBe(5)
    const restored = deserializeConfig(serializeConfig({
      ...state, partIdLabelSize: 12, connectedPartIdLabelSize: 7,
    }))
    expect(restored.partIdLabelSize).toBe(12)
    expect(restored.connectedPartIdLabelSize).toBe(7)
  })
})


describe('STEP engraving settings', () => {
  it('defaults older projects to labels off and depth 1 mm, and round trips edits', () => {
    const state = deserializeConfig(legacyConfig)
    expect(state.stepExportSettings).toEqual({ addLabels: false, depth: 1, partIdLabelSize: 8, connectedPartIdLabelSize: 5 })
    const stepExportSettings = { addLabels: true, depth: 0.75, partIdLabelSize: 10, connectedPartIdLabelSize: 6 }
    expect(deserializeConfig(serializeConfig({ ...state, stepExportSettings })).stepExportSettings).toEqual(stepExportSettings)
  })
})
