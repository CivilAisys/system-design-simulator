// PROTOTYPE（0.8.0 側邊面板收合）：用完就丟，不要合進 develop。
// 第二輪：使用者選了第一輪的 A，右側不變；左側收合後只剩圖示列，hover 圖示只顯示名稱。
// 這一輪比較左側「展開／收合」按鈕放哪裡：?variant=A 上方、?variant=B 下方。
// 第一輪的三種版面（圖示列＋浮出、浮動卡片、整個收起來）在 commit c33f020。
// 快捷鍵：[ 切換左側元件面板、] 切換右側屬性面板（輸入框裡不觸發）。
// 狀態只放在記憶體裡，重新整理會回到預設。
import { Fragment, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Pin, PinOff } from 'lucide-react'
import { CATEGORIES, NODE_KINDS, PALETTE, type PaletteItem } from '@/canvas/catalog'
import { PALETTE_ITEM_MIME } from '@/canvas/Canvas'
import { CategoryIcon } from '@/canvas/CategoryIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Slots = {
  palette: ReactNode
  canvas: ReactNode
  properties: ReactNode
  // 剛好選了一個元件或一條連線
  hasSelection: boolean
  onAdd: (item: PaletteItem) => void
}

const VARIANTS = {
  A: '左側按鈕在上方',
  B: '左側按鈕在下方',
} as const
type VariantKey = keyof typeof VARIANTS
const KEYS = Object.keys(VARIANTS) as VariantKey[]

export function PanelLayoutPrototype(slots: Slots) {
  const [variant, setVariant] = useState<VariantKey>(() => {
    const v = new URLSearchParams(window.location.search).get('variant')
    return v && v in VARIANTS ? (v as VariantKey) : 'A'
  })

  function go(step: number) {
    const next = KEYS[(KEYS.indexOf(variant) + step + KEYS.length) % KEYS.length]
    const url = new URL(window.location.href)
    url.searchParams.set('variant', next)
    window.history.replaceState(null, '', url)
    setVariant(next)
  }

  return (
    <>
      <Layout key={variant} buttonAt={variant === 'A' ? 'top' : 'bottom'} {...slots} />
      {import.meta.env.DEV && (
        <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-2 py-1 text-sm text-white shadow-lg ring-2 ring-yellow-400">
          <button className="rounded-full p-1 hover:bg-white/20" onClick={() => go(-1)} aria-label="上一個版面">
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-2 font-medium">
            PROTOTYPE {variant}（{VARIANTS[variant]}）
          </span>
          <button className="rounded-full p-1 hover:bg-white/20" onClick={() => go(1)} aria-label="下一個版面">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </>
  )
}

// [ 和 ] 快捷鍵；焦點在輸入框時不攔
function usePanelShortcuts(onLeft: () => void, onRight: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"], [role="combobox"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '[') onLeft()
      if (event.key === ']') onRight()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <IconButton onClick={onToggle} label={pinned ? '取消釘選（]）' : '釘選（]）'}>
      {pinned ? <Pin className="size-4" /> : <PinOff className="size-4" />}
    </IconButton>
  )
}

// 收合時的元件圖示列：依類別分組，hover 顯示名稱，點擊加入或拖到畫布
function PaletteRail({ onAdd }: { onAdd: (item: PaletteItem) => void }) {
  function onDragStart(event: DragEvent, item: PaletteItem) {
    event.dataTransfer.setData(PALETTE_ITEM_MIME, item.id)
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <TooltipProvider>
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
      {CATEGORIES.map((category, i) => (
        <Fragment key={category.id}>
          {i > 0 && <div className="my-1 h-px w-6 shrink-0 bg-border" />}
          {PALETTE.filter((item) => NODE_KINDS[item.type].category === category.id).map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  draggable
                  onDragStart={(event) => onDragStart(event, item)}
                  onClick={() => onAdd(item)}
                  aria-label={`加入 ${item.label}`}
                  className="shrink-0 cursor-grab rounded-[10px] p-1 hover:bg-accent active:cursor-grabbing"
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
    </TooltipProvider>
  )
}

function Layout({ buttonAt, palette, canvas, properties, hasSelection, onAdd }: Slots & { buttonAt: 'top' | 'bottom' }) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightPinned, setRightPinned] = useState(true)
  usePanelShortcuts(() => setLeftOpen((o) => !o), () => setRightPinned((p) => !p))

  const collapseButton = (
    <IconButton onClick={() => setLeftOpen(false)} label="收合元件面板（[）">
      <PanelLeftClose className="size-4" />
    </IconButton>
  )
  const expandButton = (
    <IconButton onClick={() => setLeftOpen(true)} label="展開元件面板（[）">
      <PanelLeftOpen className="size-4" />
    </IconButton>
  )

  return (
    <div className="relative flex min-h-0 flex-1">
      {leftOpen ? (
        <div className="relative flex shrink-0 flex-col border-r bg-sidebar">
          {buttonAt === 'top' && <div className="absolute top-1.5 right-1.5 z-10">{collapseButton}</div>}
          <div className="min-h-0 flex-1 [&>[data-slot=sidebar]]:h-full">{palette}</div>
          {buttonAt === 'bottom' && (
            <div className="flex items-center justify-between border-t px-3 py-1 text-xs text-muted-foreground">
              收合 <kbd className="ml-1 mr-auto">[</kbd>
              {collapseButton}
            </div>
          )}
        </div>
      ) : (
        <div className="flex w-12 shrink-0 flex-col items-center border-r bg-sidebar">
          {buttonAt === 'top' && <div className="w-full border-b py-1.5 flex justify-center">{expandButton}</div>}
          <PaletteRail onAdd={onAdd} />
          {buttonAt === 'bottom' && <div className="w-full border-t py-1.5 flex justify-center">{expandButton}</div>}
        </div>
      )}

      {canvas}

      {rightPinned ? (
        <div className="flex shrink-0 flex-col border-l">
          <RightHeader pinned onToggle={() => setRightPinned(false)} />
          <div className="flex min-h-0 flex-1 [&>aside]:border-l-0">{properties}</div>
        </div>
      ) : (
        <>
          <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-l py-2">
            <IconButton onClick={() => setRightPinned(true)} label="釘選屬性面板（]）">
              <PanelRightOpen className="size-4" />
            </IconButton>
            <span className="mt-2 text-xs text-muted-foreground [writing-mode:vertical-rl]">選取元件會浮出屬性</span>
          </div>
          <div
            className={cn(
              'absolute top-2 right-11 bottom-2 z-30 flex overflow-hidden rounded-xl border bg-background shadow-2xl transition-all duration-150',
              hasSelection ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0',
            )}
          >
            <div className="flex flex-col">
              <RightHeader pinned={false} onToggle={() => setRightPinned(true)} />
              <div className="flex min-h-0 flex-1 [&>aside]:border-l-0">{properties}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RightHeader({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between border-b px-3 py-1 text-xs font-medium text-muted-foreground">
      屬性
      <PinButton pinned={pinned} onToggle={onToggle} />
    </div>
  )
}
