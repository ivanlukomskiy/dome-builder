/// <reference lib="webworker" />
import createNesting from '../vendor/libnest2d/nesting.js'
import wasmUrl from '../vendor/libnest2d/nesting.wasm?url'
import { nestDxfParts, type NestedDxf } from '../lib/dxfNesting'
import type { DxfLayoutOptions, DxfPart } from '../lib/dxf'
import type { DxfSheetSettings } from '../lib/dxfSheetSettings'

declare const self: DedicatedWorkerGlobalScope
export interface NestingRequest { parts: DxfPart[]; options: DxfLayoutOptions; settings: DxfSheetSettings }
export type NestingMessage = { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: NestedDxf } | { type: 'error'; message: string }

self.onmessage = async (event: MessageEvent<NestingRequest>) => {
  try {
    const engine = await createNesting({ locateFile: () => wasmUrl })
    const { parts, options, settings } = event.data
    const result = nestDxfParts(parts, options, settings, engine, (done, total) => {
      self.postMessage({ type: 'progress', done, total } satisfies NestingMessage)
    })
    self.postMessage({ type: 'result', result } satisfies NestingMessage)
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The nesting engine failed to arrange the parts.' } satisfies NestingMessage)
  }
}
