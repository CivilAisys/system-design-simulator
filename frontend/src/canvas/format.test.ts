import { describe, expect, it } from 'vitest'
import {
  DASH,
  formatBitsPerSec,
  formatBytes,
  formatBytesPerSec,
  formatClassRates,
  formatDays,
  formatMs,
  formatOptionalRps,
  formatPercent,
  formatRps,
  formatUtilization,
} from './format'

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

describe('formatClassRates', () => {
  it('read、write 分開，取整數、不帶單位', () => {
    expect(formatClassRates({ read: 180.4, write: 100 })).toBe('read 180・write 100')
  })

  it('不到 0.5 的正數和 formatRps 一樣不顯示成 0', () => {
    expect(formatClassRates({ read: 0.2, write: 0 })).toBe('read < 1・write 0')
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

describe('formatBytesPerSec', () => {
  it('用十進位單位，保留 3 位有效數字', () => {
    expect(formatBytesPerSec(0)).toBe('0 B/s')
    expect(formatBytesPerSec(512)).toBe('512 B/s')
    expect(formatBytesPerSec(1_500)).toBe('1.50 KB/s')
    expect(formatBytesPerSec(90_000_000)).toBe('90.0 MB/s')
    expect(formatBytesPerSec(1.806e9)).toBe('1.81 GB/s')
    expect(formatBytesPerSec(123_400_000_000_000)).toBe('123 TB/s')
  })

  it('四捨五入到 1000 時換下一個單位', () => {
    expect(formatBytesPerSec(999.7)).toBe('1.00 KB/s')
    expect(formatBytesPerSec(999_700)).toBe('1.00 MB/s')
  })

  it('超過最大單位時不再換算', () => {
    expect(formatBytesPerSec(2e18)).toBe('2000 PB/s')
  })
})

describe('formatBitsPerSec', () => {
  it('bytes 乘 8 換成 bps', () => {
    expect(formatBitsPerSec(90_000_000)).toBe('720 Mbps')
    expect(formatBitsPerSec(1.9e9)).toBe('15.2 Gbps')
    expect(formatBitsPerSec(100)).toBe('800 bps')
  })
})

describe('formatBytes', () => {
  it('用十進位單位換算到 YB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(17_280_000_000)).toBe('17.3 GB')
    expect(formatBytes(6.3e15)).toBe('6.30 PB')
    expect(formatBytes(2e24)).toBe('2.00 YB')
  })
})

describe('formatDays', () => {
  it('不到 1 天不顯示成 0', () => {
    expect(formatDays(0.2)).toBe('不到 1 天')
  })

  it('100 天以內保留一位小數，之後四捨五入，前面加「約」', () => {
    expect(formatDays(16.53)).toBe('約 16.5 天')
    expect(formatDays(1234.6)).toBe(`約 ${(1235).toLocaleString()} 天`)
  })
})
