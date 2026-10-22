import { describe, it, expect } from 'vitest'
import { usernameToEmail } from './demoAuth.js'

/**
 * The username IS the account key, so two spellings of one name must not become
 * two accounts — and a name that slugs to nothing must not become everyone's.
 */
describe('usernameToEmail', () => {
  it('collapses spelling differences to one account', () => {
    const asha = usernameToEmail('asha')
    expect(asha).toBe('asha@kaya.demo')
    for (const variant of ['Asha', ' asha ', 'ASHA', 'Asha!']) {
      expect(usernameToEmail(variant)).toBe(asha)
    }
  })

  it('keeps distinct names distinct', () => {
    expect(usernameToEmail('Asha Rao')).toBe('asha-rao@kaya.demo')
    expect(usernameToEmail('Asha Rao')).not.toBe(usernameToEmail('Asha'))
  })

  it('rejects a name with nothing to slug rather than inventing one', () => {
    for (const bad of ['', '   ', '!!!', '—', 'a'.repeat(41)]) {
      expect(usernameToEmail(bad)).toBeNull()
    }
  })
})
