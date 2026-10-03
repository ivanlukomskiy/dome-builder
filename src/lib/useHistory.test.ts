import { describe, expect, it } from 'vitest'
import { commitHistory, initialHistory, redoHistory, undoHistory } from './useHistory'

describe('document history', () => {
  it('groups consecutive updates from one field into a single undo step', () => {
    const field = {}
    let history = initialHistory({ diameter: 100, thickness: 20 })
    history = commitHistory(history, (doc) => ({ ...doc, diameter: 120 }), 50, field)
    history = commitHistory(history, (doc) => ({ ...doc, diameter: 125 }), 50, field)
    expect(history.past).toHaveLength(1)
    expect(undoHistory(history).present).toEqual({ diameter: 100, thickness: 20 })
    expect(redoHistory(undoHistory(history)).present.diameter).toBe(125)
  })

  it('starts a new step after the field group ends and clears redo on a fresh edit', () => {
    const field = {}
    let history = initialHistory(1)
    history = commitHistory(history, 2, 50, field)
    history = { ...history, group: null }
    history = commitHistory(history, 3, 50, field)
    history = undoHistory(history)
    expect(history.present).toBe(2)
    history = commitHistory(history, 4, 50)
    expect(history.future).toEqual([])
    expect(history.past).toEqual([1, 2])
  })

  it('resets history for a new or loaded dome', () => {
    const changed = commitHistory(initialHistory('old'), 'edited', 50)
    const reset = initialHistory('loaded')
    expect(changed.past).toEqual(['old'])
    expect(undoHistory(reset)).toBe(reset)
  })
})
