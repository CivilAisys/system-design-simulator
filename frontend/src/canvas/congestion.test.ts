import { describe, expect, it } from 'vitest'
import type { NodeResult, Status } from '@/api/client'
import { congestionOf } from './congestion'

function nodes(statuses: Record<string, Status>): Record<string, NodeResult> {
  return Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status } as NodeResult]))
}

describe('過載節點前後的邊', () => {
  it('進入過載節點的邊是壅塞', () => {
    expect(congestionOf('a', 'b', nodes({ a: 'OK', b: 'OVERLOADED' }))).toBe('jam')
  })

  it('離開過載節點的邊是受限', () => {
    expect(congestionOf('a', 'b', nodes({ a: 'OVERLOADED', b: 'OK' }))).toBe('starved')
  })

  it('兩端都過載時算壅塞', () => {
    expect(congestionOf('a', 'b', nodes({ a: 'OVERLOADED', b: 'OVERLOADED' }))).toBe('jam')
  })

  it.each<Status>(['WARN', 'CRITICAL'])('只有 %s 時不處理', (status) => {
    expect(congestionOf('a', 'b', nodes({ a: status, b: status }))).toBeUndefined()
  })

  it('沒有結果時沒有', () => {
    expect(congestionOf('a', 'b', undefined)).toBeUndefined()
    expect(congestionOf('a', 'b', {})).toBeUndefined()
  })
})
