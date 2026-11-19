import type { components } from '@/api/schema'
import { DASH, formatMs, formatMsNumber, formatPercent, formatRps, formatRpsNumber } from '@/canvas/format'

// 計算說明的一步（spec 4.9）：formula 裡大括號中的符號是代入值，對應 terms 裡同名的項目
export type ExplanationStep = components['schemas']['ExplanationStep']
export type ExplanationTerm = components['schemas']['ExplanationTerm']

// 沒有定義（例如過載時的延遲），不是 0
export const UNDEFINED_VALUE = '沒有定義'

const PLACEHOLDER = /\{([^}]+)\}/g

// 代入值之後的一段公式：文字，或是一個代入值（來自別的節點時帶著 nodeId，畫面上可以點過去）
export type FormulaPart = { kind: 'text'; text: string } | { kind: 'term'; text: string; nodeId: string | null }

// 沒有單位的數字（ρ、c、負載 a、呼叫次數）：整數加千分位，其他兩位小數（和指標表的 ρ 一樣），太小的用兩位有效數字
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString()
  return Math.abs(value) >= 0.01
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toPrecision(2)
}

// 0–1 的比例：和指標表一樣取一位小數；接近 100% 或 0% 但不是的，寫「> 99.9%」「< 0.1%」，看得出不是剛好
export function formatRatio(value: number): string {
  const text = formatPercent(value)
  if (value < 1 && text === '100.0%') return '> 99.9%'
  if (value > 0 && text === '0.0%') return '< 0.1%'
  return text
}

// 公式裡的代入值：數字和指標表用同一組格式，但不帶單位（單位寫在這一步的結果）；比例帶 %；沒有定義時是「—」
export function formatTerm(term: Pick<ExplanationTerm, 'value' | 'unit'>): string {
  return term.value == null ? DASH : formatValue(term.value, term.unit, false)
}

// 這一步的結果，帶單位
export function formatResult(step: Pick<ExplanationStep, 'value' | 'unit'>): string {
  return step.value == null ? UNDEFINED_VALUE : formatValue(step.value, step.unit, true)
}

function formatValue(value: number, unit: string | null, withUnit: boolean): string {
  switch (unit) {
    case 'rps':
      return withUnit ? formatRps(value) : formatRpsNumber(value)
    case 'ms':
      return withUnit ? formatMs(value) : formatMsNumber(value)
    case '%':
      return formatRatio(value)
    default:
      return formatNumber(value)
  }
}

// 公式有沒有代入值；沒有的是純文字說明（例如「ρ ≥ 1 時佇列會無限成長…」）
export function hasTerms(step: Pick<ExplanationStep, 'formula'>): boolean {
  return new RegExp(PLACEHOLDER.source).test(step.formula)
}

// 只有符號的公式，例如「λ ÷ (c × μ)」
export function symbolicFormula(step: Pick<ExplanationStep, 'formula'>): string {
  return step.formula.replace(PLACEHOLDER, (_, symbol: string) => symbol)
}

// 代入值之後的公式，例如「1,000 ÷ (8 × 100)」；符號在 terms 裡找不到時照原樣留著
export function substitutedFormula(step: Pick<ExplanationStep, 'formula' | 'terms'>): FormulaPart[] {
  const terms = new Map(step.terms.map((term) => [term.symbol, term]))
  const parts: FormulaPart[] = []
  let last = 0
  for (const match of step.formula.matchAll(PLACEHOLDER)) {
    if (match.index > last) parts.push({ kind: 'text', text: step.formula.slice(last, match.index) })
    const term = terms.get(match[1])
    parts.push(
      term
        ? { kind: 'term', text: formatTerm(term), nodeId: term.nodeId }
        : { kind: 'text', text: match[1] },
    )
    last = match.index + match[0].length
  }
  if (last < step.formula.length) parts.push({ kind: 'text', text: step.formula.slice(last) })
  return parts
}

// 相鄰同一組的步驟放在一起，依原本的順序
export function groupSteps<T extends Pick<ExplanationStep, 'group'>>(steps: readonly T[]): { group: string; steps: T[] }[] {
  const groups: { group: string; steps: T[] }[] = []
  for (const step of steps) {
    const current = groups.at(-1)
    if (current?.group === step.group) {
      current.steps.push(step)
    } else {
      groups.push({ group: step.group, steps: [step] })
    }
  }
  return groups
}

// 「怎麼算的」區塊要顯示什麼：拓撲有驗證錯誤、沒有結果時不顯示；未連線的不計算；
// 還沒 Run 過，或上次 Run 時這個節點還沒連線（結果裡沒有步驟）時等下一次 Run
export type ExplanationState = 'hidden' | 'unconnected' | 'pending' | 'ready'

export function explanationState({
  steps,
  unconnected,
  invalid,
}: {
  steps: readonly ExplanationStep[] | undefined
  unconnected: boolean
  invalid: boolean
}): ExplanationState {
  const computed = steps !== undefined && steps.length > 0
  if (invalid && !computed) return 'hidden'
  if (unconnected) return 'unconnected'
  return computed ? 'ready' : 'pending'
}
