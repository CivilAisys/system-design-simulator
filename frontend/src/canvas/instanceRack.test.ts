import { describe, expect, it } from 'vitest'
import type { Node, NodeType } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { instanceRack, workersHint } from './instanceRack'

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
    expect(instanceRack(node('SERVICE', { instances: 2 }))).toEqual({ slots: 2, label: '×2' })
    expect(instanceRack(node('SERVICE', { instances: 5 }))).toEqual({ slots: 5, label: '×5' })
  })

  it('超過 5 台仍是 5 條槽，標籤加千分位', () => {
    expect(instanceRack(node('SERVICE', { instances: 6 }))).toEqual({ slots: 5, label: '×6' })
    expect(instanceRack(node('SERVICE', { instances: 200 }))).toEqual({ slots: 5, label: '×200' })
    expect(instanceRack(node('SERVICE', { instances: 5000 }))).toEqual({ slots: 5, label: '×5,000' })
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

describe('workersHint', () => {
  it('列出台數、並行數和 worker 總數', () => {
    expect(workersHint(2, 180)).toBe('共 2 台 × 180 並行 ＝ 360 個 worker')
  })

  it('大數字加千分位', () => {
    expect(workersHint(1000, 1000)).toBe('共 1,000 台 × 1,000 並行 ＝ 1,000,000 個 worker')
  })
})
