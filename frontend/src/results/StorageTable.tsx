import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { ComputedResult, Topology } from '@/api/client'
import { NODE_KINDS } from '@/canvas/catalog'
import { connectedFirst, unconnectedNodeIds } from '@/canvas/graph'
import { DASH, formatBytes, formatDays } from '@/canvas/format'

type StorageTableProps = {
  topology: Topology
  result: ComputedResult
}

// 容量估算（spec 4.8）：每個 Database、Object Storage 一列。磁碟會滿是另一種瓶頸，和 ρ 的瓶頸分開標示。
// Object Storage 的容量由供應商負責，只列增量和總量；沒有 Database 時不顯示磁碟那一欄
export function StorageTable({ topology, result }: StorageTableProps) {
  // 未連線的節點不在拓撲裡，和指標表一樣移到最後並畫淡
  const unconnected = unconnectedNodeIds(topology.nodes, topology.edges)
  const rows = connectedFirst(
    topology.nodes.filter((node) => result.storage[node.id]),
    unconnected,
  )
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">拓撲裡沒有 Database 或 Object Storage</p>
  }
  const showDisk = rows.some((node) => NODE_KINDS[node.type].hasDisk)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>節點</TableHead>
          <TableHead className="text-right" title="成功處理的 write × bytesPerWrite × 86,400">
            每日增量
          </TableHead>
          <TableHead className="text-right" title="每日增量 × retentionDays">
            總量
          </TableHead>
          <TableHead className="text-right" title="總量 × (1 + Read Replica 數)">
            含副本
          </TableHead>
          <TableHead className="text-right" title="總量 ÷ instances，資料平均分布在每台機器上">
            每台
          </TableHead>
          {showDisk && (
            <TableHead
              className="text-right"
              title="diskGbPerInstance ÷ 每台每日增量；沒有設定磁碟容量時不估算，Object Storage 沒有磁碟容量"
            >
              磁碟滿
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((node) => {
          const estimate = result.storage[node.id]
          // 過載時被丟棄的 write 不算進儲存量
          const overloaded = result.nodes[node.id]?.status === 'OVERLOADED'
          // Object Storage 沒有副本、機器數和磁碟由供應商負責
          const { hasDisk } = NODE_KINDS[node.type]
          return (
            <TableRow key={node.id} className={cn(unconnected.has(node.id) && 'opacity-50')}>
              <TableCell className="font-semibold text-foreground">
                {node.name}
                {overloaded && (
                  <span
                    className="ml-2 text-xs text-destructive"
                    title="只算成功處理的 write，被丟棄的不算，數字偏低"
                  >
                    過載，偏低
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatBytes(estimate.dailyBytes)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBytes(estimate.totalBytes)}
                <div className="text-xs text-muted-foreground">保留 {estimate.retentionDays.toLocaleString()} 天</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {hasDisk ? formatBytes(estimate.totalWithReplicasBytes) : DASH}
                {estimate.replicas > 0 && (
                  <div className="text-xs text-muted-foreground">{estimate.replicas} 個 replica</div>
                )}
                {/* 數字照完整副本算，只加註記（spec 4.8） */}
                {estimate.replicasLagging && (
                  <div className="text-xs text-destructive">副本複製跟不上，實際副本量會比這少</div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {hasDisk ? formatBytes(estimate.perInstanceBytes) : DASH}
              </TableCell>
              {showDisk && (
                <TableCell className={cn('text-right tabular-nums', estimate.fillsDisk && 'text-destructive')}>
                  {hasDisk ? (
                    <DiskCell
                      daysUntilFull={estimate.daysUntilFull}
                      diskGb={estimate.diskGbPerInstance}
                      fillsDisk={estimate.fillsDisk}
                    />
                  ) : (
                    DASH
                  )}
                </TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function DiskCell({
  daysUntilFull,
  diskGb,
  fillsDisk,
}: {
  daysUntilFull: number | null
  diskGb: number | null
  fillsDisk: boolean
}) {
  if (diskGb == null) return DASH
  // 有磁碟容量但沒有寫入：資料不會增加
  if (daysUntilFull == null) return '不會滿'
  return (
    <>
      {formatDays(daysUntilFull)}
      <div className={cn('text-xs', !fillsDisk && 'text-muted-foreground')}>
        {fillsDisk ? '保留期內就會滿' : '保留期內不會滿'}・{formatBytes(diskGb * 1e9)}
      </div>
    </>
  )
}
