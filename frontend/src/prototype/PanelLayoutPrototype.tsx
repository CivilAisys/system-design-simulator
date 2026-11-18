// PROTOTYPE（0.8.0 側邊面板收合）：用完就丟，不要合進 develop。
// 三種版面用 ?variant=A|B|C 切換，畫面底部中央的切換列可以左右切。
// 快捷鍵：[ 切換左側元件面板、] 切換右側屬性面板（輸入框裡不觸發）。
// 釘選狀態只放在記憶體裡，重新整理會回到預設。
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid, PanelLeftOpen, PanelRightOpen, Pin, PinOff, SlidersHorizontal, X } from 'lucide-react'
import { NODE_KINDS, PALETTE, type PaletteItem } from '@/canvas/catalog'
import { PALETTE_ITEM_MIME } from '@/canvas/Canvas'
import { CategoryIcon } from '@/canvas/CategoryIcon'
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
  A: '圖示列＋浮出',
  B: '浮動卡片',
  C: '整個收起來',
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
      {variant === 'A' && <VariantA key="A" {...slots} />}
      {variant === 'B' && <VariantB key="B" {...slots} />}
      {variant === 'C' && <VariantC key="C" {...slots} />}
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

function IconButton({ onClick, label, children, className }: { onClick: () => void; label: string; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', className)}
    >
      {children}
    </button>
  )
}

function PinButton({ pinned, onToggle, shortcut }: { pinned: boolean; onToggle: () => void; shortcut: string }) {
  return (
    <IconButton onClick={onToggle} label={pinned ? `取消釘選（${shortcut}）` : `釘選（${shortcut}）`}>
      {pinned ? <Pin className="size-4" /> : <PinOff className="size-4" />}
    </IconButton>
  )
}

// 收合時的元件圖示列：圖示一樣可以拖曳或點擊加入
function PaletteRail({ onAdd }: { onAdd: (item: PaletteItem) => void }) {
  function onDragStart(event: DragEvent, item: PaletteItem) {
    event.dataTransfer.setData(PALETTE_ITEM_MIME, item.id)
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div className="flex flex-col items-center gap-1 overflow-y-auto py-2">
      {PALETTE.map((item) => (
        <button
          key={item.id}
          draggable
          onDragStart={(event) => onDragStart(event, item)}
          onClick={() => onAdd(item)}
          title={item.label}
          className="cursor-grab rounded-[10px] p-1 hover:bg-accent active:cursor-grabbing"
        >
          <CategoryIcon icon={item.icon} category={NODE_KINDS[item.type].category} />
        </button>
      ))}
    </div>
  )
}

