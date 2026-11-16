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
import { PALETTE, type PaletteItem } from './catalog'
import { PALETTE_ITEM_MIME } from './Canvas'

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
    <Sidebar collapsible="none" className="w-44 border-r">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>元件</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PALETTE.map((item) => {
                const { label, icon: Icon } = item
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      draggable
                      onDragStart={(event) => onDragStart(event, item)}
                      onClick={() => onAdd(item)}
                      title={`拖到畫布，或點擊加入 ${label}`}
                      className="h-9 cursor-grab rounded-[10px] text-[13px] active:cursor-grabbing"
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
