import { describe, expect, it } from 'vitest'
import type { SweepPoint, SweepResult } from '@/api/client'
import {
  curveBands,
  curveHeadline,
  DEFAULT_MAX_MULTIPLIER,
  formatMultiplier,
  latencyAxis,
  latencyLines,
  niceCeil,
  parseMaxMultiplier,
  pointTooltip,
  successSeries,
} from './loadCurve'

function point(multiplier: number, read: number | null, successRate = 1, write = read): SweepPoint {
  return {
    multiplier,
    totalRps: 1000 * multiplier,
    endToEndMs: { read, write },
    successRate,
    busiest: { nodeId: 'svc', utilization: multiplier / 2 },
  }
}

const NAMES: Record<string, string> = { svc: 'API', db: 'DB' }
const nodeName = (id: string) => NAMES[id] ?? id

// 起始拓撲的樣子：0 rps 時 91 ms，過載（8 倍）前升到 218 ms
const POINTS = [point(0, 91), point(1, 91.2), point(5.6, 100), point(7.992, 217.8), point(8, null, 1), point(10, null, 0.8)]

function result(thresholds: SweepResult['thresholds'], points = POINTS): SweepResult {
  return { valid: true, errors: [], currentRps: 1000, points, thresholds }
}

const WARN = { multiplier: 5.6, totalRps: 5600, nodeId: 'svc' }
const OVERLOAD = { multiplier: 8, totalRps: 8000, nodeId: 'svc' }

describe('parseMaxMultiplier', () => {
  it('只接受 2、5、10，其他用預設值', () => {
    expect(parseMaxMultiplier('5')).toBe(5)
    expect(parseMaxMultiplier('10')).toBe(10)
    expect(parseMaxMultiplier('3')).toBe(DEFAULT_MAX_MULTIPLIER)
    expect(parseMaxMultiplier(null)).toBe(DEFAULT_MAX_MULTIPLIER)
  })
})

describe('latencyLines', () => {
  it('每一點的 read、write 都相同時合成一條', () => {
    const lines = latencyLines(POINTS)

    expect(lines.map((line) => line.name)).toEqual(['延遲（read、write 相同）'])
    expect(lines[0].data[0]).toEqual([0, 91])
  })

  it('有一點不同就分兩條', () => {
    const lines = latencyLines([point(0, 10), point(1, 20, 1, 25)])

    expect(lines.map((line) => line.name)).toEqual(['read 延遲', 'write 延遲'])
    expect(lines[1].data).toEqual([
      [0, 10],
      [1000, 25],
    ])
  })

  it('沒有 write 的請求時只畫 read', () => {
    expect(latencyLines([point(0, 10, 1, null), point(1, 20, 1, null)]).map((line) => line.name)).toEqual([
      'read 延遲',
    ])
  })

  it('延遲沒有定義時是 null，線斷開，不畫成 0', () => {
    expect(latencyLines(POINTS)[0].data.at(-1)).toEqual([10000, null])
  })
})

describe('successSeries', () => {
  it('x 是總 rps；成功率換成百分比', () => {
    expect(successSeries([point(1, 20, 1), point(3, null, 0.5)])).toEqual([
      [1000, 100],
      [3000, 50],
    ])
  })
})

describe('latencyAxis', () => {
  it('上限是 0 rps 延遲的 3 倍往上取整數；超過的部分標出從哪裡開始和最高值', () => {
    // 91 × 3 = 273 → 300；217.8 沒超過
    expect(latencyAxis(POINTS, latencyLines(POINTS))).toEqual({ max: 300, overflow: null })

    const points = [point(0, 10), point(1, 20), point(2, 35), point(3, 80)]
    expect(latencyAxis(points, latencyLines(points))).toEqual({ max: 30, overflow: { totalRps: 2000, peakMs: 80 } })
  })

  it('read、write 不同時，以 0 rps 時較大的那個為準', () => {
    const points = [point(0, 10, 1, 40), point(1, 20, 1, 50)]

    expect(latencyAxis(points, latencyLines(points)).max).toBe(200)
  })

  it('第一點沒有延遲時不封頂', () => {
    const points = [point(0, null), point(1, 20)]

    expect(latencyAxis(points, latencyLines(points))).toEqual({ max: undefined, overflow: null })
  })

  it('niceCeil 取到最高位數的整數倍', () => {
    expect(niceCeil(273)).toBe(300)
    expect(niceCeil(39)).toBe(40)
    expect(niceCeil(3)).toBe(3)
    expect(niceCeil(0.27)).toBe(0.3)
  })
})

describe('curveBands', () => {
  it('ρ 0.7 到過載是黃色帶，過載到最右邊是紅色帶，標籤寫節點名稱', () => {
    expect(curveBands(result({ warn: WARN, overload: { ...OVERLOAD, nodeId: 'db' } }), nodeName)).toEqual([
      { kind: 'warn', from: 5600, to: 8000, label: 'API 接近飽和（ρ ≥ 0.7）' },
      { kind: 'overload', from: 8000, to: 10000, label: 'DB 過載' },
    ])
  })

  it('沒有過載時黃色帶畫到最右邊；門檻是 null 時不畫', () => {
    expect(curveBands(result({ warn: WARN, overload: null }), nodeName)).toEqual([
      { kind: 'warn', from: 5600, to: 10000, label: 'API 接近飽和（ρ ≥ 0.7）' },
    ])
    expect(curveBands(result({ warn: null, overload: null }), nodeName)).toEqual([])
  })

  it('過載剛好落在最後一點時不畫紅色帶', () => {
    expect(curveBands(result({ warn: null, overload: { ...OVERLOAD, totalRps: 10000 } }), nodeName)).toEqual([])
  })
})

