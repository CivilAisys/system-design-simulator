import type { DragEvent } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { CATEGORIES, NODE_KINDS, PALETTE, type PaletteItem } from './catalog'
import { PALETTE_ITEM_MIME } from './Canvas'
import { CATEGORY_DOT } from './category'
import { CategoryIcon } from './CategoryIcon'

type PaletteProps = {
  // 點擊（或鍵盤）加入時放在畫布中央，拖曳則放在放開的位置
  onAdd: (item: PaletteItem) => void
}

export function Palette({ onAdd }: PaletteProps) {
  function onDragStart(event: DragEvent, item: PaletteItem) {
    event.dataTransfer.setData(PALETTE_ITEM_MIME, item.id)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <Sidebar collapsible="none" className="w-[214px] border-r">
      <SidebarContent>
        {CATEGORIES.map((category) => (
          <SidebarGroup key={category.id} className="py-1">
            <SidebarGroupLabel className="gap-2">
              <span aria-hidden className={cn('size-2 rounded-full', CATEGORY_DOT[category.id])} />
              {category.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PALETTE.filter((item) => NODE_KINDS[item.type].category === category.id).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      draggable
                      onDragStart={(event) => onDragStart(event, item)}
                      onClick={() => onAdd(item)}
                      title={`拖到畫布，或點擊加入 ${item.label}`}
                      className="h-[38px] cursor-grab gap-2.5 rounded-[10px] text-[13px] active:cursor-grabbing"
                    >
                      <CategoryIcon icon={item.icon} category={category.id} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
