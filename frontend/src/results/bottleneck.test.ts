import { describe, expect, it } from 'vitest'
import type { NodeResult } from '@/api/client'
import { describeBottleneck } from './bottleneck'

const topology = { nodes: [{ id: 'db', type: 'DATABASE', name: 'Orders DB' }] } as Parameters<
  typeof describeBottleneck
>[0]

function result(bottleneckNodeId: string | null, utilization: number | null, status: NodeResult['status']) {
  return { summary: { bottleneckNodeId }, nodes: { db: { utilization, status } } }
}

describe('describeBottleneck', () => {
  it('後端沒挑瓶頸時是 none', () => {
    expect(describeBottleneck(topology, result(null, null, null))).toEqual({ kind: 'none' })
  })

  it('ρ 達到 0.7（WARN 以上）才稱為瓶頸', () => {
    expect(describeBottleneck(topology, result('db', 0.7, 'WARN'))).toEqual({
      kind: 'bottleneck',
      name: 'Orders DB',
      utilization: 0.7,
    })
    expect(describeBottleneck(topology, result('db', 1.2, 'OVERLOADED')).kind).toBe('bottleneck')
  })

  it('ρ 低於 0.7 時是無瓶頸，列出最忙的節點', () => {
    expect(describeBottleneck(topology, result('db', 0.01, 'OK'))).toEqual({
      kind: 'calm',
      name: 'Orders DB',
      utilization: 0.01,
    })
  })

  it('所有節點的 ρ 都是 0 時只說無瓶頸', () => {
    expect(describeBottleneck(topology, result('db', 0, 'OK'))).toEqual({ kind: 'idle' })
  })

  it('節點已經從畫布刪掉時用 id 當名稱', () => {
    expect(describeBottleneck({ nodes: [] }, result('db', 0.5, 'OK'))).toEqual({
      kind: 'calm',
      name: 'db',
      utilization: 0.5,
    })
  })
})
