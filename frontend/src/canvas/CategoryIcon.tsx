import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Category } from './catalog'
import { CATEGORY_TILE } from './category'

type CategoryIconProps = {
  icon: LucideIcon
  category: Category
  className?: string
}

// 元件的圖示放在依類別上色的圓角方塊裡，元件面板、畫布節點和屬性面板的標題共用
export function CategoryIcon({ icon: Icon, category, className }: CategoryIconProps) {
  return (
    <span
      aria-hidden
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-[9px]', CATEGORY_TILE[category], className)}
    >
      <Icon className="size-4" />
    </span>
  )
}
