import { cn } from '@/lib/utils'
import { STATUS_FILL, type DisplayStatus } from './status'

type RackProps = {
  // 每條槽的狀態色，見 rackSlotStatuses
  slots: (DisplayStatus | null)[]
  // 有熱點時滑鼠移上去的提示，見 hotSpotTitle
  title?: string
  stale?: boolean
}

// 多台機器的節點右側的小機櫃（spec 第 6 節）：一台一條橫槽、縱向疊放。
// 還沒有結果時用淡灰，過期時跟著節點畫淡
export function Rack({ slots, title, stale }: RackProps) {
  return (
    <div
      aria-hidden
      title={title}
      className={cn('flex shrink-0 flex-col gap-0.5 rounded-sm border border-input p-0.5', stale && 'opacity-30')}
    >
      {slots.map((status, i) => (
        <div
          key={i}
          className={cn('h-0.75 w-3.5 rounded-[1px]', status ? STATUS_FILL[status] : 'bg-muted-foreground/25')}
        />
      ))}
    </div>
  )
}
