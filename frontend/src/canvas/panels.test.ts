import { describe, expect, it } from 'vitest'
import { parseStoredFlag, scrollFade } from './panels'

describe('parseStoredFlag', () => {
  it('讀回存的狀態', () => {
    expect(parseStoredFlag('true', false)).toBe(true)
    expect(parseStoredFlag('false', true)).toBe(false)
  })

  it('沒有存檔或內容不對時用預設值', () => {
    expect(parseStoredFlag(null, true)).toBe(true)
    expect(parseStoredFlag('yes', false)).toBe(false)
  })
})

describe('scrollFade', () => {
  it('內容放得下時上下都沒有漸層', () => {
    expect(scrollFade(0, 500, 500)).toEqual({ top: false, bottom: false })
  })

  it('在最上面時只有下方漸層', () => {
    expect(scrollFade(0, 300, 500)).toEqual({ top: false, bottom: true })
  })

  it('捲到中間時上下都有漸層', () => {
    expect(scrollFade(100, 300, 500)).toEqual({ top: true, bottom: true })
  })

  it('捲到底時下方漸層消失，容許 1px 的小數誤差', () => {
    expect(scrollFade(199.5, 300, 500)).toEqual({ top: true, bottom: false })
  })
})
