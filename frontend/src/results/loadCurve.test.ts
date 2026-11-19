import { describe, expect, it } from 'vitest'
import type { SweepPoint, SweepResult } from '@/api/client'
import { curveSeries, DEFAULT_MAX_MULTIPLIER, parseMaxMultiplier, pointTooltip, referenceLines } from './loadCurve'

function point(multiplier: number, read: number | null, successRate = 1): SweepPoint {
  return {
    multiplier,
    totalRps: 1000 * multiplier,
    endToEndMs: { read, write: read },
    successRate,
    busiest: { nodeId: 'svc', utilization: multiplier / 2 },
  }
}

const NAMES: Record<string, string> = { svc: 'API', db: 'DB' }
const nodeName = (id: string) => NAMES[id] ?? id

function result(thresholds: SweepResult['thresholds']): SweepResult {
  return { valid: true, errors: [], currentRps: 1000, points: [point(0, null), point(1, 20)], thresholds }
}

describe('parseMaxMultiplier', () => {
  it('只接受 2、5、10，其他用預設值', () => {
    expect(parseMaxMultiplier('5')).toBe(5)
    expect(parseMaxMultiplier('10')).toBe(10)
    expect(parseMaxMultiplier('3')).toBe(DEFAULT_MAX_MULTIPLIER)
    expect(parseMaxMultiplier(null)).toBe(DEFAULT_MAX_MULTIPLIER)
  })
})

describe('curveSeries', () => {
  it('x 是總 rps；成功率換成百分比', () => {
    const series = curveSeries([point(1, 20, 1), point(3, null, 0.5)])

    expect(series.read).toEqual([
      [1000, 20],
      [3000, null],
    ])
    expect(series.success).toEqual([
      [1000, 100],
      [3000, 50],
    ])
  })

  it('延遲沒有定義時是 null，線斷開，不畫成 0', () => {
    expect(curveSeries([point(2.5, null)]).write).toEqual([[2500, null]])
  })
})

describe('referenceLines', () => {
  it('目前的 rps 一定有；門檻線寫節點名稱和 rps', () => {
    const lines = referenceLines(
      result({
        warn: { multiplier: 1.4, totalRps: 1400, nodeId: 'svc' },
        overload: { multiplier: 2, totalRps: 2000, nodeId: 'db' },
      }),
      nodeName,
    )

    expect(lines).toEqual([
      { kind: 'current', totalRps: 1000, label: '目前' },
      { kind: 'warn', totalRps: 1400, label: 'API ρ 0.7 @ 1,400 rps' },
      { kind: 'overload', totalRps: 2000, label: 'DB 過載 @ 2,000 rps' },
    ])
  })

  it('門檻是 null 時不畫那條線', () => {
    const lines = referenceLines(
      result({ warn: { multiplier: 1.4, totalRps: 1400, nodeId: 'svc' }, overload: null }),
      nodeName,
    )

    expect(lines.map((line) => line.kind)).toEqual(['current', 'warn'])
  })
})

describe('pointTooltip', () => {
  it('列出總 rps、read／write 延遲、成功率和 ρ 最高的節點', () => {
    expect(pointTooltip(point(1, 20.25, 0.995), nodeName)).toEqual([
      '總 rps：1,000 rps',
      'read 延遲：20.3 ms',
      'write 延遲：20.3 ms',
      '成功率：99.5%',
      'ρ 最高：API 0.50',
    ])
  })

  it('延遲沒有定義寫「—」；沒有候選節點時 ρ 也是「—」', () => {
    const lines = pointTooltip({ ...point(3, null), busiest: null }, nodeName)

    expect(lines[1]).toBe('read 延遲：—')
    expect(lines[4]).toBe('ρ 最高：—')
  })

  it('只差一點點成功時不顯示成 100%', () => {
    expect(pointTooltip(point(1, 20, 0.99999), nodeName)[3]).toBe('成功率：> 99.9%')
  })
})
