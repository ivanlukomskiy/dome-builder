import type { NestingEngine } from '../../lib/dxfNesting'

export default function createNesting(options?: {
  locateFile?: (filename: string) => string
  wasmBinary?: Uint8Array
}): Promise<NestingEngine>
