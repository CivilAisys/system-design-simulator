import { Fragment, useEffect, useRef, useState, type DragEvent } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CATEGORIES, NODE_KINDS, PALETTE, type PaletteItem } from './catalog'
import { PALETTE_ITEM_MIME } from './Canvas'
import { CATEGORY_DOT } from './category'
import { CategoryIcon } from './CategoryIcon'
import { scrollFade, usePanelFlag, usePanelShortcut, type ScrollFade } from './panels'

type PaletteProps = {
  // 點擊（或鍵盤）加入時放在畫布中央，拖曳則放在放開的位置
  onAdd: (item: PaletteItem) => void
}

function onDragStart(event: DragEvent, item: PaletteItem) {
  event.dataTransfer.setData(PALETTE_ITEM_MIME, item.id)
  event.dataTransfer.effectAllowed = 'copy'
}

function itemsOf(category: (typeof CATEGORIES)[number]) {
  return PALETTE.filter((item) => NODE_KINDS[item.type].category === category.id)
}

// 展開時列出名稱，收合時只剩依類別分組的圖示列，畫布多出空間。按上方的按鈕或 [ 切換
export function Palette({ onAdd }: PaletteProps) {
  const [open, toggle] = usePanelFlag('paletteOpen', true)
  usePanelShortcut({ key: '[', code: 'BracketLeft' }, toggle)

  // 展開和收合的切換按鈕是不同的元素，用按鈕切換後把焦點交給新的按鈕，鍵盤使用者不必從頭 Tab 回來
  const toggleRef = useRef<HTMLButtonElement>(null)
  const refocusToggle = useRef(false)
  useEffect(() => {
    if (refocusToggle.current) {
      refocusToggle.current = false
      toggleRef.current?.focus()
    }
  }, [open])

  const toggleButton = (
    <Button
      ref={toggleRef}
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        refocusToggle.current = true
        toggle()
      }}
      aria-label={open ? '收合元件面板' : '展開元件面板'}
      title={open ? '收合元件面板（[）' : '展開元件面板（[）'}
      className="text-muted-foreground"
    >
      {open ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  )

  if (!open) {
    return (
      <Sidebar collapsible="none" className="w-12 items-center border-r">
        <div className="flex w-full justify-center border-b py-1.5">{toggleButton}</div>
        <PaletteRail onAdd={onAdd} />
      </Sidebar>
    )
  }

  return (
    <Sidebar collapsible="none" className="relative w-[214px] border-r">
      {/* 疊在第一個類別標題的右邊，不另外占一列 */}
      <div className="absolute top-1.5 right-1.5 z-10">{toggleButton}</div>
      <SidebarContent>
        {CATEGORIES.map((category) => (
          <SidebarGroup key={category.id} className="py-1">
            <SidebarGroupLabel className="gap-2 font-bold text-ink-soft">
              <span aria-hidden className={cn('size-2 rounded-full', CATEGORY_DOT[category.id])} />
              {category.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {itemsOf(category).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      draggable
                      onDragStart={(event) => onDragStart(event, item)}
                      onClick={() => onAdd(item)}
                      title={`拖到畫布，或點擊加入 ${item.label}`}
                      className="h-11 cursor-grab gap-2.5 rounded-[10px] text-[13px] transition-[translate,background-color,box-shadow] duration-150 ease-out hover:translate-x-0.5 hover:bg-card hover:shadow-[inset_0_0_0_1.5px_var(--ink)] active:cursor-grabbing"
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

// 收合後的圖示列：類別之間有分隔線，hover 只顯示名稱，點擊或拖曳加入和展開時一樣。
// 48px 寬放不下捲軸（會壓在圖示上），所以隱藏捲軸，改用上下的漸層提示還有沒露出來的元件
function PaletteRail({ onAdd }: PaletteProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<ScrollFade>({ top: false, bottom: false })

  function updateFade() {
    const el = scrollRef.current
    if (!el) return
    const next = scrollFade(el.scrollTop, el.clientHeight, el.scrollHeight)
    setFade((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next))
  }

  // 視窗或結果面板高度改變時，放不放得下也跟著變
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateFade()
    const observer = new ResizeObserver(updateFade)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {fade.top && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-sidebar to-transparent" />
      )}
      {fade.bottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-sidebar to-transparent" />
      )}
      <div
        ref={scrollRef}
        onScroll={updateFade}
        className="flex min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-1 flex-col items-center gap-1 overflow-y-auto py-2"
      >
        {CATEGORIES.map((category, i) => (
          <Fragment key={category.id}>
            {i > 0 && <div aria-hidden className="my-1 h-px w-6 shrink-0 bg-border" />}
            {itemsOf(category).map((item) => (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => onDragStart(event, item)}
                    onClick={() => onAdd(item)}
                    aria-label={`加入 ${item.label}`}
                    className="shrink-0 cursor-grab rounded-[10px] p-1 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring active:cursor-grabbing"
                  >
                    <CategoryIcon icon={item.icon} category={category.id} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={6}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
