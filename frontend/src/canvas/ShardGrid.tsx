import { totalRps, type ShardResult } from '@/api/client'
import { cn } from '@/lib/utils'
import { formatMs, formatRps, formatUtilization } from './format'
import { STATUS_CELL } from './status'

type ShardGridProps = {
  count: number
  // Run 之前、或結果的 shard 數和現在的參數不同（改了 shards 還沒重算）時沒有
  shards?: ShardResult[] | null
  stale?: boolean
}

// 一行最多 8 格：64 個 shard 是 8 × 8，節點不會變得太寬
const MAX_COLUMNS = 8
// 匯入的檔案可能帶著超出範圍的 shards（錯誤留給 Run 回報），格子最多畫到上限
const MAX_CELLS = 64

// 分片節點的 cluster 外觀（spec 第 6 節）：每格是一個 shard，依它的狀態上色，最熱的在第一格。
// 格子只是顯示，不能單獨選取；點下去選的是整個節點
export function ShardGrid({ count: requested, shards, stale }: ShardGridProps) {
  const count = Math.min(Math.floor(requested), MAX_CELLS)
  const results = shards?.length === count ? shards : undefined
  // 平均分配時每格一樣，第一格不算「最熱」
  const hottest = results != null && results.length > 1 && totalRps(results[0].arrivalRps) > totalRps(results[1].arrivalRps)
  return (
    <div
      className={cn('mt-2 grid w-fit gap-0.5', stale && 'opacity-30')}
      style={{ gridTemplateColumns: `repeat(${Math.min(count, MAX_COLUMNS)}, 0.75rem)` }}
    >
      {Array.from({ length: count }, (_, i) => {
        const shard = results?.[i]
        return (
          <div
            key={i}
            title={shardTitle(i, shard, hottest)}
            className={cn('size-3 rounded-sm', shard ? STATUS_CELL[shard.status] : 'bg-muted-foreground/25')}
          />
        )
      })}
    </div>
  )
}

function shardTitle(index: number, shard: ShardResult | undefined, hottest: boolean): string {
  const name = `shard ${index + 1}${index === 0 && hottest ? '（最熱）' : ''}`
  if (!shard) {
    return name
  }
  return [
    name,
    `到達率 ${formatRps(totalRps(shard.arrivalRps))}`,
    `ρ ${formatUtilization(shard.utilization)}`,
    `延遲 ${shard.avgLatencyMs == null ? '過載，無定義' : formatMs(shard.avgLatencyMs)}`,
    `丟棄 ${formatRps(shard.droppedRps)}`,
  ].join('\n')
}
