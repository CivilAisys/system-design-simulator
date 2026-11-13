import { MarkerType, type EdgeMarker } from '@xyflow/react'
import { edgeWidth } from './flow'

// 箭頭固定大小，不跟著依流量變粗的線一起放大；顏色和線一致
export function arrowMarker(color?: string): EdgeMarker {
  return { type: MarkerType.ArrowClosed, markerUnits: 'userSpaceOnUse', width: 16, height: 16, color }
}

// 驗證錯誤用紅色、選取用主色，其他用 React Flow 的預設色。箭頭（Canvas 的 markerEnd）用同一個顏色
export function edgeColor(selected: boolean | undefined, hasErrors: boolean): string | undefined {
  return hasErrors ? 'var(--destructive)' : selected ? 'var(--primary)' : undefined
}

// 粗細依流量；過期時畫淡（粗細和 RPS 都是上次 Run 的）
export function edgeStyle(
  selected: boolean | undefined,
  flow: number | undefined,
  errors: string[] | undefined,
  stale: boolean | undefined,
) {
  const width = flow == null ? 1 : edgeWidth(flow)
  return {
    stroke: edgeColor(selected, errors != null),
    // 選取時至少加粗到 2，細線也看得出選到的是它
    strokeWidth: selected ? Math.max(width + 1, 2) : errors ? Math.max(width, 2) : width,
    strokeOpacity: stale ? 0.3 : 1,
  }
}
