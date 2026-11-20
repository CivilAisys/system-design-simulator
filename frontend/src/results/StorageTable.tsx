import { Fragment, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExplanationBody } from '@/explanation/ExplanationSteps'
import { cn } from '@/lib/utils'
import type { ComputedResult, Topology } from '@/api/client'
import { NODE_KINDS } from '@/canvas/catalog'
import { connectedFirst, unconnectedNodeIds } from '@/canvas/graph'
import { DASH, formatBytes, formatDays } from '@/canvas/format'

type StorageTableProps = {
  topology: Topology
  result: ComputedResult
  // 點算式裡的節點名稱：選取它並移到畫面上
  onSelectNode: (id: string) => void
}

// 容量估算（spec 4.8）：每個 Database、Object Storage 一列。磁碟會滿是另一種瓶頸，和 ρ 的瓶頸分開標示。
// Object Storage 的容量由供應商負責，只列增量和總量；沒有 Database 時不顯示磁碟那一欄
export function StorageTable({ topology, result, onSelectNode }: StorageTableProps) {
  // 點一列在下方展開它的算式（spec 4.9），可以同時展開多列
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
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
  const nodeName = (id: string) => topology.nodes.find((node) => node.id === id)?.name
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

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
              title="每台磁碟容量 ÷ 每台每日增量；沒有設定磁碟容量時不估算，Object Storage 沒有磁碟容量"
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
          const open = expanded.has(node.id)
          return (
            <Fragment key={node.id}>
              <TableRow
                className={cn('cursor-pointer', unconnected.has(node.id) && 'opacity-50')}
                onClick={() => toggle(node.id)}
              >
                <TableCell className="font-semibold text-foreground">
                  <button
                    type="button"
                    className="mr-1 inline-flex rounded-sm align-middle text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={open}
                    aria-label={`${open ? '收起' : '展開'} ${node.name} 怎麼算的`}
                    onClick={(event) => {
                      // 整列都能點，按鈕給鍵盤用；不要再觸發一次整列的點擊
                      event.stopPropagation()
                      toggle(node.id)
                    }}
                  >
                    <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
                  </button>
                  {node.name}
                  {/* 這張表沒有狀態欄，未連線寫在名稱旁 */}
                  {unconnected.has(node.id) && <span className="ml-2 text-xs text-muted-foreground">未連線</span>}
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
              {open && (
                <TableRow className={cn('hover:bg-transparent', unconnected.has(node.id) && 'opacity-50')}>
                  <TableCell colSpan={showDisk ? 6 : 5} className="bg-muted/40 whitespace-normal">
                    <div className="grid max-w-2xl gap-2">
                      {/* 這張表只在有計算結果時顯示，所以不會是驗證錯誤的狀態 */}
                      <ExplanationBody
                        steps={estimate.explanation}
                        unconnected={unconnected.has(node.id)}
                        invalid={false}
                        stale={false}
                        heading="怎麼算的"
                        nodeName={nodeName}
                        onSelectNode={onSelectNode}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
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
