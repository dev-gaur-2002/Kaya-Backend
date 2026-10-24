import { describe, it, expect } from 'vitest'
import { mergeGoals } from './goals.js'

const known = new Set(['water', 'steps', 'sleep'])

describe('mergeGoals', () => {
  it('adds and removes, keeping the rest in order', () => {
    expect(mergeGoals(['water', 'steps'], ['sleep'], ['water'], known)).toEqual({
      added: ['sleep'],
      removed: ['water'],
      goals: ['steps', 'sleep'],
    })
  })

  it('is a no-op when nothing actually changes', () => {
    // Asking twice must not duplicate, and dropping something they never had
    // must not look like a change the profile screen has to re-render for.
    expect(mergeGoals(['water'], ['water'], ['sleep'], known)).toBeNull()
    expect(mergeGoals(['water'], [], [], known)).toBeNull()
  })

  it('ignores codes outside the catalogue and junk from the model', () => {
    expect(mergeGoals(['water'], ['meditation', 7, null], undefined, known)).toBeNull()
    expect(mergeGoals(['water'], 'steps', ['water'], known)).toEqual({
      added: [],
      removed: ['water'],
      goals: [],
    })
  })
})
