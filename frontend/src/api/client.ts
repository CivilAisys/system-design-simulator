import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

export type Topology = components['schemas']['Topology']
export type Node = components['schemas']['Node']
export type NodeType = Node['type']
export type Edge = components['schemas']['Edge']
export type NodeResult = components['schemas']['NodeResult']
export type EdgeResult = components['schemas']['EdgeResult']
export type ClassRates = components['schemas']['ClassRates']
export type Status = NonNullable<NodeResult['status']>
export type SimulationResult = components['schemas']['SimulationResult']
export type Summary = NonNullable<SimulationResult['summary']>
export type ValidationError = SimulationResult['errors'][number]
// 驗證通過、有計算結果（驗證失敗時 summary 為 null，nodes／edges 是空的）
export type ComputedResult = SimulationResult & { valid: true; summary: Summary }

export function isComputed(result: SimulationResult | null): result is ComputedResult {
  return result != null && result.valid && result.summary != null
}

// read + write，畫面上顯示的 RPS 都是這個總和
export function totalRps(rates: ClassRates): number {
  return rates.read + rates.write
}

// 同一個 origin：開發時由 Vite proxy 把 /api 轉給 Spring
const client = createClient<paths>({ baseUrl: '', fetch: fetchBackend })

const UNREACHABLE_MESSAGE = '連不到後端，請確認後端是否已啟動'

// fetch 只有在連線失敗（網路錯誤、後端沒開又沒有 proxy）或被取消時才會丟例外；
// 只包這一步，回應解析失敗之類的錯誤不能說成連不到後端
async function fetchBackend(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch (e) {
    if (isAbortError(e)) throw e
    throw new Error(UNREACHABLE_MESSAGE, { cause: e })
  }
}

// 閘道類狀態碼：proxy 連不到後端（Vite 開發伺服器回 502）或後端逾時
const GATEWAY_STATUSES = new Set([502, 503, 504])

// signal 取消時丟出 AbortError（DOMException），呼叫端用 isAbortError 辨認，不當成 Run 失敗
export async function simulate(topology: Topology, signal?: AbortSignal): Promise<SimulationResult> {
  const { data, error, response } = await client.POST('/api/v1/simulate', { body: topology, signal })
  const { ok, status } = response
  if (GATEWAY_STATUSES.has(status)) {
    throw new Error(UNREACHABLE_MESSAGE)
  }
  if (!ok || error !== undefined) {
    throw new Error(problemMessage(error, status))
  }
  // 型別上成功時一定有 data，但 2xx 空 body（例如 204）時 openapi-fetch 會給 undefined
  if (data === undefined) {
    throw new Error(`Run 失敗：後端沒有回傳結果（HTTP ${status}）`)
  }
  return data
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
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
