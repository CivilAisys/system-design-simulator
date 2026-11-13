import type { Edge, NodeType } from '@/api/client'
import type { NodeParams } from './catalog'

export type NodeNumberParam = 'rps' | 'readRatio' | 'instances' | 'concurrency' | 'serviceTimeMs' | 'hitRatio'
export type EdgeNumberParam = keyof Pick<Edge, 'weight' | 'callsPerRequest' | 'latencyMs'>

export type NumberSpec = {
  label: string
  unit?: string
  integer?: boolean
  min: number
  // true 時 min 本身不合法（例如 weight > 0）
  minExclusive?: boolean
  max?: number
  // slider 只是方便拖曳的常用範圍，Input 可以輸入範圍外但合法的值。
  // 跨好幾個數量級的參數用對數刻度，否則小數值根本拖不到
  slider: { min: number; max: number; scale: 'linear' | 'log'; step?: number }
}

// instances × concurrency 的上限（spec 4.5）：看乘積，不是各自檢查
export const MAX_WORKERS = 1_000_000

// 合法範圍要和 spec 4.5 的 INVALID_PARAM 一致
export const NODE_PARAM_SPECS: Record<NodeNumberParam, NumberSpec> = {
  rps: { label: 'rps', unit: 'rps', min: 0, max: 1e12, slider: { min: 1, max: 1_000_000, scale: 'log' } },
  readRatio: { label: 'readRatio', min: 0, max: 1, slider: { min: 0, max: 1, scale: 'linear', step: 0.01 } },
  instances: {
    label: 'instances',
    integer: true,
    min: 1,
    max: MAX_WORKERS,
    slider: { min: 1, max: 50, scale: 'linear', step: 1 },
  },
  concurrency: {
    label: 'concurrency',
    integer: true,
    min: 1,
    max: MAX_WORKERS,
    slider: { min: 1, max: 10_000, scale: 'log' },
  },
  serviceTimeMs: {
    label: 'serviceTimeMs',
    unit: 'ms',
    min: 1e-6,
    max: 1e7,
    slider: { min: 0.01, max: 10_000, scale: 'log' },
  },
  hitRatio: { label: 'hitRatio', min: 0, max: 1, slider: { min: 0, max: 1, scale: 'linear', step: 0.01 } },
}

export const EDGE_PARAM_SPECS: Record<EdgeNumberParam, NumberSpec> = {
  // weight 為 0 的下游收不到流量，等於沒有接（spec 4.5），所以要 > 0
  weight: {
    label: 'weight',
    min: 0,
    minExclusive: true,
    max: 1e6,
    slider: { min: 0.1, max: 10, scale: 'linear', step: 0.1 },
  },
  callsPerRequest: {
    label: 'callsPerRequest',
    integer: true,
    min: 1,
    max: 10_000,
    slider: { min: 1, max: 10, scale: 'linear', step: 1 },
  },
  latencyMs: {
    label: 'latencyMs',
    unit: 'ms',
    min: 0,
    max: 1e7,
    slider: { min: 0, max: 200, scale: 'linear', step: 1 },
  },
}

const CAPACITY_PARAMS: NodeNumberParam[] = ['instances', 'concurrency', 'serviceTimeMs']

// 屬性面板只列出該類型有意義的參數（callMode 不是數值，另外處理）
export const NODE_NUMBER_PARAMS: Record<NodeType, NodeNumberParam[]> = {
  CLIENT: ['rps', 'readRatio'],
  LOAD_BALANCER: CAPACITY_PARAMS,
  SERVICE: CAPACITY_PARAMS,
  CACHE: [...CAPACITY_PARAMS, 'hitRatio'],
  DATABASE: CAPACITY_PARAMS,
}

