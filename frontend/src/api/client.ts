import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

export type Topology = components['schemas']['Topology']
export type Node = components['schemas']['Node']
export type NodeType = Node['type']
export type NodeResult = components['schemas']['NodeResult']
export type EdgeResult = components['schemas']['EdgeResult']
export type Status = NonNullable<NodeResult['status']>
export type SimulationResult = components['schemas']['SimulationResult']

// 同一個 origin：開發時由 Vite proxy 把 /api 轉給 Spring
const client = createClient<paths>({ baseUrl: '' })

export async function simulate(topology: Topology): Promise<SimulationResult> {
  const { data, error, response } = await client.POST('/api/v1/simulate', {
    body: topology,
  })
  if (data === undefined) {
    throw new Error(`Run 失敗（HTTP ${response.status}）${error ? `：${JSON.stringify(error)}` : ''}`)
  }
  return data
}
