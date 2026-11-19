import { describe, expect, it } from 'vitest'
import { DASH } from '@/canvas/format'
import {
  explanationState,
  formatNumber,
  formatResult,
  formatTerm,
  groupSteps,
  hasTerms,
  substitutedFormula,
  symbolicFormula,
  type ExplanationStep,
} from './explanation'

const RHO: ExplanationStep = {
  group: '容量與使用率',
  label: '使用率 ρ（ρ < 0.7：OK）',
  formula: '{λ} ÷ ({c} × {μ})',
  terms: [
    { symbol: 'λ', value: 1000, unit: 'rps', nodeId: null },
    { symbol: 'c', value: 2, unit: null, nodeId: null },
    { symbol: 'μ', value: 1000, unit: 'rps', nodeId: null },
  ],
  value: 0.5,
  unit: null,
}

describe('formatNumber', () => {
  it('整數加千分位', () => {
    expect(formatNumber(1000)).toBe('1,000')
    expect(formatNumber(0)).toBe('0')
  })

  it('其他兩位小數，和指標表的 ρ 一樣', () => {
    expect(formatNumber(1234.567)).toBe('1,234.57')
    expect(formatNumber(150.456)).toBe('150.46')
    expect(formatNumber(0.5)).toBe('0.50')
  })

  it('太小的數字用兩位有效數字，不顯示成 0.00', () => {
    expect(formatNumber(2.806e-13)).toBe('2.8e-13')
    expect(formatNumber(0.004)).toBe('0.0040')
  })
})

describe('formatTerm', () => {
  it('比例和指標表一樣取一位小數', () => {
    expect(formatTerm({ value: 0.9, unit: '%' })).toBe('90.0%')
    expect(formatTerm({ value: 0.81234, unit: '%' })).toBe('81.2%')
    expect(formatTerm({ value: 0, unit: '%' })).toBe('0.0%')
    expect(formatTerm({ value: 1, unit: '%' })).toBe('100.0%')
  })

  it('接近 100% 或 0% 但不是的，看得出不是剛好', () => {
    expect(formatTerm({ value: 0.99999, unit: '%' })).toBe('> 99.9%')
    expect(formatTerm({ value: 4.98e-13, unit: '%' })).toBe('< 0.1%')
  })

  it('rps、ms 和指標表的數字一樣，但不帶單位；沒有定義時是「—」', () => {
    expect(formatTerm({ value: 1000, unit: 'rps' })).toBe('1,000')
    expect(formatTerm({ value: 12.6, unit: 'rps' })).toBe('13')
    expect(formatTerm({ value: 0.3, unit: 'rps' })).toBe('< 1')
    expect(formatTerm({ value: 50.43, unit: 'ms' })).toBe('50.4')
    expect(formatTerm({ value: 0.01, unit: 'ms' })).toBe('0.010')
    expect(formatTerm({ value: null, unit: 'ms' })).toBe(DASH)
  })

  it('儲存量：bytes 換單位並帶著單位，天數和 GB 只有數字', () => {
    expect(formatTerm({ value: 2000, unit: 'bytes' })).toBe('2.00 KB')
    expect(formatTerm({ value: 30, unit: 'days' })).toBe('30')
    expect(formatTerm({ value: 1000, unit: 'GB' })).toBe('1,000')
  })
})

describe('formatResult', () => {
  it('帶單位', () => {
    expect(formatResult({ value: 1000, unit: 'rps' })).toBe('1,000 rps')
    expect(formatResult({ value: 22.857, unit: 'ms' })).toBe('22.9 ms')
    expect(formatResult({ value: 0.81, unit: '%' })).toBe('81.0%')
    expect(formatResult({ value: 0.5, unit: null })).toBe('0.50')
    expect(formatResult({ value: 17.28e9, unit: 'bytes' })).toBe('17.3 GB')
    expect(formatResult({ value: 231.48, unit: 'days' })).toBe('約 231 天')
  })

  it('null 是沒有定義，不是 0', () => {
    expect(formatResult({ value: null, unit: 'ms' })).toBe('沒有定義')
  })
})

describe('symbolicFormula、substitutedFormula', () => {
  it('拿掉大括號就是符號的公式', () => {
    expect(symbolicFormula(RHO)).toBe('λ ÷ (c × μ)')
  })

  it('代入值依符號替換，文字照原樣留著', () => {
    expect(substitutedFormula(RHO)).toEqual([
      { kind: 'term', text: '1,000', nodeId: null },
      { kind: 'text', text: ' ÷ (' },
      { kind: 'term', text: '2', nodeId: null },
      { kind: 'text', text: ' × ' },
      { kind: 'term', text: '1,000', nodeId: null },
      { kind: 'text', text: ')' },
    ])
  })

  it('來自別的節點的代入值帶著 nodeId', () => {
    const step: ExplanationStep = {
      ...RHO,
      formula: '{pass} × {S₁}^{k₁}（說明）',
      terms: [
        { symbol: 'pass', value: 1, unit: '%', nodeId: null },
        { symbol: 'S₁', value: 0.9, unit: '%', nodeId: 'db' },
        { symbol: 'k₁', value: 2, unit: null, nodeId: null },
      ],
    }

    expect(substitutedFormula(step)).toEqual([
      { kind: 'term', text: '100.0%', nodeId: null },
      { kind: 'text', text: ' × ' },
      { kind: 'term', text: '90.0%', nodeId: 'db' },
      { kind: 'text', text: '^' },
      { kind: 'term', text: '2', nodeId: null },
      { kind: 'text', text: '（說明）' },
    ])
  })

  it('terms 裡找不到的符號照原樣留著', () => {
    expect(substitutedFormula({ formula: '{x} + 1', terms: [] })).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'text', text: ' + 1' },
    ])
  })
})

describe('hasTerms', () => {
  it('沒有大括號的是純文字說明', () => {
    expect(hasTerms(RHO)).toBe(true)
    expect(hasTerms({ formula: 'ρ ≥ 1 時佇列會無限成長，穩態下沒有定義' })).toBe(false)
  })
})

describe('groupSteps', () => {
  it('相鄰同一組的放在一起，順序不變', () => {
    const steps = [{ group: '到達量' }, { group: '到達量' }, { group: '最熱那台' }, { group: '整個節點' }]

    expect(groupSteps(steps).map(({ group, steps }) => [group, steps.length])).toEqual([
      ['到達量', 2],
      ['最熱那台', 1],
      ['整個節點', 1],
    ])
  })
})

describe('explanationState', () => {
  const steps = [RHO]

  it('有步驟時顯示，結果過期也照樣顯示（由畫面畫淡）', () => {
    expect(explanationState({ steps, unconnected: false, invalid: false })).toBe('ready')
  })

  it('未連線的不計算', () => {
    expect(explanationState({ steps: [], unconnected: true, invalid: false })).toBe('unconnected')
    expect(explanationState({ steps: undefined, unconnected: true, invalid: false })).toBe('unconnected')
  })

  it('還沒 Run 過，或上次 Run 時還沒連線（沒有步驟），等下一次 Run', () => {
    expect(explanationState({ steps: undefined, unconnected: false, invalid: false })).toBe('pending')
    expect(explanationState({ steps: [], unconnected: false, invalid: false })).toBe('pending')
  })

  it('拓撲有驗證錯誤、沒有結果時不顯示', () => {
    expect(explanationState({ steps: undefined, unconnected: false, invalid: true })).toBe('hidden')
    expect(explanationState({ steps: undefined, unconnected: true, invalid: true })).toBe('hidden')
  })
})
