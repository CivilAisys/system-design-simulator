import type { NodeWarning, Status } from '@/api/client'
import type { Theme } from '@/theme'

// 第 4.4 節的狀態色，畫布節點、指標表和 Sankey 共用。
// Rate Limiter 的 LIMITING／NOT_LIMITING 不是 ρ 分級：限流是設計上預期的行為，不變色、不發光。
// External API 超過配額（OVER_QUOTA）會讓請求失敗，用紅色標出但不脈動；配額內（WITHIN_QUOTA）不變色

// 畫布節點的外框和光暈（spec 第 6 節），畫在節點後面的一層，不改底色。過載時的脈動在 SimNode 加。
// 光暈是 index.css 的變數：深色主題發光，淺色主題是外圈的光圈；OK 只有很淡的光暈，外框維持原本的顏色
export const STATUS_GLOW: Record<Status, string> = {
  OK: 'shadow-(--status-ok-glow)',
  WARN: 'border-[1.5px] border-warn shadow-(--status-warn-glow)',
  CRITICAL: 'border-[1.5px] border-critical shadow-(--status-critical-glow)',
  OVERLOADED: 'border-[1.5px] border-over shadow-(--status-over-glow)',
  LIMITING: '',
  NOT_LIMITING: '',
  OVER_QUOTA: 'border-[1.5px] border-over',
  WITHIN_QUOTA: '',
}

// 瓶頸到這幾級（ρ ≥ 0.7，第 4.4 節）才值得提醒：「發現瓶頸」通知和結果面板強調的瓶頸卡片用同一個門檻
const ALERTING: ReadonlySet<Status> = new Set(['WARN', 'CRITICAL', 'OVERLOADED'])

export function isAlerting(status: Status | null | undefined): boolean {
  return status != null && ALERTING.has(status)
}

export const STATUS_TEXT: Record<Status, string> = {
  OK: 'text-ok-ink',
  WARN: 'text-warn-ink',
  CRITICAL: 'text-critical-ink',
  OVERLOADED: 'text-over-ink',
  LIMITING: 'text-muted-foreground',
  NOT_LIMITING: 'text-muted-foreground',
  OVER_QUOTA: 'text-over-ink',
  WITHIN_QUOTA: 'text-muted-foreground',
}

export const STATUS_BADGE: Record<Status, string> = {
  OK: 'bg-ok-bg text-ok-ink',
  WARN: 'bg-warn-bg text-warn-ink',
  CRITICAL: 'bg-critical-bg text-critical-ink',
  OVERLOADED: 'bg-over-bg text-over-ink',
  LIMITING: 'bg-muted text-muted-foreground',
  NOT_LIMITING: 'bg-muted text-muted-foreground',
  OVER_QUOTA: 'bg-over-bg text-over-ink',
  WITHIN_QUOTA: 'bg-muted text-muted-foreground',
}

// 實心的狀態色：多台機器的機櫃槽、狀態圓點和 ρ 的進度條。
// 灰色那幾種是 Rate Limiter、External API 的狀態圓點：它們沒有 ρ
export const STATUS_FILL: Record<Status, string> = {
  OK: 'bg-ok',
  WARN: 'bg-warn',
  CRITICAL: 'bg-critical',
  OVERLOADED: 'bg-over shadow-md shadow-over/80',
  LIMITING: 'bg-muted-foreground/40',
  NOT_LIMITING: 'bg-muted-foreground/40',
  OVER_QUOTA: 'bg-muted-foreground/40',
  WITHIN_QUOTA: 'bg-muted-foreground/40',
}

// ECharts 畫在 canvas 上吃不到 CSS 變數，用 index.css 裡同樣的值，改配色時要一起改。
// neutral 是 muted-foreground：Client（沒有狀態）、Rate Limiter 和配額內的 External API 的 Sankey 節點
export const SANKEY_COLORS = {
  dark: {
    ok: '#34d399',
    warn: '#facc15',
    critical: '#fb923c',
    over: '#f87171',
    neutral: '#8b97b3',
    text: '#eef2fa',
    tooltip: '#121a2e',
    tooltipBorder: '#26324f',
  },
  light: {
    ok: '#10b981',
    warn: '#f59e0b',
    critical: '#f97316',
    over: '#ef4444',
    neutral: '#62677e',
    text: '#1b1f3b',
    tooltip: '#ffffff',
    tooltipBorder: '#e4e6ef',
  },
} satisfies Record<Theme, Record<string, string>>

export type SankeyColors = (typeof SANKEY_COLORS)[Theme]

// Sankey 節點依狀態取 SANKEY_COLORS 裡的哪個顏色
export const SANKEY_STATUS_COLOR: Record<Status, keyof SankeyColors> = {
  OK: 'ok',
  WARN: 'warn',
  CRITICAL: 'critical',
  OVERLOADED: 'over',
  LIMITING: 'neutral',
  NOT_LIMITING: 'neutral',
  OVER_QUOTA: 'over',
  WITHIN_QUOTA: 'neutral',
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
