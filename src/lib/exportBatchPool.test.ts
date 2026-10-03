import { afterEach, describe, expect, it, vi } from 'vitest'
import { runExportBatches } from './exportBatchPool'

afterEach(() => vi.unstubAllGlobals())

describe('runExportBatches', () => {
  it('stops new batches and waits for in-flight work before propagating a fatal error', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 })
    const started: number[] = []
    let finishOther!: () => void
    let settled = false
    const run = runExportBatches([[0], [1], [2]], 3, async ([item]) => {
      started.push(item)
      if (item === 0) throw new Error('invalid outline')
      await new Promise<void>((resolve) => { finishOther = resolve })
    }, () => {}, (_batch, error) => { throw error }, () => false)
    const outcome = run.catch((error) => { settled = true; return error })
    await Promise.resolve()
    expect(settled).toBe(false)
    finishOther()
    expect((await outcome).message).toBe('invalid outline')
    expect(started).toEqual([0, 1])
  })
  it('limits concurrent batches, reports monotonic progress, and returns input order', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 })
    const started: number[] = []
    const finishes = new Map<number, (value: number) => void>()
    const progress: number[] = []
    const run = runExportBatches(
      [[0], [1], [2], [3]],
      4,
      ([item], _index, report) => {
        started.push(item)
        return new Promise<number>((resolve) => finishes.set(item, (value) => {
          report(1)
          resolve(value)
        }))
      },
      (done) => progress.push(done),
      () => { throw new Error('Unexpected failure') },
      () => false,
    )

    expect(started).toEqual([0, 1])
    finishes.get(1)!(10)
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])
    finishes.get(2)!(20)
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3])
    finishes.get(3)!(30)
    finishes.get(0)!(0)

    expect(await run).toEqual([0, 10, 20, 30])
    expect(progress).toEqual([0, 1, 2, 3, 4])
  })

  it('stops scheduling batches after cancellation', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 })
    const started: number[] = []
    const finishes: (() => void)[] = []
    let cancelled = false
    const run = runExportBatches(
      [[0], [1], [2]],
      3,
      ([item]) => {
        started.push(item)
        return new Promise<void>((resolve) => finishes.push(resolve))
      },
      () => {},
      () => { throw new Error('Unexpected failure') },
      () => cancelled,
    )

    expect(started).toEqual([0, 1])
    cancelled = true
    finishes.forEach((finish) => finish())
    expect(await run).toBeNull()
    expect(started).toEqual([0, 1])
  })

  it('keeps successful batches when another batch fails', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 })
    const errors: number[] = []
    const results = await runExportBatches(
      [[0], [1], [2]],
      3,
      async ([item]) => {
        if (item === 1) throw new Error('failed batch')
        return item
      },
      () => {},
      ([item]) => errors.push(item),
      () => false,
    )

    expect(results).toEqual([0, undefined, 2])
    expect(errors).toEqual([1])
  })
})
