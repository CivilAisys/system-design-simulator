import { totalRps, type HotSpot, type InstanceResult, type Node } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { formatMs, formatPercent, formatRps, formatUtilization, STALE_RESULT_NOTE } from './format'
import type { DisplayStatus } from './status'

// 機櫃最多畫幾條槽，再多台也是這麼多條，實際台數看標籤
export const MAX_RACK_SLOTS = 5

// 多台機器的節點在畫布上的機櫃：一台一條槽（最多 MAX_RACK_SLOTS 條），標籤是實際台數
export type InstanceRack = {
  instances: number
  slots: number
  label: string
}

// 沒有 instances 參數的元件（Client、Rate Limiter、External API）不畫
export function instanceRack(node: Node): InstanceRack | null {
  const instances = node.params.instances ?? 1
  if (!NODE_KINDS[node.type].numberParams.includes('instances') || instances < 2) {
    return null
  }
  return { instances, slots: Math.min(instances, MAX_RACK_SLOTS), label: `×${withCommas(instances)}` }
}

// 每條槽的狀態色：有熱點的 Cache 第一條是最熱的那台，其他條是其他台（spec 4.2.2）；沒有熱點時都是節點的狀態。
// 還沒有結果時是 null（淡灰）
export function rackSlotStatuses(
  rack: InstanceRack,
  status: DisplayStatus | null,
  hotSpot: HotSpot | null | undefined,
): (DisplayStatus | null)[] {
  return Array.from({ length: rack.slots }, (_, i) =>
    hotSpot ? (i === 0 ? hotSpot.hottest : hotSpot.others).status : status,
  )
}

// 滑鼠移到機櫃上的提示：最熱的那台和其他台各自的指標。沒有熱點時不提示，指標和節點相同。
// 過期時台數可能已經改了，和指標對不上，同 errorsTitle 先註明
export function hotSpotTitle(
  rack: InstanceRack,
  hotSpot: HotSpot | null | undefined,
  stale: boolean | undefined,
): string | undefined {
  if (!hotSpot) {
    return undefined
  }
  const others = `其他 ${withCommas(rack.instances - 1)} 台`
  const lines = [instanceLine('最熱那台', hotSpot.hottest), instanceLine(others, hotSpot.others)]
  return (stale ? [STALE_RESULT_NOTE, ...lines] : lines).join('\n')
}

function instanceLine(name: string, result: InstanceResult): string {
  const latency = result.avgLatencyMs == null ? '過載，穩態延遲無定義' : formatMs(result.avgLatencyMs)
  const arrival = formatRps(totalRps(result.arrivalRps))
  const rho = formatUtilization(result.utilization)
  return `${name}：到達率 ${arrival}・ρ ${rho}・延遲 ${latency}・丟棄 ${formatRps(result.droppedRps)}`
}

// 屬性面板機器數下方的提示
export function workersHint(instances: number, concurrency: number): string {
  const workers = withCommas(instances * concurrency)
  return `共 ${withCommas(instances)} 台 × ${withCommas(concurrency)} 並行 ＝ ${workers} 個 worker`
}

// 叢集內的從節點（Cache 的 replicas，只是標記）：節點上顯示「3 主 3 從」，沒有從節點時不顯示
export function replicaLabel(node: Node): string | null {
  const replicas = node.params.replicas ?? 0
  if (replicas <= 0) {
    return null
  }
  const instances = node.params.instances ?? 1
  return `${withCommas(instances)} 主 ${withCommas(instances * replicas)} 從`
}

// 有從節點時 workersHint 下面再一行：從節點只做備援，不算在處理流量的台數裡。沒有從節點時是 null
export function replicasHint(node: Node): string | null {
  const replicas = node.params.replicas ?? 0
  if (replicas <= 0) {
    return null
  }
  const instances = node.params.instances ?? 1
  return `另有 ${withCommas(instances * replicas)} 個從節點，共 ${withCommas(instances * (1 + replicas))} 個節點；從節點不分擔流量`
}

// 有熱點時 workersHint 下面再一行
export function hotShareHint(hotShare: number): string {
  return `最熱那台分到 ${formatPercent(hotShare)}`
}

// 台數和 worker 數加千分位（instances × concurrency 最多 1,000,000）
function withCommas(value: number): string {
  return value.toLocaleString()
}
