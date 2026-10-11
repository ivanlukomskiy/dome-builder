import { afterEach, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { runStepExport, runStepAssemblyExport, type RunStepExportParams } from './stepExportRunner'
import type { StepExportRequest } from '../workers/stepExportWorker'

vi.mock('./previewBuildInputs', () => ({
  computePreviewBuildInputs: () => ({
    strutEntries: Array.from({ length: 25 }, (_, index) => ({ index })),
    vertices: Array.from({ length: 13 }, (_, vertexId) => ({ vertexId })),
    halfWidth: 62.5,
  }),
}))
vi.mock('./exportPartNames', () => ({ buildExportPartNames: () => ({ struts: {}, flanges: {}, feet: {}, braces: {}, bracePlates: {} }) }))
vi.mock('./exportProfile', () => ({ exportProfilingEnabled: () => false }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('builds bounded batches in disposable workers and writes their finished solids in a fresh worker', async () => {
  const requests: StepExportRequest[] = []
  const terminated: number[] = []
  const blob = new Blob(['assembly'])
  vi.stubGlobal('Worker', class {
    onmessage?: (event: { data: unknown }) => void
    requestId = 0
    postMessage(req: StepExportRequest) {
      this.requestId = req.requestId
      requests.push(req)
      queueMicrotask(() => this.onmessage?.({ data: {
        type: 'result', requestId: req.requestId, pieces: [], bracePoints: [],
        assemblyParts: req.mode === 'assembly-parts'
          ? [...req.strutJobs.map(job => ({ name: `strut-${job.index}`, brep: 'solid' })),
            ...req.vertices.map(vertex => ({ name: `flange-${vertex.vertexId}`, brep: 'solid' }))]
          : undefined,
        assemblyBlob: req.mode === 'assembly' ? blob : undefined,
      } }))
    }
    terminate() { terminated.push(this.requestId) }
  })
  const result = await runStepAssemblyExport({} as RunStepExportParams, vi.fn(), () => false)
  expect(result).toBe(blob)
  const batches = requests.filter(req => req.mode === 'assembly-parts')
  expect(batches).toHaveLength(5)
  for (const req of batches) expect(req.strutJobs.length + req.vertices.length).toBeLessThanOrEqual(12)
  const writer = requests.at(-1)!
  expect(writer.mode).toBe('assembly')
  expect(writer.strutJobs).toEqual([])
  expect(writer.vertices).toEqual([])
  expect(writer.assemblyParts).toHaveLength(38)
  expect(new Set(writer.assemblyParts!.map(part => part.name)).size).toBe(38)
  expect(terminated).toHaveLength(requests.length)
})

it('does not start any workers after cancellation', async () => {
  const Worker = vi.fn()
  vi.stubGlobal('Worker', Worker)
  expect(await runStepAssemblyExport({} as RunStepExportParams, vi.fn(), () => true)).toBeNull()
  expect(Worker).not.toHaveBeenCalled()
})

it.each([[true, false, false, 1], [false, false, false, 0], [true, true, false, 0], [true, false, true, 0], [true, true, true, 0]] as const)(
  'includes shell files only with shell enabled=%s and round bridge=%s and flexible=%s', async (shellEnabled, roundStrutBridge, shellFlexible, count) => {
    const requests: StepExportRequest[] = []
    // The prepared shell vertices must be used rather than the unscaled scene vertices.
    const { Vector3 } = await import('three')
    const { computePreviewBuildInputs } = await import('./previewBuildInputs')
    const prepared = computePreviewBuildInputs({} as RunStepExportParams)
    vi.spyOn(await import('./previewBuildInputs'), 'computePreviewBuildInputs').mockReturnValueOnce({
      ...prepared, strutEntries: [], vertices: [],
      shellVertices: new Map([[0, new Vector3(0, 0, 10)], [1, new Vector3(180, 0, 10)], [2, new Vector3(0, 150, 10)]]),
    })
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: unknown }) => void
      postMessage(req: StepExportRequest) {
        requests.push(req)
        queueMicrotask(() => this.onmessage?.({ data: { type: 'result', requestId: req.requestId,
          pieces: (req.shellPanels ?? []).map(panel => ({ name: `shell-${panel.faceId}.step`,
            blob: new Uint8Array([1, 2, 3]) })), bracePoints: [] } }))
      }
      terminate() {}
    })
    const params = { shellEnabled, roundStrutBridge, shellFlexible, shellThickness: 3,
      data: { faces: new Map([[7, [0, 1, 2]]]), edges: new Map([[10, [0, 1]], [20, [1, 2]], [30, [2, 0]]]) },
    } as unknown as RunStepExportParams
    const blob = await runStepExport(params, vi.fn(), () => false)
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(count ? ['shell-1.step'] : [])
    expect(requests).toHaveLength(count)
    if (count) {
      expect(requests[0].shellThickness).toBe(3)
      expect(requests[0].shellPanels![0].points).toEqual([[-60, 50], [120, 50], [-60, -100]])
    }
  },
)
