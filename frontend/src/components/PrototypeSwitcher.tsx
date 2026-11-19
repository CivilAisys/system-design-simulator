// PROTOTYPE（拋棄式）：在畫面底部切換 ?variant=，只在開發模式顯示
import { useEffect, useState } from 'react'

export type PrototypeVariant = { key: string; name: string }

export function readVariant(variants: readonly PrototypeVariant[]): string {
  const key = new URLSearchParams(location.search).get('variant')
  return variants.some((variant) => variant.key === key) ? key! : variants[0].key
}

// 目前的變體；URL 改了（切換列、上一頁）時跟著換
export function useVariant(variants: readonly PrototypeVariant[]) {
  const [variant, setVariant] = useState(() => readVariant(variants))
  useEffect(() => {
    const sync = () => setVariant(readVariant(variants))
    window.addEventListener('popstate', sync)
    window.addEventListener('prototype-variant', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('prototype-variant', sync)
    }
  }, [variants])
  return variant
}

function go(variants: readonly PrototypeVariant[], step: number) {
  const index = variants.findIndex((variant) => variant.key === readVariant(variants))
  const next = variants[(index + step + variants.length) % variants.length]
  const url = new URL(location.href)
  url.searchParams.set('variant', next.key)
  history.replaceState(null, '', url)
  window.dispatchEvent(new Event('prototype-variant'))
}

export function PrototypeSwitcher({ variants }: { variants: readonly PrototypeVariant[] }) {
  const current = useVariant(variants)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return
      if (event.key === 'ArrowLeft') go(variants, -1)
      if (event.key === 'ArrowRight') go(variants, 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variants])

  if (!import.meta.env.DEV) return null
  const name = variants.find((variant) => variant.key === current)?.name
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-2 py-1 text-sm text-white shadow-lg ring-2 ring-yellow-400">
      <button type="button" className="rounded-full px-2 py-1 hover:bg-white/20" onClick={() => go(variants, -1)}>
        ←
      </button>
      <span className="px-2 font-medium">
        PROTOTYPE {current}（{name}）
      </span>
      <button type="button" className="rounded-full px-2 py-1 hover:bg-white/20" onClick={() => go(variants, 1)}>
        →
      </button>
    </div>
  )
}
