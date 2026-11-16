import type { Node } from '@/api/client'
import { NODE_KINDS } from './catalog'

// 機櫃最多畫幾條槽，再多台也是這麼多條，實際台數看標籤
export const MAX_RACK_SLOTS = 5

// 多台機器的節點在畫布上的機櫃：一台一條槽（最多 MAX_RACK_SLOTS 條），標籤是實際台數
export type InstanceRack = {
  slots: number
  label: string
}

// shards 是畫布上的分片數（含 Read Replica 沿用 primary 的）。分片的節點已經畫成 cluster 格子，先不畫機櫃；
// 沒有 instances 參數的元件（Client、Rate Limiter、External API）也不畫
export function instanceRack(node: Node, shards: number): InstanceRack | null {
  const instances = node.params.instances ?? 1
  if (!NODE_KINDS[node.type].numberParams.includes('instances') || shards > 1 || instances < 2) {
    return null
  }
  return { slots: Math.min(instances, MAX_RACK_SLOTS), label: `×${withCommas(instances)}` }
}

// 屬性面板機器數下方的提示；分片時 instances、concurrency 是每個 shard 的（spec 4.2.2）
export function workersHint(instances: number, concurrency: number, shards: number): string {
  const workers = withCommas(instances * concurrency)
  const total = `共 ${withCommas(instances)} 台 × ${withCommas(concurrency)} 並行 ＝ ${workers} 個 worker`
  return shards > 1 ? `每個 shard ${total}` : total
}

// 台數和 worker 數加千分位（instances × concurrency 最多 1,000,000）
function withCommas(value: number): string {
  return value.toLocaleString()
}
