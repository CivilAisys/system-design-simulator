import type { components } from '@/api/schema'
import type { Topology } from '@/api/client'

export type EndToEndLatency = components['schemas']['EndToEndLatency']
export type ClassLatencies = components['schemas']['ClassLatencies']

export type RequestClass = keyof ClassLatencies
export const REQUEST_CLASSES: RequestClass[] = ['read', 'write']

// ms 為 null 時的說明（spec 4.3）。路徑、過載節點和原因都由後端判斷，這裡只把 id 換成名稱
export function undefinedReasonText(latency: EndToEndLatency, requestClass: RequestClass, topology: Topology): string {
  switch (latency.undefinedReason) {
    case 'OVERLOADED': {
      // 結果可能比目前畫布舊一點（Auto-run 還在 debounce），節點被刪掉時退回顯示 id
      const names = latency.overloadedNodeIds.map((id) => topology.nodes.find((node) => node.id === id)?.name ?? id)
      return `${names.join('、')} 過載，穩態延遲無定義`
    }
    case 'NO_DOWNSTREAM':
      return '路徑上有元件沒有接到下游'
    case 'NO_TRAFFIC':
      return `沒有 ${requestClass} 請求`
    default:
      return '穩態延遲無定義'
  }
}
