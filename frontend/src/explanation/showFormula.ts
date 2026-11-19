import { useSyncExternalStore } from 'react'

// 「看公式」開關（spec 第 6 節）：屬性面板和容量估算表共用一個，存在 localStorage，換節點、重新整理都維持
const STORAGE_KEY = 'explanationShowFormula'

const listeners = new Set<() => void>()

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let current = readStored()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setShowFormula(value: boolean) {
  current = value
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // 無法存取 localStorage 時只是不記住選擇
  }
  listeners.forEach((listener) => listener())
}

// 一個地方切換，畫面上所有的「怎麼算的」一起換
export function useShowFormula() {
  return [useSyncExternalStore(subscribe, () => current), setShowFormula] as const
}
