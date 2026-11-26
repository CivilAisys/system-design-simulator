import type { NodeResult } from '@/api/client'

// 過載節點前後的邊（spec 第 6 節）：
// 壅塞（jam）是進入過載節點的邊，送進來的比它處理得完的多，流量堵在入口；
// 受限（starved）是從過載節點出去的邊，只拿得到它處理得完的量。
// 只看 OVERLOADED（WARN、CRITICAL 還處理得完），只標過載節點緊鄰的邊，不往更下游傳
export type Congestion = 'jam' | 'starved'

// 兩端都過載時算壅塞：流量先卡在下游的入口。沒有結果（還沒 Run、驗證錯誤）時都沒有
export function congestionOf(
  source: string,
  target: string,
  nodes: Record<string, NodeResult> | undefined,
): Congestion | undefined {
  if (nodes?.[target]?.status === 'OVERLOADED') {
    return 'jam'
  }
  if (nodes?.[source]?.status === 'OVERLOADED') {
    return 'starved'
  }
  return undefined
}
