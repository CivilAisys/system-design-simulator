import { describe, expect, it } from 'vitest'
import { DASH, formatMs, formatOptionalRps, formatPercent, formatRps, formatUtilization } from './format'

describe('formatRps', () => {
  it('四捨五入成整數', () => {
    expect(formatRps(0)).toBe('0 rps')
    expect(formatRps(0.5)).toBe('1 rps')
    expect(formatRps(99.4)).toBe('99 rps')
  })

  it('不到 0.5 的正數不顯示成 0', () => {
    expect(formatRps(0.0001)).toBe('< 1 rps')
    expect(formatRps(0.49)).toBe('< 1 rps')
  })

  it('加上千分位', () => {
    // 分隔符號跟著執行環境的語系
    expect(formatRps(1_234_567.8)).toBe(`${(1_234_568).toLocaleString()} rps`)
  })

  it('null 顯示成 —', () => {
    expect(formatOptionalRps(null)).toBe(DASH)
    expect(formatOptionalRps(undefined)).toBe(DASH)
    expect(formatOptionalRps(0.2)).toBe('< 1 rps')
  })
})

describe('formatMs', () => {
  it('取一位小數', () => {
    expect(formatMs(12.345)).toBe('12.3 ms')
    expect(formatMs(0)).toBe('0.0 ms')
    expect(formatMs(0.04)).toBe('0.0 ms')
  })

  it('null 顯示成 —', () => {
    expect(formatMs(null)).toBe(DASH)
    expect(formatMs(undefined)).toBe(DASH)
  })
})

describe('formatUtilization', () => {
  it('取兩位小數', () => {
    expect(formatUtilization(0.856)).toBe('0.86')
    expect(formatUtilization(0)).toBe('0.00')
    expect(formatUtilization(1.5)).toBe('1.50')
  })

  it('null 顯示成 —', () => {
    expect(formatUtilization(null)).toBe(DASH)
    expect(formatUtilization(undefined)).toBe(DASH)
  })
})

describe('formatPercent', () => {
  it('比例換成一位小數的百分比', () => {
    expect(formatPercent(1)).toBe('100.0%')
    expect(formatPercent(0.9876)).toBe('98.8%')
    expect(formatPercent(0.0004)).toBe('0.0%')
  })
})
