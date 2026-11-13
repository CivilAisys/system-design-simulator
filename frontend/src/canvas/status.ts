import type { Status } from '@/api/client'

// 第 4.4 節的狀態色，畫布節點、指標表和 Sankey 共用

// 畫布節點的外框和光暈（spec 第 6 節），畫在節點後面的一層，不改底色。過載時的脈動在 SimNode 加
export const STATUS_GLOW: Record<Status, string> = {
  OK: 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/40',
  WARN: 'ring-2 ring-yellow-500 shadow-lg shadow-yellow-500/50',
  CRITICAL: 'ring-2 ring-orange-500 shadow-xl shadow-orange-500/50',
  OVERLOADED: 'ring-2 ring-red-500 shadow-xl shadow-red-500/60',
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
