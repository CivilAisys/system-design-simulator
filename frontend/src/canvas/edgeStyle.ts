import { MarkerType, type EdgeMarker } from '@xyflow/react'
import type { EdgeKind } from './catalog'

// 非同步邊的虛線，線段和間隔的長度（px）；燈管（EdgeBeam）也用同一組
export const ASYNC_DASH = '8 6'

// 箭頭固定大小；顏色和線一致
export function arrowMarker(color?: string): EdgeMarker {
  return { type: MarkerType.ArrowClosed, markerUnits: 'userSpaceOnUse', width: 16, height: 16, color }
}

// 驗證錯誤用紅色、選取用主色，其他用 React Flow 的預設色。箭頭（Canvas 的 markerEnd）用同一個顏色
export function edgeColor(selected: boolean | undefined, hasErrors: boolean): string | undefined {
  return hasErrors ? 'var(--destructive)' : selected ? 'var(--primary)' : undefined
}

// 底下的連線只是 1px 的淡線，當燈管（EdgeBeam）的軌道；流量大小由燈管的顏色和白光表達。
// 平常用 0.6 的不透明度畫淡（只淡線、不淡箭頭）；選取、驗證錯誤時加粗到 2px、不畫淡；過期時更淡；非同步的邊畫成虛線
export function edgeStyle(
  selected: boolean | undefined,
  errors: string[] | undefined,
  stale: boolean | undefined,
  kind: EdgeKind,
) {
  return {
    stroke: edgeColor(selected, errors != null),
    strokeWidth: selected || errors ? 2 : 1,
    strokeOpacity: stale ? 0.3 : selected || errors ? 1 : 0.6,
    strokeDasharray: kind === 'ASYNC' ? ASYNC_DASH : undefined,
  }
}
