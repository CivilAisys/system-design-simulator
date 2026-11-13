import type { DragEvent } from 'react'
import type { NodeType } from '@/api/client'
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
import { NODE_KINDS, NODE_TYPES } from './catalog'
import { NODE_TYPE_MIME } from './Canvas'

type PaletteProps = {
  // 點擊（或鍵盤）加入時放在畫布中央，拖曳則放在放開的位置
  onAdd: (type: NodeType) => void
}

export function Palette({ onAdd }: PaletteProps) {
  function onDragStart(event: DragEvent, type: NodeType) {
    event.dataTransfer.setData(NODE_TYPE_MIME, type)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <Sidebar collapsible="none" className="w-44 border-r">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>元件</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NODE_TYPES.map((type) => {
                const { label, icon: Icon } = NODE_KINDS[type]
                return (
                  <SidebarMenuItem key={type}>
                    <SidebarMenuButton
                      draggable
                      onDragStart={(event) => onDragStart(event, type)}
                      onClick={() => onAdd(type)}
                      title={`拖到畫布，或點擊加入 ${label}`}
                      className="cursor-grab active:cursor-grabbing"
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