// spec 3.4：weight 只對 Client／LB 的出邊有意義，callsPerRequest 只對 Service 的出邊有意義
export function edgeNumberParams(sourceType: NodeType): EdgeNumberParam[] {
  switch (sourceType) {
    case 'CLIENT':
    case 'LOAD_BALANCER':
      return ['weight', 'latencyMs']
    case 'SERVICE':
      return ['callsPerRequest', 'latencyMs']
    default:
      return ['latencyMs']
  }
}

export function nodeParam(params: NodeParams, param: NodeNumberParam): number {
  return params[param] ?? 0
}

// 不合法時回傳給使用者看的訊息，合法時回傳 null
export function checkNumber(spec: NumberSpec, value: number): string | null {
  const range = describeRange(spec)
  if (!Number.isFinite(value)) {
    return `請輸入數字（${range}）`
  }
  if (spec.integer && !Number.isInteger(value)) {
    return `必須是整數（${range}）`
  }
  const belowMin = spec.minExclusive ? value <= spec.min : value < spec.min
  if (belowMin || (spec.max !== undefined && value > spec.max)) {
    return `超出範圍（${range}）`
  }
  return null
}

const WORKER_PARTNER: Partial<Record<NodeNumberParam, NodeNumberParam>> = {
  instances: 'concurrency',
  concurrency: 'instances',
}

// 節點參數的檢查：單一參數的範圍之外，instances、concurrency 還要看和另一個的乘積（另一個取目前的值）
export function checkNodeParam(params: NodeParams, param: NodeNumberParam, value: number): string | null {
  const error = checkNumber(NODE_PARAM_SPECS[param], value)
  const partner = WORKER_PARTNER[param]
  if (error !== null || partner === undefined) {
    return error
  }
  const workers = value * nodeParam(params, partner)
  return workers > MAX_WORKERS
    ? `instances × concurrency 不能超過 ${formatBound(MAX_WORKERS)}（目前是 ${formatBound(workers)}）`
    : null
}

// 輸入框的字串 → 數值。空白要當成不合法，不能像 Number('') 變成 0
export function parseDraft(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

// 輸入框要顯示的字串：草稿已經代表目前的值（例如還在打的 "1."）就保留，否則換成目前的值
export function syncDraft(draft: string, value: number): string {
  return parseDraft(draft) === value ? draft : String(value)
}

function describeRange(spec: NumberSpec): string {
  const min = formatBound(spec.min)
  if (spec.max === undefined) {
    return `${spec.minExclusive ? '>' : '≥'} ${min}`
  }
  const max = formatBound(spec.max)
  return spec.minExclusive ? `> ${min} 且 ≤ ${max}` : `${min} ～ ${max}`
}

// 和後端訊息的寫法一致，例如 0.000001、10,000,000（不用 1e-6 這種科學記號）
function formatBound(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

const LOG_STEPS = 1000

// slider 位置 ↔ 參數值。對數刻度時 slider 在 0..LOG_STEPS 之間移動
export function sliderRange(spec: NumberSpec): { min: number; max: number; step: number } {
  const { slider } = spec
  return slider.scale === 'log'
    ? { min: 0, max: LOG_STEPS, step: 1 }
    : { min: slider.min, max: slider.max, step: slider.step ?? 1 }
}

export function toSlider(spec: NumberSpec, value: number): number {
  const { slider } = spec
  const clamped = Math.min(Math.max(value, slider.min), slider.max)
  if (slider.scale === 'linear') {
    return clamped
  }
  return (Math.log(clamped / slider.min) / Math.log(slider.max / slider.min)) * LOG_STEPS
}

export function fromSlider(spec: NumberSpec, position: number): number {
  const { slider } = spec
  if (slider.scale === 'linear') {
    // 避免 0.1 × 3 這類浮點誤差出現在輸入框裡
    return Number(position.toFixed(4))
  }
  const value = slider.min * (slider.max / slider.min) ** (position / LOG_STEPS)
  // 對數刻度拖出來的值取 2 位有效數字，避免出現 1234.567
  return spec.integer ? Math.max(spec.min, Math.round(Number(value.toPrecision(2)))) : Number(value.toPrecision(2))
}
