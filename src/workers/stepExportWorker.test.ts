/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { loadFont, measureVolume, setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { DEFAULT_FLANGE_SHAPE_PARAMS, DEFAULT_FOOT_PARAMS } from '../lib/flangeGeometry'
import { flangeNameKey } from '../lib/partNames'
import type { StepExportRequest } from './stepExportWorker'
import { ENGRAVING_FONT } from '../lib/stepPartSolid'

const captured = vi.hoisted(() => ({ assembly: [] as { name: string; bounds: number[][] }[], parts: [] as { bounds: number[][]; volume: number }[] }))
vi.mock('../lib/replicadCad', async importOriginal => {
  const original = await importOriginal<typeof import('../lib/replicadCad')>()
  return {
    ...original,
    ensureReplicadReady: async () => {},
    buildStepAssembly: (shapes: import('../lib/replicadCad').StepAssemblyShape[]) => {
      captured.assembly = shapes.map(({ name, shape }) => {
        const box = shape.boundingBox
        try { return { name, bounds: box.bounds } } finally { box.delete() }
      })
      return original.buildStepAssembly(shapes)
    },
  }
})
vi.mock('../lib/stepPartSolid', async importOriginal => {
  const original = await importOriginal<typeof import('../lib/stepPartSolid')>()
  return {
    ...original,
    ensureEngravingFont: async () => {},
    buildFlatStepPart: (...args: Parameters<typeof original.buildFlatStepPart>) => {
      const solid = original.buildFlatStepPart(...args)
      const box = solid.boundingBox
      try { captured.parts.push({ bounds: box.bounds, volume: measureVolume(solid) }) } finally { box.delete() }
      return solid
    },
  }
})

let build: typeof import('./stepExportWorker').buildStepExports
beforeAll(async () => {
  vi.stubGlobal('self', { postMessage: vi.fn() })
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
  const font = readFileSync(new URL('../assets/fonts/LiberationSans-Bold.ttf', import.meta.url))
  await loadFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), ENGRAVING_FONT)
  build = (await import('./stepExportWorker')).buildStepExports
}, 30_000)
afterAll(() => vi.unstubAllGlobals())

function request(mode: 'archive' | 'assembly'): StepExportRequest {
  return {
    requestId: 1, mode, strutJobs: [], braceBodies: [],
    halfWidth: 62.5, grooveDepth: 20, endGrooveLengthPercent: 15, midGrooveLengthPercent: 15,
    millingDiameter: 5, chamferLength: 4, roundStrutBridge: false,
    flangeParams: DEFAULT_FLANGE_SHAPE_PARAMS, scale: 1,
    vertices: [{
      vertexId: 42, position: [100, 200, 300],
      tangentPlane: { origin: [100, 200, 300], normal: [0, 0, 1], e1: [1, 0, 0], e2: [0, 1, 0] },
      edges: [], foot: { ...DEFAULT_FOOT_PARAMS, projectedAngleDeg: 0 },
    }],
  }
}

it('includes the foot in STEP assembly at the preview position', async () => {
  const parts = await build({ ...request('assembly'), mode: 'assembly-parts' })
  expect(parts.assemblyParts?.map(part => part.name)).toContain('foot-42.step')
  const result = await build({ ...request('assembly'), vertices: [], assemblyParts: parts.assemblyParts })
  expect(result.assemblyBlob?.size).toBeGreaterThan(0)
  const foot = captured.assembly.find(part => part.name === 'foot-42.step')
  expect(foot).toBeDefined()
  // Its extrusion follows the projected foot axis (+X), starting at holeOffset.
  expect(foot!.bounds[0][0]).toBeCloseTo(120)
  expect(foot!.bounds[1][0]).toBeCloseTo(130)
  expect((foot!.bounds[0][1] + foot!.bounds[1][1]) / 2).toBeCloseTo(200)
  expect((foot!.bounds[0][2] + foot!.bounds[1][2]) / 2).toBeCloseTo(300)
})

