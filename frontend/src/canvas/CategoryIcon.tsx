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
      className={cn(
        'category-icon flex size-7 shrink-0 items-center justify-center rounded-[9px]',
        // 原型：cat-* 讓 skins.css 依類別畫出 C 紙感的立體按鍵帽
        `cat-${category.toLowerCase()}`,
        CATEGORY_TILE[category],
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  )
}
