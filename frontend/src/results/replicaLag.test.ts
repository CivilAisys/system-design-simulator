import { describe, expect, it } from 'vitest'
import type { NodeResult, NodeWarning, Topology } from '@/api/client'
import { hasLaggingReplica } from './replicaLag'

function replica(warnings: NodeWarning[]): NodeResult {
  return {
    arrivalRps: { read: 600, write: 400 },
    throughputRps: 500,
    droppedRps: 500,
    rejectedRps: 0,
    successRps: null,
    endToEndMs: null,
    capacityRps: 500,
    utilization: 2,
    avgQueueMs: null,
    avgLatencyMs: null,
    status: 'OVERLOADED',
    hotSpot: null,
    warnings,
  }
}

// primary 複製到 r1、r2；other 是另一個 Database
const topology: Topology = {
  version: 1,
  nodes: [],
  edges: [
    { id: 'e1', source: 'db', target: 'r1', weight: 1, callsPerRequest: 1, latencyMs: 0, requestClass: 'ALL' },
    { id: 'e2', source: 'db', target: 'r2', weight: 1, callsPerRequest: 1, latencyMs: 0, requestClass: 'ALL' },
  ],
}

describe('hasLaggingReplica', () => {
  it('任何一個 replica 複製跟不上就是 true', () => {
    expect(hasLaggingReplica(topology, { r1: replica([]), r2: replica(['REPLICATION_LAG']) }, 'db')).toBe(true)
  })

  it('replica 都跟得上、別的 Database 或還沒有結果時是 false', () => {
    expect(hasLaggingReplica(topology, { r1: replica([]), r2: replica([]) }, 'db')).toBe(false)
    expect(hasLaggingReplica(topology, { r1: replica(['REPLICATION_LAG']) }, 'other')).toBe(false)
    expect(hasLaggingReplica(topology, {}, 'db')).toBe(false)
  })
})
