// Opt-in profiling of the Preview build. Open the app with `?profile` in the URL
// (e.g. http://localhost:5173/dome-builder/?profile), switch to Preview, and when the build ends a
// report is logged to the console (`[preview-profile]`) and stored on `window.__previewProfile`.
// It is plain JSON, so it can be copy-pasted. Nothing here runs unless the flag is set.

// Per replicad method: call count, inclusive ms (including nested replicad calls) and self ms
// (excluding them). Self time is where the time actually goes - for a method that mostly calls
// into opencascade it's the WASM time.
export interface ReplicadStat {
  n: number
  incl: number
  self: number
}

export interface StageStat {
  n: number
  ms: number
}

// One strut's / flange vertex's cost, to spot outliers.
export interface ProfiledItem {
  kind: 'strut' | 'flange'
  id: number
  boundaryMs: number
  solidMs: number
}

// Everything one worker measured about its own batch.
export interface WorkerProfile {
  // `ensureReplicadReady()` inside the worker: loading + instantiating the WASM module.
  initMs: number
  // From the end of init to just before the result message is posted.
  buildMs: number
  stages: Record<string, StageStat>
  items: ProfiledItem[]
  replicad: Record<string, ReplicadStat> | null
}

export function isPreviewProfilingEnabled(): boolean {
  try {
    return new URLSearchParams(self.location.search).has('profile')
  } catch {
    return false
  }
}

export interface WorkerProfiler {
  // Runs `fn`, adds its duration to stage `label`, and remembers it in `lastMs`.
  time<T>(label: string, fn: () => T): T
  lastMs: number
  stages: Record<string, StageStat>
  items: ProfiledItem[]
}

export function createWorkerProfiler(): WorkerProfiler {
  const profiler: WorkerProfiler = {
    lastMs: 0,
    stages: {},
    items: [],
    time<T>(label: string, fn: () => T): T {
      const t0 = performance.now()
      try {
        return fn()
      } finally {
        const ms = performance.now() - t0
        profiler.lastMs = ms
        const stage = (profiler.stages[label] ??= { n: 0, ms: 0 })
        stage.n++
        stage.ms += ms
      }
    },
  }
  return profiler
}

// ---- main-thread side -------------------------------------------------------------------------

interface BatchRecord {
  phase: 'struts' | 'flanges' | 'foot'
  items: number
  // worker constructed -> its 'ready' message (script load + module eval + WASM init)
  createToReadyMs: number
  // 'ready' -> 'result' received on the main thread (includes structured-clone/transfer)
  readyToResultMs: number
  worker: WorkerProfile | null
}

const round = (n: number) => Math.round(n * 10) / 10

export interface PreviewProfileRecorder {
  // Times a main-thread step (cheap inputs, brace solids, geometry merge, ...).
  mainStep<T>(label: string, fn: () => T): T
  addBatch(batch: BatchRecord): void
  finish(meta: Record<string, number>): void
}

export function createPreviewProfileRecorder(): PreviewProfileRecorder {
  const startedAt = performance.now()
  const batches: BatchRecord[] = []
  const main: Record<string, StageStat> = {}

  return {
    mainStep<T>(label: string, fn: () => T): T {
      const t0 = performance.now()
      try {
        return fn()
      } finally {
        const stage = (main[label] ??= { n: 0, ms: 0 })
        stage.n++
        stage.ms += performance.now() - t0
      }
    },

    addBatch(batch) {
      batches.push(batch)
    },

    finish(meta) {
      const wallMs = performance.now() - startedAt

      const stages: Record<string, StageStat> = {}
      const replicad: Record<string, ReplicadStat> = {}
      const items: ProfiledItem[] = []
      let workerInit = 0
      let workerBuild = 0
      let createToReady = 0
      let readyToResult = 0
      for (const b of batches) {
        createToReady += b.createToReadyMs
        readyToResult += b.readyToResultMs
        if (!b.worker) continue
        workerInit += b.worker.initMs
        workerBuild += b.worker.buildMs
        for (const [k, v] of Object.entries(b.worker.stages)) {
          const s = (stages[k] ??= { n: 0, ms: 0 })
          s.n += v.n
          s.ms += v.ms
        }
        for (const [k, v] of Object.entries(b.worker.replicad ?? {})) {
          const r = (replicad[k] ??= { n: 0, incl: 0, self: 0 })
          r.n += v.n
          r.incl += v.incl
          r.self += v.self
        }
        items.push(...b.worker.items)
      }

      const stageRows = Object.entries(stages)
        .map(([stage, s]) => ({ stage, calls: s.n, totalMs: round(s.ms), avgMs: round(s.ms / s.n) }))
        .sort((a, b) => b.totalMs - a.totalMs)
      const mainRows = Object.entries(main)
        .map(([step, s]) => ({ step, calls: s.n, totalMs: round(s.ms) }))
        .sort((a, b) => b.totalMs - a.totalMs)
      const replicadRows = Object.entries(replicad)
        .map(([method, r]) => ({ method, calls: r.n, selfMs: round(r.self), inclMs: round(r.incl) }))
        .sort((a, b) => b.selfMs - a.selfMs)
        .slice(0, 25)
      const slowest = [...items]
        .sort((a, b) => b.boundaryMs + b.solidMs - (a.boundaryMs + a.solidMs))
        .slice(0, 10)
        .map((i) => ({ ...i, boundaryMs: round(i.boundaryMs), solidMs: round(i.solidMs) }))
      const batchRows = batches.map((b, i) => ({
        batch: i + 1,
        phase: b.phase,
        items: b.items,
        createToReadyMs: round(b.createToReadyMs),
        wasmInitMs: round(b.worker?.initMs ?? 0),
        workerBuildMs: round(b.worker?.buildMs ?? 0),
        readyToResultMs: round(b.readyToResultMs),
      }))

      const report = {
        summary: {
          ...meta,
          batches: batches.length,
          wallMs: round(wallMs),
          // Sums over batches - batches run concurrently on a worker pool (see poolSize), so these
          // can exceed wallMs. Worker startup = createToReady (includes wasmInit).
          workerStartupMs: round(createToReady),
          workerWasmInitMs: round(workerInit),
          workerBuildMs: round(workerBuild),
          readyToResultMs: round(readyToResult),
          mainThreadMs: round(Object.values(main).reduce((a, s) => a + s.ms, 0)),
        },
        batches: batchRows,
        workerStages: stageRows,
        mainSteps: mainRows,
        replicadTopSelf: replicadRows,
        slowestItems: slowest,
      }

      ;(window as unknown as { __previewProfile?: unknown }).__previewProfile = report
      console.groupCollapsed('[preview-profile] done - expand, or copy window.__previewProfile')
      console.log('summary', report.summary)
      console.table(batchRows)
      console.table(stageRows)
      console.table(mainRows)
      console.table(replicadRows)
      console.table(slowest)
      console.log('[preview-profile] JSON:', JSON.stringify(report))
      console.groupEnd()
    },
  }
}