it('exports a flat foot file in STEP parts, with optional ID and connection engraving', async () => {
  const req = request('archive')
  captured.parts = []
  const plain = await build(req)
  expect(plain.pieces.map(part => part.name)).toContain('foot-42.step')
  const flat = captured.parts.at(-1)!
  expect(flat.bounds[0][2]).toBeCloseTo(0)
  expect(flat.bounds[1][2]).toBeCloseTo(DEFAULT_FOOT_PARAMS.thickness)
  req.engraving = {
    depth: 1, partIdLabelSize: 8, connectedPartIdLabelSize: 5,
    names: { feet: { 42: '101' }, flanges: { [flangeNameKey(42, 'outer')]: '102', [flangeNameKey(42, 'inner')]: '103' }, struts: {}, braces: {}, bracePlates: {} },
  }
  const engraved = await build(req)
  expect(engraved.pieces.map(part => part.name)).toContain('foot-42.step')
  expect(captured.parts.at(-1)!.volume).toBeLessThan(flat.volume)
}, 30_000)

it('does not add a foot for a vertex that is not marked as a foot', async () => {
  const req = request('archive')
  delete req.vertices[0].foot
  expect((await build(req)).pieces.some(part => part.name.startsWith('foot-'))).toBe(false)
})

it('constructs exported struts with the prepared shell thicknesses', async () => {
  const req = request('archive')
  req.vertices = []
  req.strutJobs = [{
    index: 1, vertexA: 0, vertexB: 1, posA: [1000, 0, 0], posB: [500, Math.sqrt(3) * 500, 0],
    offsetA: 20, offsetB: 30, cornerLengthA: 150, cornerLengthB: 180,
    beamThickness: 30, thicknessOverride: undefined, braces: { a: [], b: [] },
  }]
  captured.parts = []
  await build(req)
  const plainVolume = captured.parts.at(-1)!.volume
  Object.assign(req.strutJobs[0], { addedThicknessA: 12.5, addedThicknessB: 3.25, shellEdgeOffset: 4 })
  await build(req)
  expect(captured.parts.at(-1)!.volume).toBeGreaterThan(plainVolume)
})

it('writes the supplied dome configuration as a STEP assembly', async () => {
  const { deserializeConfig } = await import('../lib/config')
  const { applyVertexTransforms } = await import('../lib/polyhedra')
  const { computePreviewBuildInputs } = await import('../lib/previewBuildInputs')
  const config = JSON.parse(readFileSync(new URL('./fixtures/step-assembly.json', import.meta.url), 'utf8'))
  const state = deserializeConfig(config)
  const inputs = computePreviewBuildInputs({ ...state, data: state.sceneData,
    transformedVertices: applyVertexTransforms(state.sceneData.vertices, state.vertexTransforms) })
  const req: StepExportRequest = { ...state, requestId: 2, mode: 'assembly-parts', scale: 1,
    strutJobs: [], vertices: [], halfWidth: inputs.halfWidth, braceBodies: [],
    flangeParams: { ...state, millingDiameter: state.flangeMillingDiameter } }
  const assemblyParts: import('./stepExportWorker').SerializedStepShape[] = []
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  const batches = [
    ...Array.from({ length: Math.ceil(inputs.strutEntries.length / 12) }, (_, i) =>
      ({ strutJobs: inputs.strutEntries.slice(i * 12, (i + 1) * 12), vertices: [] })),
    ...Array.from({ length: Math.ceil(inputs.vertices.length / 12) }, (_, i) =>
      ({ strutJobs: [], vertices: inputs.vertices.slice(i * 12, (i + 1) * 12) })),
  ]
  // A fresh runtime per batch mirrors disposable export workers.
  for (const batch of batches) {
    setOC(await initOpenCascade({ wasmBinary }))
    const result = await build({ ...req, ...batch })
    expect(result.assemblyParts).toHaveLength(batch.strutJobs.length + batch.vertices.length * 2)
    assemblyParts.push(...result.assemblyParts!)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  setOC(await initOpenCascade({ wasmBinary }))
  const result = await build({ ...req, mode: 'assembly', assemblyParts })
  expect(result.assemblyBlob?.size).toBeGreaterThan(1_000_000)
  const text = await result.assemblyBlob!.text()
  expect(text).toContain('ISO-10303-21;')
  for (const { name } of assemblyParts) expect(text).toContain(name)
}, 300_000)
