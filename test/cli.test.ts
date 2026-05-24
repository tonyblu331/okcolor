import { describe, it, expect } from 'vitest'
import { auditCss } from '../src/engine/index.js'

describe('CLI integration', () => {
  it('audit counts colors correctly', () => {
    const stats = auditCss('color: #ff0000; background: rgb(0, 255, 0); border: 1px solid red;')
    expect(stats.legacy_count).toBe(3)
    expect(stats.hex_count).toBe(1)
    expect(stats.rgb_count).toBe(1)
    expect(stats.named_count).toBe(1)
  })
})
