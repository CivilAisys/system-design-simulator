import { useEffect, useEffectEvent, useState } from 'react'

// 存檔是 'true' / 'false'，其他內容（或讀不到）時用預設值
export function parseStoredFlag(text: string | null, fallback: boolean): boolean {
  if (text === 'true') return true
  if (text === 'false') return false
  return fallback
}

function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    return parseStoredFlag(localStorage.getItem(key), fallback)
  } catch {
    return fallback
  }
}

// 側邊面板的開合（或釘選）狀態，存在 localStorage，重新整理後保留
export function usePanelFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => readStoredFlag(key, fallback))

  useEffect(() => {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // 無法存取 localStorage 時只是不記住狀態
    }
  }, [key, value])

  const toggle = () => setValue((v) => !v)
  return [value, toggle] as const
}

// 按單一按鍵（例如 [ ）切換面板。焦點在輸入框或下拉選單裡時，按鍵是給它們的。
// 注音等輸入法開著時 key 可能變成「「」，所以實體按鍵（code）對上也算。按住不放不連續切換
export function usePanelShortcut(shortcut: { key: string; code: string }, onToggle: () => void) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== shortcut.key && event.code !== shortcut.code) {
      return
    }
    if (event.repeat || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [role="listbox"]'))
    ) {
      return
    }
    event.preventDefault()
    onToggle()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export type ScrollFade = { top: boolean; bottom: boolean }

// 捲動區上下還有沒露出來的內容時顯示漸層。留 1px 誤差，縮放後的小數像素不會讓漸層一直亮著
export function scrollFade(scrollTop: number, clientHeight: number, scrollHeight: number): ScrollFade {
  return { top: scrollTop > 1, bottom: scrollTop + clientHeight < scrollHeight - 1 }
}
