import type { Topology } from '@/api/client'
import { parseTopology, serializeTopology } from './topologyFile'

const STORAGE_KEY = 'topology'

// localStorage 的子集，測試時換成假的
export type TopologyStorage = Pick<Storage, 'getItem' | 'setItem'>

// 存檔讀不回來時是 error（第一個格式錯誤），畫布回到 fallback
export type Restored = { topology: Topology; error: string | null }

// 讀上次自動存的畫布，和匯入走同一套檢查。沒有存檔或瀏覽器不允許存取時直接用 fallback，不算錯誤
export function restoreTopology(fallback: Topology, storage = browserStorage()): Restored {
  let text: string | null = null
  try {
    text = storage?.getItem(STORAGE_KEY) ?? null
  } catch {
    // 無法存取 localStorage 時只是不記住畫布
  }
  if (text == null) {
    return { topology: fallback, error: null }
  }
  const parsed = parseTopology(text)
  return parsed.ok ? { topology: parsed.topology, error: null } : { topology: fallback, error: parsed.errors[0] }
}

// 存成和匯出檔相同的內容
export function saveTopology(topology: Topology, storage = browserStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, serializeTopology(topology))
  } catch {
    // 無法存取 localStorage 或空間不夠時只是不記住畫布
  }
}

// 有些瀏覽器封鎖網站資料時，連讀 window.localStorage 都會丟例外
function browserStorage(): TopologyStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
