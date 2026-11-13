import type { ValidationError } from '@/api/client'

// 驗證錯誤的訊息依節點／邊的 id 分組，畫布用來加紅框（節點和邊的 id 可能相同，分開放）
export type ErrorsById = { nodes: Map<string, string[]>; edges: Map<string, string[]> }

// 滑鼠移到有錯誤的節點上時顯示。stale 時拓撲在那次 Run 之後改過，錯誤可能已經修好
export function errorsTitle(messages: string[], stale: boolean | undefined): string {
  return (stale ? ['（結果已過期，按 Run 重新檢查）', ...messages] : messages).join('\n')
}

export function groupErrors(errors: ValidationError[]): ErrorsById {
  const grouped: ErrorsById = { nodes: new Map(), edges: new Map() }
  for (const { nodeId, edgeId, message } of errors) {
    if (nodeId != null) append(grouped.nodes, nodeId, message)
    if (edgeId != null) append(grouped.edges, edgeId, message)
  }
  return grouped
}

function append(map: Map<string, string[]>, id: string, message: string) {
  map.set(id, [...(map.get(id) ?? []), message])
}
