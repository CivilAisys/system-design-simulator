import { describe, expect, it } from 'vitest'
import type { Node, NodeType } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { instanceStack, workersHint } from './instanceStack'

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

describe('instanceStack', () => {
  it('1 台不疊、不顯示標籤', () => {
    expect(instanceStack(node('SERVICE', { instances: 1 }), 1)).toBeNull()
  })

  it('2 台疊 1 層，標籤 ×2', () => {
    expect(instanceStack(node('SERVICE', { instances: 2 }), 1)).toEqual({ layers: 1, label: '×2' })
  })

  it('3 台以上疊 2 層，標籤是實際台數', () => {
    expect(instanceStack(node('SERVICE', { instances: 3 }), 1)).toEqual({ layers: 2, label: '×3' })
    expect(instanceStack(node('SERVICE', { instances: 10 }), 1)).toEqual({ layers: 2, label: '×10' })
    expect(instanceStack(node('SERVICE', { instances: 200 }), 1)).toEqual({ layers: 2, label: '×200' })
  })

  it('能設定機器數的元件都會疊', () => {
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
      expect(instanceStack(node(type, { instances: 2 }), 1), type).not.toBeNull()
    }
  })

  it('沒有 instances 參數的元件不疊，即使 JSON 裡有這個欄位', () => {
    for (const type of ['CLIENT', 'RATE_LIMITER', 'EXTERNAL_API'] as const) {
      expect(instanceStack(node(type, { instances: 5 }), 1), type).toBeNull()
    }
  })

  it('分片的節點畫成 cluster 格子，不疊', () => {
    expect(instanceStack(node('DATABASE', { instances: 3, shards: 4 }), 4)).toBeNull()
    // Read Replica 沿用 primary 的分片
    expect(instanceStack(node('READ_REPLICA', { instances: 3 }), 4)).toBeNull()
  })
})

describe('workersHint', () => {
  it('列出台數、並行數和 worker 總數', () => {
    expect(workersHint(2, 180, 1)).toBe('共 2 台 × 180 並行 ＝ 360 個 worker')
  })

  it('分片時是每個 shard 的', () => {
    expect(workersHint(2, 100, 3)).toBe('每個 shard 共 2 台 × 100 並行 ＝ 200 個 worker')
  })
})
