import { describe, expect, it } from 'vitest'
import { edgeStyle } from './edgeStyle'

describe('邊的樣式', () => {
  it('非同步的邊畫成虛線', () => {
    expect(edgeStyle(false, undefined, undefined, false, 'ASYNC').strokeDasharray).toBeDefined()
  })

  it('同步的邊是實線', () => {
    expect(edgeStyle(false, undefined, undefined, false, 'SYNC').strokeDasharray).toBeUndefined()
  })
})
