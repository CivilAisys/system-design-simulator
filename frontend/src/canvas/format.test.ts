import { describe, expect, it } from 'vitest'
import {
  classRatesTitle,
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
  formatSuccessRate,
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

describe('classRatesTitle', () => {
  it('其中一項是 0 也照樣顯示', () => {
    expect(classRatesTitle({ read: 0, write: 50 }, false)).toBe('read 0・write 50')
  })

  it('過期時先註明', () => {
    expect(classRatesTitle({ read: 180, write: 100 }, true)).toBe('（結果已過期，按 Run 重新計算）\nread 180・write 100')
  })
})

describe('formatMs', () => {
  it('0.1 ms 以上取一位小數', () => {
    expect(formatMs(12.345)).toBe('12.3 ms')
    expect(formatMs(0.1)).toBe('0.1 ms')
  })

  it('小於 0.1 ms 取兩位有效數字，不顯示成 0.0', () => {
    expect(formatMs(0.01)).toBe('0.010 ms')
    expect(formatMs(0.0012)).toBe('0.0012 ms')
    expect(formatMs(0.04)).toBe('0.040 ms')
  })

  it('四捨五入到 0.1 的值和 0.1 用同一個格式', () => {
    expect(formatMs(0.0996)).toBe('0.1 ms')
  })

  it('0 顯示成 0 ms', () => {
    expect(formatMs(0)).toBe('0 ms')
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

describe('formatSuccessRate', () => {
  it('顯示 1 − dropRate', () => {
    expect(formatSuccessRate(0)).toBe('100.0%')
    expect(formatSuccessRate(0.005)).toBe('99.5%')
    expect(formatSuccessRate(1)).toBe('0.0%')
  })

  it('有丟棄但四捨五入成 100.0% 時不顯示 100.0%', () => {
    expect(formatSuccessRate(0.0004)).toBe('> 99.9%')
    expect(formatSuccessRate(0.0005)).toBe('> 99.9%')
    expect(formatSuccessRate(0.0006)).toBe('99.9%')
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

  it('超過 PB/s 時用科學記號', () => {
    expect(formatBytesPerSec(999e15)).toBe('999 PB/s')
    expect(formatBytesPerSec(1.234e18)).toBe('1.2e18 B/s')
    expect(formatBytesPerSec(999.7e15)).toBe('1.0e18 B/s')
  })
})

describe('formatBitsPerSec', () => {
  it('bytes 乘 8 換成 bps', () => {
    expect(formatBitsPerSec(90_000_000)).toBe('720 Mbps')
    expect(formatBitsPerSec(1.9e9)).toBe('15.2 Gbps')
    expect(formatBitsPerSec(100)).toBe('800 bps')
  })

  it('超過 Pbps 時用科學記號', () => {
    expect(formatBitsPerSec(2e18)).toBe('1.6e19 bps')
    // bytes 還在 PB/s 以內，乘 8 之後才超過
    expect(formatBitsPerSec(125e15)).toBe('1.0e18 bps')
  })
})

describe('formatBytes', () => {
  it('用十進位單位換算到 PB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(17_280_000_000)).toBe('17.3 GB')
    expect(formatBytes(6.3e15)).toBe('6.30 PB')
  })

  it('超過 PB 時用科學記號', () => {
    expect(formatBytes(2e24)).toBe('2.0e24 B')
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
