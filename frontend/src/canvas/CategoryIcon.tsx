import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Category } from './catalog'
import { CATEGORY_TILE } from './category'

type CategoryIconProps = {
  icon: LucideIcon
  category: Category
  // 畫布節點用大一號的
  large?: boolean
  className?: string
}

// 元件的圖示是依類別上色的立體按鍵帽（index.css 的 .category-icon），元件面板、畫布節點和屬性面板的標題共用。
// 底部有 3px 的墨色陰影，下面多留一點空間
export function CategoryIcon({ icon: Icon, category, large, className }: CategoryIconProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'category-icon mb-1 flex shrink-0 items-center justify-center',
        large ? 'h-9 w-9.5 rounded-[11px]' : 'h-7.5 w-8 rounded-[9px]',
        CATEGORY_TILE[category],
        className,
      )}
    >
      <Icon className={large ? 'size-5' : 'size-4.25'} />
    </span>
  )
}
