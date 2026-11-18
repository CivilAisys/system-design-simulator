import { describe, expect, it } from 'vitest'
import type { HotSpot, InstanceResult, Node, NodeType, Status } from '@/api/client'
import { NODE_KINDS } from './catalog'
import {
  hotShareHint,
  hotSpotTitle,
  instanceRack,
  rackSlotStatuses,
  replicaLabel,
  replicasHint,
  workersHint,
} from './instanceRack'

function node(type: NodeType, params: Node['params'] = {}): Node {
  return {
    id: 'n',
    type,
    name: 'n',
    params: { ...NODE_KINDS[type].defaults, ...params },
    state: 'HEALTHY',
    ui: { x: 0, y: 0 },
  }
}

describe('instanceRack', () => {
  it('1 台不畫機櫃、不顯示標籤', () => {
    expect(instanceRack(node('SERVICE', { instances: 1 }))).toBeNull()
  })

  it('一台一條槽，標籤是實際台數', () => {
    expect(instanceRack(node('SERVICE', { instances: 2 }))).toEqual({ instances: 2, slots: 2, label: '×2' })
    expect(instanceRack(node('SERVICE', { instances: 5 }))).toEqual({ instances: 5, slots: 5, label: '×5' })
  })

  it('超過 5 台仍是 5 條槽，標籤加千分位', () => {
    expect(instanceRack(node('SERVICE', { instances: 6 }))).toEqual({ instances: 6, slots: 5, label: '×6' })
    expect(instanceRack(node('SERVICE', { instances: 200 }))).toEqual({ instances: 200, slots: 5, label: '×200' })
    expect(instanceRack(node('SERVICE', { instances: 5000 }))).toEqual({ instances: 5000, slots: 5, label: '×5,000' })
  })

  it('能設定機器數的元件都畫機櫃', () => {
    const types: NodeType[] = [
      'LOAD_BALANCER',
      'SERVICE',
      'CACHE',
      'CDN',
      'DATABASE',
      'READ_REPLICA',
      'OBJECT_STORAGE',
      'MESSAGE_QUEUE',
    ]
    for (const type of types) {
      expect(instanceRack(node(type, { instances: 2 })), type).not.toBeNull()
    }
  })

  it('沒有 instances 參數的元件不畫，即使 JSON 裡有這個欄位', () => {
    for (const type of ['CLIENT', 'RATE_LIMITER', 'EXTERNAL_API'] as const) {
      expect(instanceRack(node(type, { instances: 5 })), type).toBeNull()
    }
  })
})

function instance(read: number, utilization: number, status: Status, avgLatencyMs: number | null): InstanceResult {
  const throughputRps = Math.min(read, read / utilization)
  return { arrivalRps: { read, write: 0 }, throughputRps, droppedRps: read - throughputRps, utilization, avgLatencyMs, status }
}

// Redis Cluster 3 台、hotShare 0.5：最熱那台過載，其他 2 台還很閒
const hotSpot: HotSpot = {
  hottest: instance(125_000, 1.25, 'OVERLOADED', null),
  others: instance(125_000, 0.625, 'OK', 0.012),
}

const rack = { instances: 3, slots: 3, label: '×3' }

describe('rackSlotStatuses', () => {
  
  it('有熱點時第一條是最熱的那台，其他條是其他台', () => {
    expect(rackSlotStatuses(rack, 'OVERLOADED', hotSpot)).toEqual(['OVERLOADED', 'OK', 'OK'])
  })

  it('沒有熱點時都是節點的狀態，還沒有結果時是 null', () => {
    expect(rackSlotStatuses(rack, 'WARN', null)).toEqual(['WARN', 'WARN', 'WARN'])
    expect(rackSlotStatuses(rack, null, undefined)).toEqual([null, null, null])
  })
})

describe('hotSpotTitle', () => {
  it('列出最熱那台和其他台的指標', () => {
    expect(hotSpotTitle(rack, hotSpot, false)).toBe(
      [
        '最熱那台：到達率 125,000 rps・ρ 1.25・延遲 過載，穩態延遲無定義・丟棄 25,000 rps',
        '其他 2 台：到達率 125,000 rps・ρ 0.63・延遲 0.012 ms・丟棄 0 rps',
      ].join('\n'),
    )
  })

  it('沒有熱點時不提示', () => {
    expect(hotSpotTitle(rack, null, false)).toBeUndefined()
  })

  it('結果過期時先註明', () => {
    expect(hotSpotTitle(rack, hotSpot, true)?.split('\n')[0]).toBe('（結果已過期，按 Run 重新計算）')
  })
})

describe('replicaLabel', () => {
  it('有從節點時顯示幾主幾從', () => {
    expect(replicaLabel(node('CACHE', { instances: 3, replicas: 1 }))).toBe('3 主 3 從')
    expect(replicaLabel(node('CACHE', { instances: 2, replicas: 2 }))).toBe('2 主 4 從')
  })

  it('沒有從節點、或沒有 replicas 參數的元件不顯示', () => {
    expect(replicaLabel(node('CACHE', { instances: 3 }))).toBeNull()
    expect(replicaLabel(node('DATABASE', { instances: 3 }))).toBeNull()
  })
})

describe('workersHint', () => {
  it('列出台數、並行數和 worker 總數', () => {
    expect(workersHint(2, 180)).toBe('共 2 台 × 180 並行 ＝ 360 個 worker')
  })

  it('大數字加千分位', () => {
    expect(workersHint(1000, 1000)).toBe('共 1,000 台 × 1,000 並行 ＝ 1,000,000 個 worker')
  })

  it('有從節點時另一行列出總節點數', () => {
    expect(replicasHint(3, 1)).toBe('另有 3 個從節點，共 6 個節點；從節點不分擔流量')
  })

  it('有熱點時另一行列出最熱那台分到的比例', () => {
    expect(hotShareHint(0.5)).toBe('最熱那台分到 50.0%')
  })
})
