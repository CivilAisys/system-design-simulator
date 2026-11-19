import type { components } from '@/api/schema'
import { DASH } from '@/canvas/format'

// 計算說明的一步（spec 4.9）：formula 裡大括號中的符號是代入值，對應 terms 裡同名的項目
export type ExplanationStep = components['schemas']['ExplanationStep']
export type ExplanationTerm = components['schemas']['ExplanationTerm']

// 沒有定義（例如過載時的延遲），不是 0
export const UNDEFINED_VALUE = '沒有定義'

const PLACEHOLDER = /\{([^}]+)\}/g

// 代入值之後的一段公式：文字，或是一個代入值（來自別的節點時帶著 nodeId，畫面上可以點過去）
export type FormulaPart = { kind: 'text'; text: string } | { kind: 'term'; text: string; nodeId: string | null }

// 數字本身，不帶單位：整數加千分位、100 以上取整數、其他兩位小數，太小的用兩位有效數字（例如排隊時間 2.8e-13）
export function formatNumber(value: number): string {
  const size = Math.abs(value)
  if (Number.isInteger(value) || size >= 100) return Math.round(value).toLocaleString()
  if (size >= 0.01) return value.toFixed(2)
  return value.toPrecision(2)
}

// 0–1 的比例顯示成百分比，最多兩位小數、去掉多餘的 0；接近 0 但不是 0 的寫「< 0.01%」，看得出不是完全沒有
function formatPercent(value: number): string {
  const percent = value * 100
  if (percent === 0) return '0%'
  if (Math.abs(percent) < 0.01) return '< 0.01%'
  return `${Number(percent.toFixed(2))}%`
}

// 公式裡的代入值：百分比帶 %，其他不帶單位（單位寫在這一步的結果）；沒有定義時是「—」
export function formatTerm(term: Pick<ExplanationTerm, 'value' | 'unit'>): string {
  if (term.value == null) return DASH
  return term.unit === '%' ? formatPercent(term.value) : formatNumber(term.value)
}

// 這一步的結果，帶單位
export function formatResult(step: Pick<ExplanationStep, 'value' | 'unit'>): string {
  if (step.value == null) return UNDEFINED_VALUE
  if (step.unit === '%') return formatPercent(step.value)
  const number = formatNumber(step.value)
  return step.unit ? `${number} ${step.unit}` : number
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
