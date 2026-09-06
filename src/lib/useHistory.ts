import { useMemo, useState } from 'react'

// Generic bounded undo/redo over snapshots of a value: `commit` pushes the current value onto
// the past (capped at `maxHistory`) before replacing it and clearing any redo history; `reset`
// replaces the value without leaving anything to undo back to (a structural boundary, e.g.
// Create/Import, past which "undo" isn't meaningful). `undo`/`redo` move the pointer between
// past/present/future the standard way.
export interface HistoryControls<T> {
  value: T
  commit: (next: T) => void
  reset: (next: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export function useHistory<T>(initial: T, maxHistory = 50): HistoryControls<T> {
  const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] })

  return useMemo(
    () => ({
      value: state.present,
      commit: (next: T) =>
        setState((prev) => ({
          past: [...prev.past, prev.present].slice(-maxHistory),
          present: next,
          future: [],
        })),
      reset: (next: T) => setState({ past: [], present: next, future: [] }),
      undo: () =>
        setState((prev) => {
          if (prev.past.length === 0) return prev
          const present = prev.past[prev.past.length - 1]
          return { past: prev.past.slice(0, -1), present, future: [prev.present, ...prev.future] }
        }),
      redo: () =>
        setState((prev) => {
          if (prev.future.length === 0) return prev
          const [present, ...future] = prev.future
          return { past: [...prev.past, prev.present], present, future }
        }),
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, maxHistory],
  )
}