// ── A：圖示列＋浮出 ───────────────────────────────────────────────
// 釘選：跟現在一樣佔版面。取消釘選：左側縮成 48px 圖示列，滑鼠移上去時完整面板浮在畫布上；
// 右側縮成細條，選取元件或連線時屬性面板自動浮出，點畫布空白處（取消選取）就收回
function VariantA({ palette, canvas, properties, hasSelection, onAdd }: Slots) {
  const [leftPinned, setLeftPinned] = useState(true)
  const [rightPinned, setRightPinned] = useState(true)
  const [hoverLeft, setHoverLeft] = useState(false)
  const [dragging, setDragging] = useState(false)
  usePanelShortcuts(() => setLeftPinned((p) => !p), () => setRightPinned((p) => !p))

  const showLeftOverlay = !leftPinned && hoverLeft && !dragging

  return (
    <div className="relative flex min-h-0 flex-1">
      {leftPinned ? (
        <div className="relative flex shrink-0 flex-col border-r">
          <div className="absolute top-1.5 right-1.5 z-10">
            <PinButton pinned onToggle={() => setLeftPinned(false)} shortcut="[" />
          </div>
          {palette}
        </div>
      ) : (
        <div
          className="relative z-30 flex w-12 shrink-0 flex-col border-r bg-sidebar"
          onMouseEnter={() => setHoverLeft(true)}
          onMouseLeave={() => setHoverLeft(false)}
        >
          <PaletteRail onAdd={onAdd} />
          {/* 浮出的完整面板一直掛著，只用 CSS 隱藏：從它開始拖曳時來源元素不能被移除 */}
          <div
            onDragStart={() => setDragging(true)}
            onDragEnd={() => {
              setDragging(false)
              setHoverLeft(false)
            }}
            className={cn(
              'absolute top-0 bottom-0 left-0 flex flex-col border-r bg-sidebar shadow-2xl transition-all duration-150',
              showLeftOverlay ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-2 opacity-0',
            )}
          >
            <div className="absolute top-1.5 right-1.5 z-10">
              <PinButton pinned={false} onToggle={() => setLeftPinned(true)} shortcut="[" />
            </div>
            {palette}
          </div>
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
      <PinButton pinned={pinned} onToggle={onToggle} shortcut="]" />
    </div>
  )
}

// ── B：浮動卡片 ───────────────────────────────────────────────────
// 畫布永遠滿版，兩側面板是浮在畫布上的卡片，沒有「佔版面」的狀態。
// 關掉後縮成角落的小按鈕；選取元件時屬性卡片自動打開
function VariantB({ palette, canvas, properties, hasSelection }: Slots) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [dragging, setDragging] = useState(false)
  usePanelShortcuts(() => setLeftOpen((o) => !o), () => setRightOpen((o) => !o))
  // 新選取時自動打開
  const [lastSelection, setLastSelection] = useState(hasSelection)
  if (hasSelection !== lastSelection) {
    setLastSelection(hasSelection)
    if (hasSelection) setRightOpen(true)
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      {canvas}

      {leftOpen ? (
        <div
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          className={cn(
            'absolute top-3 left-3 bottom-14 z-30 flex flex-col overflow-hidden rounded-2xl border shadow-xl transition-opacity',
            dragging && 'pointer-events-none opacity-40',
          )}
        >
          <div className="flex items-center justify-between border-b bg-sidebar px-3 py-1.5 text-xs font-medium text-muted-foreground">
            元件
            <IconButton onClick={() => setLeftOpen(false)} label="收起元件（[）">
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1">{palette}</div>
        </div>
      ) : (
        <button
          onClick={() => setLeftOpen(true)}
          className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm shadow-md hover:bg-accent"
        >
          <LayoutGrid className="size-4" /> 元件 <kbd className="text-xs text-muted-foreground">[</kbd>
        </button>
      )}

      {rightOpen ? (
        <div className="absolute top-3 right-3 bottom-3 z-30 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
            屬性
            <IconButton onClick={() => setRightOpen(false)} label="收起屬性（]）">
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="flex min-h-0 flex-1">{properties}</div>
        </div>
      ) : (
        <button
          onClick={() => setRightOpen(true)}
          className="absolute top-3 right-3 z-30 flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm shadow-md hover:bg-accent"
        >
          <SlidersHorizontal className="size-4" /> 屬性 <kbd className="text-xs text-muted-foreground">]</kbd>
        </button>
      )}
    </div>
  )
}

// ── C：整個收起來 ─────────────────────────────────────────────────
// 面板只有「打開（佔版面）」和「收起（寬度 0）」兩種，沒有浮出。
// 收起後畫布邊緣留一個小把手可以打開；不會因為選取自動打開
function VariantC({ palette, canvas, properties }: Slots) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  usePanelShortcuts(() => setLeftOpen((o) => !o), () => setRightOpen((o) => !o))

  return (
    <div className="relative flex min-h-0 flex-1">
      {leftOpen && (
        <div className="relative flex shrink-0 flex-col border-r">
          <div className="absolute top-1.5 right-1.5 z-10">
            <IconButton onClick={() => setLeftOpen(false)} label="收起元件面板（[）">
              <ChevronLeft className="size-4" />
            </IconButton>
          </div>
          {palette}
        </div>
      )}

      <div className="relative flex min-w-0 flex-1">
        {canvas}
        {!leftOpen && (
          <button
            onClick={() => setLeftOpen(true)}
            title="打開元件面板（[）"
            className="absolute top-1/2 left-0 z-30 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 bg-background shadow hover:bg-accent"
          >
            <PanelLeftOpen className="size-3.5" />
          </button>
        )}
        {!rightOpen && (
          <button
            onClick={() => setRightOpen(true)}
            title="打開屬性面板（]）"
            className="absolute top-1/2 right-0 z-30 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 bg-background shadow hover:bg-accent"
          >
            <PanelRightOpen className="size-3.5" />
          </button>
        )}
      </div>

      {rightOpen && (
        <div className="relative flex shrink-0">
          <div className="absolute top-2 right-2 z-10">
            <IconButton onClick={() => setRightOpen(false)} label="收起屬性面板（]）">
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
          {properties}
        </div>
      )}
    </div>
  )
}
