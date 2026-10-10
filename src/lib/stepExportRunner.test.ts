import { afterEach, expect, it, vi } from 'vitest'
import { runStepAssemblyExport, type RunStepExportParams } from './stepExportRunner'
import type { StepExportRequest } from '../workers/stepExportWorker'

vi.mock('./previewBuildInputs', () => ({
  computePreviewBuildInputs: () => ({
    strutEntries: Array.from({ length: 25 }, (_, index) => ({ index })),
    vertices: Array.from({ length: 13 }, (_, vertexId) => ({ vertexId })),
    halfWidth: 62.5,
  }),
}))
vi.mock('./exportProfile', () => ({ exportProfilingEnabled: () => false }))
afterEach(() => vi.unstubAllGlobals())

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
