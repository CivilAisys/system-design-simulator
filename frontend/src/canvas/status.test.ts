import { describe, expect, it } from 'vitest'
import type { NodeResult } from '@/api/client'
import { displayStatus, isIdle } from './status'

function result(read: number, write: number, status: NodeResult['status']) {
  return { arrivalRps: { read, write }, status } as NodeResult
}

describe('displayStatus', () => {
  it('未連線優先，還沒有結果時也看得出來', () => {
    expect(displayStatus(undefined, true)).toBe('UNCONNECTED')
    expect(displayStatus(result(0, 0, 'OK'), true)).toBe('UNCONNECTED')
  })

  it('有連線但到達率是 0 時是無流量，優先於 OK、未觸發、配額內', () => {
    expect(displayStatus(result(0, 0, 'OK'), false)).toBe('NO_TRAFFIC')
    expect(displayStatus(result(0, 0, 'NOT_LIMITING'), false)).toBe('NO_TRAFFIC')
    expect(displayStatus(result(0, 0, 'WITHIN_QUOTA'), false)).toBe('NO_TRAFFIC')
  })

  it('有流量時是後端的狀態', () => {
    expect(displayStatus(result(10, 0, 'WARN'), false)).toBe('WARN')
    expect(displayStatus(result(0, 5, 'OK'), false)).toBe('OK')
  })

  it('Client 沒有狀態，沒有結果時也沒有', () => {
    expect(displayStatus(result(100, 0, null), false)).toBeNull()
    expect(displayStatus(undefined, false)).toBeNull()
  })
})

describe('isIdle', () => {
  it('只有未連線和無流量是閒置', () => {
    expect(isIdle('UNCONNECTED')).toBe(true)
    expect(isIdle('NO_TRAFFIC')).toBe(true)
    expect(isIdle('OK')).toBe(false)
    expect(isIdle(null)).toBe(false)
  })
})
