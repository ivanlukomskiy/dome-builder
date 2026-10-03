import type { NestingMessage, NestingRequest } from '../workers/dxfNestingWorker'
import type { NestedDxf } from './dxfNesting'

export function runDxfNesting(request: NestingRequest, onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean): Promise<NestedDxf | null> {
  if (isCancelled()) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/dxfNestingWorker.ts', import.meta.url), { type: 'module' })
    const finish = (fn: () => void) => {
      clearInterval(cancelTimer)
      clearTimeout(timeout)
      worker.terminate()
      fn()
    }
    const cancelTimer = setInterval(() => { if (isCancelled()) finish(() => resolve(null)) }, 100)
    const timeout = setTimeout(() => finish(() => reject(new Error('Sheet packing exceeded the five-minute limit. Try fewer parts or a larger sheet.'))), 5 * 60_000)
    worker.onmessage = (event: MessageEvent<NestingMessage>) => {
      if (isCancelled()) { finish(() => resolve(null)); return }
      const message = event.data
      if (message.type === 'progress') onProgress(message.done, message.total)
      else if (message.type === 'result') finish(() => resolve(message.result))
      else finish(() => reject(new Error(message.message)))
    }
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'The nesting worker failed.')))
    worker.onmessageerror = () => finish(() => reject(new Error('The nesting worker returned an unreadable result.')))
    worker.postMessage(request)
  })
}
