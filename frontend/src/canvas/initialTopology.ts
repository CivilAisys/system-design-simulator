import type { Topology } from '@/api/client'

// walking skeleton 用的寫死拓撲，M3 之後改由使用者在畫布上組出
export const initialTopology: Topology = {
  version: 1,
  nodes: [
    {
      id: 'client-1',
      type: 'CLIENT',
      name: 'Users',
      params: { rps: 1000, readRatio: 0.9 },
      ui: { x: 0, y: 0 },
    },
    {
      id: 'svc-1',
      type: 'SERVICE',
      name: 'API',
      params: { instances: 2, concurrency: 200, serviceTimeMs: 50, callMode: 'SEQUENTIAL' },
      state: 'HEALTHY',
      ui: { x: 300, y: 0 },
    },
    {
      id: 'db-1',
      type: 'DATABASE',
      name: 'DB',
      params: { instances: 1, concurrency: 100, serviceTimeMs: 10 },
      state: 'HEALTHY',
      ui: { x: 600, y: 0 },
    },
  ],
  edges: [
    { id: 'e1', source: 'client-1', target: 'svc-1', weight: 1, callsPerRequest: 1, latencyMs: 1 },
    { id: 'e2', source: 'svc-1', target: 'db-1', weight: 1, callsPerRequest: 1, latencyMs: 1 },
  ],
}
