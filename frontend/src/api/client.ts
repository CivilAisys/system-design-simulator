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
  const { ok, status } = response
  if (!ok || error !== undefined) {
    throw new Error(problemMessage(error, status))
  }
  // 型別上成功時一定有 data，但 2xx 空 body（例如 204）時 openapi-fetch 會給 undefined
  if (data === undefined) {
    throw new Error(`Run 失敗：後端沒有回傳結果（HTTP ${status}）`)
  }
  return data
}

// 後端錯誤是 Spring 的 ProblemDetail，優先顯示 detail，其次 title
function problemMessage(error: unknown, status: number): string {
  if (typeof error === 'object' && error !== null) {
    const detail = 'detail' in error ? error.detail : undefined
    const title = 'title' in error ? error.title : undefined
    for (const value of [detail, title]) {
      if (typeof value === 'string' && value.trim() !== '') {
        return value
      }
    }
  }
  return `Run 失敗（HTTP ${status}）`
}
