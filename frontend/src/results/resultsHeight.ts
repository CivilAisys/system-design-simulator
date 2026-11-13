import { useEffect, useState } from 'react'

const STORAGE_KEY = 'resultsHeight'

// 原本固定的高度（h-72）
export const DEFAULT_RESULTS_HEIGHT = 288
// 至少看得到分頁和兩三列指標
export const MIN_RESULTS_HEIGHT = 120
// 最多佔視窗高度的比例，畫布不會被擠到看不見。App 的 section 也用同一個比例當 max-height，
// 視窗縮小時不必重新計算
export const MAX_RESULTS_RATIO = 0.7

export function maxResultsHeight(viewportHeight: number): number {
  return Math.max(MIN_RESULTS_HEIGHT, Math.floor(viewportHeight * MAX_RESULTS_RATIO))
}

export function clampResultsHeight(height: number, viewportHeight: number): number {
  return Math.min(Math.max(Math.round(height), MIN_RESULTS_HEIGHT), maxResultsHeight(viewportHeight))
}

// 存檔不是合理的數字（或讀不到）時用預設高度
export function parseStoredHeight(text: string | null): number {
  const height = Number(text)
  return text != null && Number.isFinite(height) && height >= MIN_RESULTS_HEIGHT ? height : DEFAULT_RESULTS_HEIGHT
}

function readStoredHeight(): number {
  try {
    return parseStoredHeight(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_RESULTS_HEIGHT
  }
}

// 結果面板的高度，存在 localStorage，重新整理後保留
export function useResultsHeight() {
  const [height, setHeight] = useState(readStoredHeight)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(height))
    } catch {
      // 無法存取 localStorage 時只是不記住高度
    }
  }, [height])

  return [height, setHeight] as const
}