describe('formatMultiplier', () => {
  it('取兩位小數，去掉多餘的 0；0 倍寫 0', () => {
    expect(formatMultiplier(0)).toBe('0')
    expect(formatMultiplier(8)).toBe('8')
    expect(formatMultiplier(5.6)).toBe('5.6')
    expect(formatMultiplier(7.992)).toBe('7.99')
    expect(formatMultiplier(7.99996)).toBe('8')
    expect(formatMultiplier(0.35)).toBe('0.35')
    expect(formatMultiplier(0.001)).toBe('< 0.01')
  })
})

describe('curveHeadline', () => {
  it('有過載：寫過載的 rps 和倍數，以及過載前延遲從多少升到多少', () => {
    const sweep = result({ warn: WARN, overload: OVERLOAD })

    expect(curveHeadline(sweep, latencyLines(sweep.points), nodeName)).toBe(
      '流量放大到 8,000 rps（目前的 8 倍）時 API 過載；在那之前延遲從 91.0 ms 升到 217.8 ms。',
    )
  })

  it('只到 ρ 0.7：寫範圍內都沒有過載，以及從哪裡起接近飽和', () => {
    const points = [point(0, 91), point(5.6, 100), point(10, 150)]
    const sweep = result({ warn: WARN, overload: null }, points)

    expect(curveHeadline(sweep, latencyLines(points), nodeName)).toBe(
      '放大到 10,000 rps（目前的 10 倍）都沒有過載；API 從 5,600 rps（5.6 倍）起接近飽和，延遲從 91.0 ms 升到 150.0 ms。',
    )
  })

  it('兩個門檻都沒到', () => {
    const points = [point(0, 91), point(2, 92)]
    const sweep = result({ warn: null, overload: null }, points)

    expect(curveHeadline(sweep, latencyLines(points), nodeName)).toBe(
      '放大到 2,000 rps（目前的 2 倍）都沒有過載，延遲從 91.0 ms 升到 92.0 ms。',
    )
  })

  it('延遲顯示出來沒有變時寫「維持在」', () => {
    const points = [point(0, 91), point(2, 91.02)]
    const sweep = result({ warn: null, overload: null }, points)

    expect(curveHeadline(sweep, latencyLines(points), nodeName)).toBe(
      '放大到 2,000 rps（目前的 2 倍）都沒有過載，延遲維持在 91.0 ms。',
    )
  })

  it('read、write 不同時分開寫', () => {
    const points = [point(0, 10, 1, 30), point(2, 12, 1, 35)]
    const sweep = result({ warn: null, overload: null }, points)

    expect(curveHeadline(sweep, latencyLines(points), nodeName)).toBe(
      '放大到 2,000 rps（目前的 2 倍）都沒有過載，read 延遲從 10.0 ms 升到 12.0 ms、write 從 30.0 ms 升到 35.0 ms。',
    )
  })

  it('過載前 read、write 不同時，「在那之前」和 read 之間隔一格', () => {
    const points = [point(0, 10, 1, 30), point(1.9, 40, 1, 60), point(2, null)]
    const sweep = result({ warn: null, overload: { multiplier: 2, totalRps: 2000, nodeId: 'svc' } }, points)

    expect(curveHeadline(sweep, latencyLines(points), nodeName)).toBe(
      '流量放大到 2,000 rps（目前的 2 倍）時 API 過載；在那之前 read 延遲從 10.0 ms 升到 40.0 ms、write 從 30.0 ms 升到 60.0 ms。',
    )
  })

  it('目前的流量就已經過載時不說「放大」', () => {
    const points = [point(0, 10), point(0.4, 20), point(0.5, null), point(2, null)]
    const sweep = result({ warn: null, overload: { multiplier: 0.5, totalRps: 500, nodeId: 'svc' } }, points)

    expect(curveHeadline(sweep, latencyLines(points), nodeName)).toBe(
      '流量到 500 rps（目前的 0.5 倍）時 API 過載；在那之前延遲從 10.0 ms 升到 20.0 ms。',
    )
  })
})

describe('pointTooltip', () => {
  it('列出總 rps 和倍數、延遲、成功率和 ρ 最高的節點', () => {
    const p = point(4.96, 20.25, 0.995)

    expect(pointTooltip(p, latencyLines([p]), nodeName)).toEqual([
      '總 rps：4,960 rps（目前的 4.96 倍）',
      '延遲：20.3 ms',
      '成功率：99.5%',
      'ρ 最高：API 2.48',
    ])
  })

  it('read、write 分兩條時各寫一行；延遲沒有定義寫「—」，沒有候選節點時 ρ 也是「—」', () => {
    const lines = latencyLines([point(0, 10, 1, 30)])
    const tooltip = pointTooltip({ ...point(3, null), busiest: null }, lines, nodeName)

    expect(tooltip.slice(1, 3)).toEqual(['read 延遲：—', 'write 延遲：—'])
    expect(tooltip.at(-1)).toBe('ρ 最高：—')
  })

  it('只差一點點成功時不顯示成 100%', () => {
    const p = point(1, 20, 0.99999)

    expect(pointTooltip(p, latencyLines([p]), nodeName)[2]).toBe('成功率：> 99.9%')
  })
})
