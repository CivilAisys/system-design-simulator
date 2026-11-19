import { describe, expect, it } from 'vitest'
import { DASH } from '@/canvas/format'
import {
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

  it('100 以上取整數，其他兩位小數', () => {
    expect(formatNumber(1234.56)).toBe('1,235')
    expect(formatNumber(22.857)).toBe('22.86')
    expect(formatNumber(0.5)).toBe('0.50')
  })

  it('太小的數字用兩位有效數字，不顯示成 0.00', () => {
    expect(formatNumber(2.806e-13)).toBe('2.8e-13')
    expect(formatNumber(0.004)).toBe('0.0040')
  })
})

describe('formatTerm', () => {
  it('比例顯示成百分比，去掉多餘的 0', () => {
    expect(formatTerm({ value: 0.9, unit: '%' })).toBe('90%')
    expect(formatTerm({ value: 0.81234, unit: '%' })).toBe('81.23%')
    expect(formatTerm({ value: 0, unit: '%' })).toBe('0%')
  })

  it('接近 0 但不是 0 的比例寫「< 0.01%」', () => {
    expect(formatTerm({ value: 4.98e-13, unit: '%' })).toBe('< 0.01%')
  })

  it('其他單位不帶單位；沒有定義時是「—」', () => {
    expect(formatTerm({ value: 1000, unit: 'rps' })).toBe('1,000')
    expect(formatTerm({ value: 50, unit: 'ms' })).toBe('50')
    expect(formatTerm({ value: null, unit: 'ms' })).toBe(DASH)
  })
})

describe('formatResult', () => {
  it('帶單位', () => {
    expect(formatResult({ value: 1000, unit: 'rps' })).toBe('1,000 rps')
    expect(formatResult({ value: 22.857, unit: 'ms' })).toBe('22.86 ms')
    expect(formatResult({ value: 0.81, unit: '%' })).toBe('81%')
    expect(formatResult({ value: 0.5, unit: null })).toBe('0.50')
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
      { kind: 'term', text: '100%', nodeId: null },
      { kind: 'text', text: ' × ' },
      { kind: 'term', text: '90%', nodeId: 'db' },
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
