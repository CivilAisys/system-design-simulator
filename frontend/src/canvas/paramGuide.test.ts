import { describe, expect, it } from 'vitest'
import type { NodeType } from '@/api/client'
import { canFeed, NEW_DISK_GB, newEdgeLatencyMs, NODE_KINDS, NODE_TYPES } from './catalog'
import { edgeParamGuide, formatGuideRange, GUIDES, nodeParamGuide } from './paramGuide'
import type { NodeNumberParam } from './params'

function guidedNodeParams(type: NodeType): string[] {
  const { numberParams, choiceParams, hasDisk, hasHotShare } = NODE_KINDS[type]
  return [
    ...numberParams,
    ...choiceParams,
    ...(hasDisk ? ['diskGbPerInstance'] : []),
    ...(hasHotShare ? ['hotShare'] : []),
  ]
}

// 沒有下游的 type 畫布上沒有出邊，edgeParams 用不到
function guidedEdgeParams(type: NodeType): string[] {
  const { hasOutput, edgeParams, edgeChoiceParams } = NODE_KINDS[type]
  return hasOutput ? [...edgeParams, ...edgeChoiceParams] : []
}

// 能畫出來的每一種邊
const EDGE_TYPES = NODE_TYPES.flatMap((source) =>
  NODE_TYPES.filter((target) => NODE_KINDS[source].hasOutput && NODE_KINDS[target].hasInput && canFeed(source, target)).map(
    (target) => [source, target] as const,
  ),
)

describe('參數說明', () => {
  it.each(NODE_TYPES)('%s 屬性面板的每個參數剛好都有說明', (type) => {
    expect(Object.keys(GUIDES[type].node).sort()).toEqual(guidedNodeParams(type).sort())
    expect(Object.keys(GUIDES[type].edge).sort()).toEqual(guidedEdgeParams(type).sort())
  })

  it.each(NODE_TYPES)('%s 的預設值落在常見範圍內', (type) => {
    const { defaults, numberParams, hasDisk } = NODE_KINDS[type]
    const values: [NodeNumberParam, number][] = numberParams.map((param) => [param, defaults[param]!])
    if (hasDisk) {
      values.push(['diskGbPerInstance', NEW_DISK_GB])
    }
    for (const [param, value] of values) {
      const range = nodeParamGuide(type, param)?.range
      if (range) {
        expect({ param, inRange: value >= range.min && value <= range.max }).toEqual({ param, inRange: true })
      }
    }
  })

  it.each(EDGE_TYPES)('新建的 %s → %s 邊的延遲落在常見範圍內', (source, target) => {
    const range = edgeParamGuide(source, target, 'latencyMs')?.range
    if (range) {
      const latency = newEdgeLatencyMs(source, target)
      expect(latency).toBeGreaterThanOrEqual(range.min)
      expect(latency).toBeLessThanOrEqual(range.max)
    }
  })

  it('連到 External API 的邊用覆寫的說明', () => {
    expect(edgeParamGuide('SERVICE', 'EXTERNAL_API', 'latencyMs')?.range).toEqual({ min: 10, max: 100 })
    expect(edgeParamGuide('SERVICE', 'DATABASE', 'latencyMs')?.range).toEqual({ min: 0.1, max: 2 })
    // 沒有覆寫的參數照樣用 source 的說明
    expect(edgeParamGuide('SERVICE', 'EXTERNAL_API', 'callsPerRequest')).toBe(GUIDES.SERVICE.edge.callsPerRequest)
  })
})

describe('formatGuideRange', () => {
  it('數字加千分位，最後接單位', () => {
    expect(formatGuideRange({ min: 10, max: 200 }, 'ms')).toBe('10–200 ms')
    expect(formatGuideRange({ min: 1_000, max: 50_000 }, undefined)).toBe(`${(1_000).toLocaleString()}–${(50_000).toLocaleString()}`)
    expect(formatGuideRange({ min: 0.005, max: 0.1 }, 'ms')).toBe('0.005–0.1 ms')
  })

  it('bytes 換成 KB、MB，兩端各自帶單位', () => {
    expect(formatGuideRange({ min: 1_000, max: 1_000_000 }, 'bytes')).toBe('1 KB–1 MB')
    expect(formatGuideRange({ min: 100, max: 100_000 }, 'bytes')).toBe('100 B–100 KB')
  })
})
