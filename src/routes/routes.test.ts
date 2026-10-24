import { describe, it, expect } from 'vitest'
import { router } from './index.js'

// The one thing that silently breaks: if /conversations/latest is declared
// after /conversations/:id/messages... it still matches, but a reordering that
// puts a bare /conversations/:id above it would swallow 'latest' as a uuid.
describe('conversation routes', () => {
  const paths = router.stack.flatMap((l) => (l.route ? [l.route.path as string] : []))

  it('declares /conversations/latest before any /conversations/:id route', () => {
    const latest = paths.indexOf('/conversations/latest')
    const byId = paths.findIndex((p) => p.startsWith('/conversations/:id'))
    expect(latest).toBeGreaterThanOrEqual(0)
    expect(latest).toBeLessThan(byId)
  })
})
