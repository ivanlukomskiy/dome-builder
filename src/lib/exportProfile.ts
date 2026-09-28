// Lightweight, opt-in timings for DXF and STEP exports. Unlike Preview's detailed replicad
// profiler, this does not wrap the millions of low-level curve calls it is trying to measure.
export interface ExportStageStat {
  calls: number
  ms: number
}

export interface ExportWorkerProfile {
  initMs: number
  buildMs: number
  stages: Record<string, ExportStageStat>
}

export interface ExportBatchProfile {
  phase: string
  items: number
  createToReadyMs: number
  readyToResultMs: number
  worker?: ExportWorkerProfile
}

export function exportProfilingEnabled(): boolean {
  return new URLSearchParams(self.location.search).has('profile')
}

export function createExportStageProfiler() {
  const stages: Record<string, ExportStageStat> = {}
  return {
    time<T>(stage: string, fn: () => T): T {
      const start = performance.now()
      try {
        return fn()
      } finally {
        const stat = (stages[stage] ??= { calls: 0, ms: 0 })
        stat.calls++
        stat.ms += performance.now() - start
      }
    },
    snapshot(initMs: number, buildMs: number): ExportWorkerProfile {
      return { initMs, buildMs, stages }
    },
  }
}

export function publishExportProfile(
  kind: 'dxf' | 'stepArchive' | 'stepAssembly',
  startedAt: number,
  batches: ExportBatchProfile[],
  mainStages: Record<string, number> = {},
): void {
  const stages: Record<string, ExportStageStat> = {}
  for (const batch of batches) {
    for (const [name, stat] of Object.entries(batch.worker?.stages ?? {})) {
      const total = (stages[name] ??= { calls: 0, ms: 0 })
      total.calls += stat.calls
      total.ms += stat.ms
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10
  const report = {
    summary: {
      wallMs: round(performance.now() - startedAt),
      batches: batches.length,
      workerStartupMs: round(batches.reduce((sum, b) => sum + b.createToReadyMs, 0)),
      workerWasmInitMs: round(batches.reduce((sum, b) => sum + (b.worker?.initMs ?? 0), 0)),
      workerBuildMs: round(batches.reduce((sum, b) => sum + (b.worker?.buildMs ?? 0), 0)),
    },
    stages: Object.entries(stages)
      .map(([stage, stat]) => ({ stage, calls: stat.calls, totalMs: round(stat.ms) }))
      .sort((a, b) => b.totalMs - a.totalMs),
    mainStages: Object.entries(mainStages).map(([stage, ms]) => ({ stage, totalMs: round(ms) })),
    batches: batches.map((b) => ({
      phase: b.phase,
      items: b.items,
      createToReadyMs: round(b.createToReadyMs),
      readyToResultMs: round(b.readyToResultMs),
      wasmInitMs: round(b.worker?.initMs ?? 0),
      workerBuildMs: round(b.worker?.buildMs ?? 0),
    })),
  }
  ;(window as unknown as Record<string, unknown>)[`__${kind}Profile`] = report
  console.groupCollapsed(`[${kind}-profile] done — copy window.__${kind}Profile`)
  console.log(report)
  console.groupEnd()
}
