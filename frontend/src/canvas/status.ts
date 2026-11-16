import type { NodeWarning, Status } from '@/api/client'

// 第 4.4 節的狀態色，畫布節點、指標表和 Sankey 共用。
// Rate Limiter 的 LIMITING／NOT_LIMITING 不是 ρ 分級：限流是設計上預期的行為，不變色、不發光。
// External API 超過配額（OVER_QUOTA）會讓請求失敗，用紅色標出但不脈動；配額內（WITHIN_QUOTA）不變色

// 畫布節點的外框和光暈（spec 第 6 節），畫在節點後面的一層，不改底色。過載時的脈動在 SimNode 加
export const STATUS_GLOW: Record<Status, string> = {
  OK: 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/40',
  WARN: 'ring-2 ring-yellow-500 shadow-lg shadow-yellow-500/50',
  CRITICAL: 'ring-2 ring-orange-500 shadow-xl shadow-orange-500/50',
  OVERLOADED: 'ring-2 ring-red-500 shadow-xl shadow-red-500/60',
  LIMITING: '',
  NOT_LIMITING: '',
  OVER_QUOTA: 'ring-2 ring-red-500',
  WITHIN_QUOTA: '',
}

export const STATUS_TEXT: Record<Status, string> = {
  OK: 'text-emerald-500',
  WARN: 'text-yellow-500',
  CRITICAL: 'text-orange-500',
  OVERLOADED: 'text-red-500',
  LIMITING: 'text-muted-foreground',
  NOT_LIMITING: 'text-muted-foreground',
  OVER_QUOTA: 'text-red-500',
  WITHIN_QUOTA: 'text-muted-foreground',
}

export const STATUS_BADGE: Record<Status, string> = {
  OK: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  WARN: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  CRITICAL: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  OVERLOADED: 'bg-red-500/15 text-red-700 dark:text-red-400',
  LIMITING: 'bg-muted text-muted-foreground',
  NOT_LIMITING: 'bg-muted text-muted-foreground',
  OVER_QUOTA: 'bg-red-500/15 text-red-700 dark:text-red-400',
  WITHIN_QUOTA: 'bg-muted text-muted-foreground',
}

// 分片節點裡每個 shard 的格子（spec 第 6 節）：實心填色，過載的格子發光。Rate Limiter、External API 不會分片
export const STATUS_CELL: Record<Status, string> = {
  OK: 'bg-emerald-500',
  WARN: 'bg-yellow-500',
  CRITICAL: 'bg-orange-500',
  OVERLOADED: 'bg-red-500 shadow-md shadow-red-500/80',
  LIMITING: 'bg-muted-foreground/40',
  NOT_LIMITING: 'bg-muted-foreground/40',
  OVER_QUOTA: 'bg-muted-foreground/40',
  WITHIN_QUOTA: 'bg-muted-foreground/40',
}

// 中性灰：Client（沒有狀態）、Rate Limiter 和配額內的 External API 的 Sankey 節點
export const NEUTRAL_HEX = '#a3a3a3'

// ECharts 畫在 canvas 上吃不到 Tailwind class，用同色系的 hex（Tailwind 500）
export const STATUS_HEX: Record<Status, string> = {
  OK: '#10b981',
  WARN: '#eab308',
  CRITICAL: '#f97316',
  OVERLOADED: '#ef4444',
  LIMITING: NEUTRAL_HEX,
  NOT_LIMITING: NEUTRAL_HEX,
  OVER_QUOTA: '#ef4444',
  WITHIN_QUOTA: NEUTRAL_HEX,
}

// 顯示的文字：ρ 分級沿用英文代碼，Rate Limiter 和 External API 的狀態用中文
export const STATUS_LABEL: Record<Status, string> = {
  OK: 'OK',
  WARN: 'WARN',
  CRITICAL: 'CRITICAL',
  OVERLOADED: 'OVERLOADED',
  LIMITING: '限流中',
  NOT_LIMITING: '未觸發',
  OVER_QUOTA: '超過配額',
  WITHIN_QUOTA: '配額內',
}

// 節點警告（spec 4.2.3、4.2.4），不影響狀態分級，節點和指標表都顯示
export const WARNING_LABEL: Record<NodeWarning, string> = {
  REPLICATION_LAG: '複製跟不上',
  BACKLOG: '積壓中',
}

export const WARNING_TITLE: Record<NodeWarning, string> = {
  REPLICATION_LAG: 'Read Replica 過載，丟掉了一部分複製寫入：replication lag 會持續增加',
  BACKLOG:
    'Message Queue 送來的訊息有一部分沒有處理成功（consumer 處理不完，或下游失敗），留在 queue 裡等重試，backlog 持續增加',
}
