import type { components } from '@/api/schema'
import {
  DASH,
  formatBytes,
  formatDays,
  TINY,
  formatMs,
  formatMsNumber,
  formatPercent,
  formatRps,
  formatRpsNumber,
} from '@/canvas/format'

// 計算說明的一步（spec 4.9）：formula 裡大括號中的符號是代入值，對應 terms 裡同名的項目
export type ExplanationStep = components['schemas']['ExplanationStep']
export type ExplanationTerm = components['schemas']['ExplanationTerm']

// 沒有定義（例如過載時的延遲），不是 0
export const UNDEFINED_VALUE = '沒有定義'

const PLACEHOLDER = /\{([^}]+)\}/g

// 代入值之後的一段公式：文字，或是一個代入值（來自別的節點時帶著 nodeId，畫面上可以點過去）
export type FormulaPart = { kind: 'text'; text: string } | { kind: 'term'; text: string; nodeId: string | null }

// 沒有單位的數字（ρ、c、負載 a、呼叫次數）：整數加千分位，其他兩位小數（和指標表的 ρ 一樣），太小的用兩位有效數字，
// 再小的寫「< 0.001」，不用科學記號
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString()
  if (Math.abs(value) >= 0.01) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return value > 0 && value < TINY ? `< ${TINY}` : value.toPrecision(2)
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

// bytes 會換成 KB、GB 等單位，代入值也帶著單位；其他和指標表、容量估算表一樣。GB 只當代入值（磁碟容量），和沒有單位的數字一樣
function formatValue(value: number, unit: string | null, withUnit: boolean): string {
  switch (unit) {
    case 'bytes':
      return formatBytes(value)
    case 'days':
      return withUnit ? formatDays(value) : formatNumber(value)
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

// 白話的一段：文字（代入值也已經換成文字），或節點名稱（模板裡的 {@符號}，畫面上可以點過去）
export type PlainPart = { kind: 'text'; text: string } | { kind: 'node'; nodeId: string }

// 白話模板代入之後（spec 4.9）：{符號} 和代入值同樣格式，{=} 是這一步的結果，{@符號} 是那個代入值來自的節點。
// days（磁碟幾天後會滿）寫成「約 116 天」，模板是「磁碟{=}後會滿」。只在看公式顯示的步驟沒有白話
export function plainParts(step: Pick<ExplanationStep, 'plain' | 'terms' | 'value' | 'unit'>): PlainPart[] {
  if (step.plain == null) return []
  const terms = new Map(step.terms.map((term) => [term.symbol, term]))
  const parts: PlainPart[] = []
  let text = ''
  let last = 0
  for (const match of step.plain.matchAll(PLACEHOLDER)) {
    text += step.plain.slice(last, match.index)
    last = match.index + match[0].length
    const symbol = match[1]
    const term = terms.get(symbol.replace(/^@/, ''))
    if (symbol === '=') {
      text += formatPlainResult(step)
    } else if (symbol.startsWith('@')) {
      // 代入值沒有 nodeId 時（後端的測試保證不會）不印東西，不把數值當成名稱
      if (term?.nodeId == null) continue
      if (text) parts.push({ kind: 'text', text })
      text = ''
      parts.push({ kind: 'node', nodeId: term.nodeId })
    } else {
      // 符號在 terms 裡找不到時照原樣留著
      text += term ? formatTerm(term) : symbol
    }
  }
  text += step.plain.slice(last)
  if (text) parts.push({ kind: 'text', text })
  return parts
}

function formatPlainResult(step: Pick<ExplanationStep, 'value' | 'unit'>): string {
  if (step.value == null) return UNDEFINED_VALUE
  return step.unit === 'days' ? formatDays(step.value) : formatValue(step.value, step.unit, false)
}

// 「怎麼算的」的一行：白話一句，看公式時底下是原本的公式
export type ExplanationLine = {
  // 「read：」「write：」，read、write 合成一行時是「read、write 都是：」；不分 class 的步驟沒有
  prefix: string | null
  // 只在看公式顯示的步驟是空的
  plain: PlainPart[]
  // 看公式時這一行底下的公式；合成一行時 read、write 各一行；只在白話顯示的步驟（排隊合併的那一步）沒有
  formulas: ExplanationStep[]
}

export const MERGED_PREFIX = 'read、write 都是：'
const CLASS_PREFIX = { READ: 'read：', WRITE: 'write：' } as const

// 依分組列出要顯示的行（spec 4.9、第 6 節）。白話模式不列只在看公式顯示的步驟。
// 同一組裡第 k 個 read 步驟對第 k 個 write 步驟，代入之後白話相同就合成一行，放在 read 的位置。
// 先在整組裡配對再依模式篩選，兩種模式的配對才會一樣
export function explanationLines(
  steps: readonly ExplanationStep[],
  showFormula: boolean,
): { group: string; lines: ExplanationLine[] }[] {
  const visible = (step: ExplanationStep) => showFormula || step.view !== 'FORMULA'
  const groups = groupSteps(steps).map(({ group, steps: grouped }) => {
    const reads = grouped.filter((step) => step.requestClass === 'READ')
    const writes = grouped.filter((step) => step.requestClass === 'WRITE')
    const pairs = new Map<ExplanationStep, ExplanationStep>()
    reads.forEach((read, k) => {
      const write = writes[k]
      if (write && samePlain(read, write)) pairs.set(read, write)
    })
    const absorbed = new Set(pairs.values())
    const lines = grouped
      .filter((step) => !absorbed.has(step) && visible(step))
      .map((step): ExplanationLine => {
        const pair = pairs.get(step)
        const classPrefix = step.requestClass === 'READ' || step.requestClass === 'WRITE' ? step.requestClass : null
        return {
          prefix: pair ? MERGED_PREFIX : classPrefix && CLASS_PREFIX[classPrefix],
          plain: plainParts(step),
          formulas: step.view === 'PLAIN' ? [] : pair ? [step, pair] : [step],
        }
      })
    return { group, lines }
  })
  return groups.filter(({ lines }) => lines.length > 0)
}

function samePlain(a: ExplanationStep, b: ExplanationStep): boolean {
  if (a.plain == null || b.plain == null) return false
  const key = (step: ExplanationStep) =>
    JSON.stringify(plainParts(step).map((part) => (part.kind === 'text' ? part.text : { node: part.nodeId })))
  return key(a) === key(b)
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
