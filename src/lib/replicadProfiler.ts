import * as replicad from 'replicad'
import type { ReplicadStat } from './previewProfile'

// Worker-only, opt-in (see previewProfile.ts): wraps every method of every replicad class so that
// each call's duration is recorded, both inclusive and self (minus nested replicad calls). The
// heavy lifting happens inside opencascade WASM calls made from these methods, so a method's self
// time is effectively its WASM time. Recursive methods double-count `incl`; `self` is exact.

const stats: Record<string, ReplicadStat> = {}
const stack: { child: number }[] = []
let installed = false

function wrap(label: string, fn: (...args: unknown[]) => unknown) {
  return function (this: unknown, ...args: unknown[]) {
    const t0 = performance.now()
    const frame = { child: 0 }
    stack.push(frame)
    try {
      return fn.apply(this, args)
    } finally {
      stack.pop()
      const dt = performance.now() - t0
      const s = (stats[label] ??= { n: 0, incl: 0, self: 0 })
      s.n++
      s.incl += dt
      s.self += dt - frame.child
      if (stack.length > 0) stack[stack.length - 1].child += dt
    }
  }
}

function patch(target: object, className: string, skip: string[]) {
  for (const key of Object.getOwnPropertyNames(target)) {
    if (skip.includes(key)) continue
    const desc = Object.getOwnPropertyDescriptor(target, key)
    if (!desc || typeof desc.value !== 'function' || !desc.writable) continue
    Object.defineProperty(target, key, {
      ...desc,
      value: wrap(`${className}.${key}`, desc.value as (...args: unknown[]) => unknown),
    })
  }
}

export function installReplicadProfiler(): void {
  if (installed) return
  installed = true
  for (const [name, value] of Object.entries(replicad as Record<string, unknown>)) {
    if (typeof value !== 'function' || !value.prototype) continue
    patch(value.prototype as object, name, ['constructor'])
    patch(value, `${name}(static)`, ['length', 'name', 'prototype'])
  }
}

export function snapshotReplicadStats(): Record<string, ReplicadStat> {
  return JSON.parse(JSON.stringify(stats)) as Record<string, ReplicadStat>
}
