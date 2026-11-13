import { describe, expect, it } from 'vitest'
import {
  clampResultsHeight,
  DEFAULT_RESULTS_HEIGHT,
  maxResultsHeight,
  MIN_RESULTS_HEIGHT,
  parseStoredHeight,
} from './resultsHeight'

describe('clampResultsHeight', () => {
  it('範圍內的高度取整數', () => {
    expect(clampResultsHeight(300.4, 1000)).toBe(300)
  })

  it('不低於最小高度', () => {
    expect(clampResultsHeight(10, 1000)).toBe(MIN_RESULTS_HEIGHT)
  })

  it('不超過視窗高度的 70%，畫布留得下來', () => {
    expect(clampResultsHeight(5000, 1000)).toBe(700)
  })

  it('視窗很矮時最大高度仍不低於最小高度', () => {
    expect(maxResultsHeight(100)).toBe(MIN_RESULTS_HEIGHT)
  })
})

describe('parseStoredHeight', () => {
  it('讀回存的高度', () => {
    expect(parseStoredHeight('400')).toBe(400)
  })

  it('沒有存檔或內容不合理時用預設高度', () => {
    for (const text of [null, '', 'abc', '-5', '10', 'Infinity']) {
      expect(parseStoredHeight(text)).toBe(DEFAULT_RESULTS_HEIGHT)
    }
  })
})
