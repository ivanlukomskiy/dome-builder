import { useMemo, useState } from 'react'

// Bounded snapshots for all editable dome data. A group (the focused field) makes a typing
// session one undo step even though each valid keystroke updates the document immediately.
export interface HistoryControls<T> {
  value: T
  commit: (next: T | ((previous: T) => T), group?: object | null) => void
  reset: (next: T) => void
  undo: () => void
  redo: () => void
  endGroup: () => void
  canUndo: boolean
  canRedo: boolean
}

export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
  group: object | null
}

export function initialHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], group: null }
}

export function commitHistory<T>(
  previous: HistoryState<T>, next: T | ((present: T) => T), maxHistory: number, group: object | null = null,
): HistoryState<T> {
  const present = typeof next === 'function' ? (next as (present: T) => T)(previous.present) : next
  if (Object.is(present, previous.present)) return previous
  return {
    past: group !== null && group === previous.group
      ? previous.past : [...previous.past, previous.present].slice(-maxHistory),
    present,
    future: [],
    group,
  }
}

export function undoHistory<T>(previous: HistoryState<T>): HistoryState<T> {
  if (previous.past.length === 0) return previous
  return {
    past: previous.past.slice(0, -1),
    present: previous.past[previous.past.length - 1],
    future: [previous.present, ...previous.future],
    group: null,
  }
}

export function redoHistory<T>(previous: HistoryState<T>): HistoryState<T> {
  if (previous.future.length === 0) return previous
  const [present, ...future] = previous.future
  return { past: [...previous.past, previous.present], present, future, group: null }
}

export function useHistory<T>(initial: T, maxHistory = 50): HistoryControls<T> {
  const [state, setState] = useState<HistoryState<T>>(() => initialHistory(initial))
  return useMemo(
    () => ({
      value: state.present,
      commit: (next: T | ((previous: T) => T), group: object | null = null) =>
        setState((previous) => commitHistory(previous, next, maxHistory, group)),
      reset: (next: T) => setState(initialHistory(next)),
      undo: () => setState(undoHistory),
      redo: () => setState(redoHistory),
      endGroup: () => setState((previous) => previous.group === null ? previous : { ...previous, group: null }),
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, maxHistory],
  )
}
