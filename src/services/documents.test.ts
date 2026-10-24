import { describe, it, expect } from 'vitest'
import { sniff } from './documents.js'

/**
 * This is the gate in front of storage and the vision model, and it exists
 * because the client's MIME type is forgeable. A false 'image' sends arbitrary
 * bytes to the model; a false null rejects a report the user can actually read.
 */

const pdf = Buffer.from('%PDF-1.7\nrest of a document')
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
])
const heic = Buffer.concat([
  Buffer.alloc(4),
  Buffer.from('ftypheic', 'latin1'),
  Buffer.alloc(16),
])

describe('sniff', () => {
  it.each([
    ['PDF', pdf, 'pdf'],
    ['JPEG', jpeg, 'image'],
    ['PNG', png, 'image'],
    ['HEIC, which is what an iPhone photo actually is', heic, 'image'],
  ])('accepts %s', (_name, buf, expected) => {
    expect(sniff(buf as Buffer)).toBe(expected)
  })

  it.each([
    ['a text file', Buffer.from('hello, this is not a report')],
    ['an empty buffer', Buffer.alloc(0)],
    ['a zip, which is where a disguised payload would hide', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['a PDF header that is not at the start', Buffer.concat([Buffer.alloc(4), pdf])],
  ])('rejects %s', (_name, buf) => {
    expect(sniff(buf)).toBeNull()
  })
})
