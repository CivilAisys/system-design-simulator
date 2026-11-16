import type { Status } from '@/api/client'
import { cn } from '@/lib/utils'
import type { InstanceRack } from './instanceRack'
import { STATUS_FILL } from './status'

type RackProps = {
  rack: InstanceRack
  status: Status | null
  stale?: boolean
}

// 多台機器的節點右側的小機櫃（spec 第 6 節）：一台一條橫槽、縱向疊放，用節點的狀態色。
// 和分片格子（節點底部橫排的方格）用位置、方向和形狀區分。還沒有結果時用淡灰，過期時跟著節點畫淡
export function Rack({ rack, status, stale }: RackProps) {
  return (
    <div
      aria-hidden
      className={cn('flex shrink-0 flex-col gap-0.5 rounded-sm border border-input p-0.5', stale && 'opacity-30')}
    >
      {Array.from({ length: rack.slots }, (_, i) => (
        <div
          key={i}
          className={cn('h-0.75 w-3.5 rounded-[1px]', status ? STATUS_FILL[status] : 'bg-muted-foreground/25')}
        />
      ))}
    </div>
  )
}
