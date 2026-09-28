// Export batches each own a fresh OpenCascade worker. Limit concurrent instances to the same
// cap as Preview, while keeping results in input order for stable file and DXF sheet ordering.
export function exportWorkerCount(): number {
  const hardwareConcurrency = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2
  return Math.max(1, Math.min(4, hardwareConcurrency - 1))
}

export async function runExportBatches<Job, Result>(
  batches: Job[][],
  total: number,
  runBatch: (batch: Job[], index: number, onBatchProgress: (done: number) => void) => Promise<Result>,
  onProgress: (done: number, total: number) => void,
  onError: (batch: Job[], error: unknown) => void,
  isCancelled: () => boolean,
): Promise<(Result | undefined)[] | null> {
  const results: (Result | undefined)[] = new Array(batches.length)
  const reported = new Array<number>(batches.length).fill(0)
  let completed = 0
  let next = 0
  onProgress(0, total)

  const runner = async () => {
    while (!isCancelled()) {
      const index = next++
      const batch = batches[index]
      if (!batch) return
      const report = (done: number) => {
        if (isCancelled()) return
        const count = Math.max(reported[index], Math.min(batch.length, done))
        if (count === reported[index]) return
        completed += count - reported[index]
        reported[index] = count
        onProgress(completed, total)
      }
      try {
        results[index] = await runBatch(batch, index, report)
        report(batch.length)
      } catch (error) {
        onError(batch, error)
        report(batch.length)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(exportWorkerCount(), batches.length) }, runner))
  return isCancelled() ? null : results
}
