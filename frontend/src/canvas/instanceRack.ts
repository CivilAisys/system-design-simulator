import { totalRps, type HotSpot, type InstanceResult, type Node, type Status } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { formatMs, formatPercent, formatRps, formatUtilization } from './format'

// 機櫃最多畫幾條槽，再多台也是這麼多條，實際台數看標籤
export const MAX_RACK_SLOTS = 5

// 多台機器的節點在畫布上的機櫃：一台一條槽（最多 MAX_RACK_SLOTS 條），標籤是實際台數
export type InstanceRack = {
  slots: number
  label: string
}

// 沒有 instances 參數的元件（Client、Rate Limiter、External API）不畫
export function instanceRack(node: Node): InstanceRack | null {
  const instances = node.params.instances ?? 1
  if (!NODE_KINDS[node.type].numberParams.includes('instances') || instances < 2) {
    return null
  }
  return { slots: Math.min(instances, MAX_RACK_SLOTS), label: `×${withCommas(instances)}` }
}

// 每條槽的狀態色：有熱點的 Cache 第一條是最熱的那台，其他條是其他台（spec 4.2.2）；沒有熱點時都是節點的狀態。
// 還沒有結果時是 null（淡灰）
export function rackSlotStatuses(
  rack: InstanceRack,
  status: Status | null,
  hotSpot: HotSpot | null | undefined,
): (Status | null)[] {
  return Array.from({ length: rack.slots }, (_, i) =>
    hotSpot ? (i === 0 ? hotSpot.hottest : hotSpot.others).status : status,
  )
}

// 滑鼠移到機櫃上的提示：最熱的那台和其他台各自的指標。沒有熱點時不提示，指標和節點相同
export function hotSpotTitle(hotSpot: HotSpot | null | undefined, instances: number): string | undefined {
  if (!hotSpot) {
    return undefined
  }
  const others = `其他 ${withCommas(instances - 1)} 台`
  return [instanceLine('最熱那台', hotSpot.hottest), instanceLine(others, hotSpot.others)].join('\n')
}

function instanceLine(name: string, result: InstanceResult): string {
  const latency = result.avgLatencyMs == null ? '過載，無定義' : formatMs(result.avgLatencyMs)
  const arrival = formatRps(totalRps(result.arrivalRps))
  const rho = formatUtilization(result.utilization)
  return `${name}：到達率 ${arrival}・ρ ${rho}・延遲 ${latency}・丟棄 ${formatRps(result.droppedRps)}`
}

// 屬性面板機器數下方的提示；有熱點時加上最熱那台分到的比例
export function workersHint(instances: number, concurrency: number, hotShare?: number): string {
  const workers = withCommas(instances * concurrency)
  const total = `共 ${withCommas(instances)} 台 × ${withCommas(concurrency)} 並行 ＝ ${workers} 個 worker`
  return hotShare === undefined ? total : `${total}，最熱那台分到 ${formatPercent(hotShare)}`
}

// 台數和 worker 數加千分位（instances × concurrency 最多 1,000,000）
function withCommas(value: number): string {
  return value.toLocaleString()
}
