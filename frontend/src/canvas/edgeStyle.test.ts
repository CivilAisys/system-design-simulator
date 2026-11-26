import { describe, expect, it } from 'vitest'
import { edgeStyle } from './edgeStyle'

describe('邊的樣式', () => {
  it('非同步的邊畫成虛線', () => {
    expect(edgeStyle(false, undefined, false, 'ASYNC').strokeDasharray).toBeDefined()
  })

  it('同步的邊是實線', () => {
    expect(edgeStyle(false, undefined, false, 'SYNC').strokeDasharray).toBeUndefined()
  })

  it('平常是 1px 的軌道，選取或有驗證錯誤時加粗', () => {
    expect(edgeStyle(false, undefined, false, 'SYNC').strokeWidth).toBe(1)
    expect(edgeStyle(true, undefined, false, 'SYNC').strokeWidth).toBe(2)
    expect(edgeStyle(false, ['錯誤'], false, 'SYNC').strokeWidth).toBe(2)
  })
})
