import type { Status } from '@/api/client'

// 第 4.4 節的狀態色，畫布節點、指標表和 Sankey 共用

// 用 ring 和光暈疊在 bg-card 上，不改底色
export const STATUS_RING: Record<Status, string> = {
  OK: 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/40',
  WARN: 'ring-2 ring-yellow-500 shadow-lg shadow-yellow-500/40',
  CRITICAL: 'ring-2 ring-orange-500 shadow-lg shadow-orange-500/40',
  OVERLOADED: 'ring-2 ring-red-500 shadow-lg shadow-red-500/40',
}

export const STATUS_TEXT: Record<Status, string> = {
  OK: 'text-emerald-500',
  WARN: 'text-yellow-500',
  CRITICAL: 'text-orange-500',
  OVERLOADED: 'text-red-500',
}

export const STATUS_BADGE: Record<Status, string> = {
  OK: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  WARN: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  CRITICAL: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  OVERLOADED: 'bg-red-500/15 text-red-700 dark:text-red-400',
}

// ECharts 畫在 canvas 上吃不到 Tailwind class，用同色系的 hex（Tailwind 500）
export const STATUS_HEX: Record<Status, string> = {
  OK: '#10b981',
  WARN: '#eab308',
  CRITICAL: '#f97316',
  OVERLOADED: '#ef4444',
}
