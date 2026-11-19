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
  explanationLines,
  MERGED_PREFIX,
  plainParts,
  type ExplanationStep,
} from './explanation'

const RHO: ExplanationStep = {
  group: '能處理多少',
  label: '使用率 ρ（ρ < 0.7：OK）',
  formula: '{λ} ÷ ({c} × {μ})',
  terms: [
    { symbol: 'λ', value: 1000, unit: 'rps', nodeId: null },
    { symbol: 'c', value: 2, unit: null, nodeId: null },
    { symbol: 'μ', value: 1000, unit: 'rps', nodeId: null },
    { symbol: '容量', value: 2000, unit: 'rps', nodeId: null },
  ],
  value: 0.5,
  unit: null,
  plain: '使用率 ρ {=} = 每秒進來 {λ} ÷ 每秒能處理 {容量}（低於 0.7，正常）',
  view: 'BOTH',
  requestClass: null,
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

  it('太小的數字用兩位有效數字，不顯示成 0.00；再小的寫「< 0.001」，不用科學記號（#189）', () => {
    expect(formatNumber(0.004)).toBe('0.0040')
    expect(formatNumber(2.806e-13)).toBe('< 0.001')
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

// 一步的預設值：兩種模式都顯示、不分 class
function step(fields: Partial<ExplanationStep> & Pick<ExplanationStep, 'group' | 'label'>): ExplanationStep {
  return { formula: '', terms: [], value: null, unit: null, plain: null, view: 'BOTH', requestClass: null, ...fields }
}

const ARRIVAL_READ = step({
  group: '進來多少',
  label: 'read 到達量',
  formula: '{x₁} × {v₁}',
  terms: [
    { symbol: 'x₁', value: 900, unit: 'rps', nodeId: 'client' },
    { symbol: 'v₁', value: 1, unit: '%', nodeId: null },
  ],
  value: 900,
  unit: 'rps',
  plain: '每秒進來 {=} = {@x₁} 處理完的 {x₁} × {v₁}',
  requestClass: 'READ',
})

// 成功率的一步：read、write 相同時合成一行
function pass(requestClass: 'READ' | 'WRITE', value: number): ExplanationStep {
  return step({
    group: '成功率',
    label: `${requestClass === 'READ' ? 'read' : 'write'} 通過率 pass`,
    formula: '{處理量} ÷ {λ}',
    terms: [
      { symbol: '處理量', value: 1000 * value, unit: 'rps', nodeId: null },
      { symbol: 'λ', value: 1000, unit: 'rps', nodeId: null },
    ],
    value,
    unit: '%',
    plain: '沒被丟掉的比例 {=} = 處理 {處理量} ÷ 進來 {λ}',
    requestClass,
  })
}

describe('plainParts', () => {
  it('代入值和結果換成數字，{@符號} 是那個代入值來自的節點', () => {
    expect(plainParts(ARRIVAL_READ)).toEqual([
      { kind: 'text', text: '每秒進來 900 = ' },
      { kind: 'node', nodeId: 'client' },
      { kind: 'text', text: ' 處理完的 900 × 100.0%' },
    ])
  })

  it('磁碟幾天後會滿寫成「約 116 天」', () => {
    const disk = step({ group: '磁碟', label: '磁碟幾天後會滿', plain: '磁碟{=}後會滿', value: 115.7, unit: 'days' })

    expect(plainParts(disk)).toEqual([{ kind: 'text', text: '磁碟約 116 天後會滿' }])
  })

  it('{@符號} 的代入值沒有 nodeId 時不印東西，不把數值當成名稱', () => {
    const noNode = { ...ARRIVAL_READ, terms: [{ ...ARRIVAL_READ.terms[0], nodeId: null }, ARRIVAL_READ.terms[1]] }

    expect(plainParts(noNode)).toEqual([{ kind: 'text', text: '每秒進來 900 =  處理完的 900 × 100.0%' }])
  })

  it('只在看公式顯示的步驟沒有白話', () => {
    expect(plainParts(step({ group: '在這裡花多久', label: '負載 a', view: 'FORMULA' }))).toEqual([])
  })
})

describe('explanationLines', () => {
  const queue = [
    step({ group: '在這裡花多久', label: '負載 a', formula: '{λ} ÷ {μ}', view: 'FORMULA' }),
    step({ group: '在這裡花多久', label: '排隊', plain: '排隊：幾乎不用排隊', view: 'PLAIN' }),
    step({ group: '在這裡花多久', label: '節點延遲 W', plain: '在這裡花 {=} ms', value: 50, unit: 'ms' }),
  ]

  it('白話模式不列只在看公式顯示的步驟；只在白話顯示的步驟沒有公式', () => {
    const [{ lines }] = explanationLines(queue, false)

    expect(lines.map((line) => line.formulas.map((formula) => formula.label))).toEqual([[], ['節點延遲 W']])
    expect(lines[1].plain).toEqual([{ kind: 'text', text: '在這裡花 50.0 ms' }])
  })

  it('看公式時只在看公式顯示的步驟也列出來，只有公式', () => {
    const [{ lines }] = explanationLines(queue, true)

    expect(lines).toHaveLength(3)
    expect(lines[0].plain).toEqual([])
    expect(lines[0].formulas.map((formula) => formula.label)).toEqual(['負載 a'])
  })

  it('read、write 代入後相同時合成一行，公式兩行都留著', () => {
    const [{ lines }] = explanationLines([pass('READ', 1), pass('WRITE', 1)], true)

    expect(lines).toHaveLength(1)
    expect(lines[0].prefix).toBe(MERGED_PREFIX)
    expect(lines[0].formulas.map((formula) => formula.label)).toEqual(['read 通過率 pass', 'write 通過率 pass'])
  })

  it('不同時分兩行，各自標上 read、write', () => {
    const [{ lines }] = explanationLines([pass('READ', 1), pass('WRITE', 0.5)], false)

    expect(lines.map((line) => line.prefix)).toEqual(['read：', 'write：'])
  })

  it('第 k 個 read 對第 k 個 write，不是相鄰的兩步', () => {
    // 成功率的順序是 pass(read)、S(read)、pass(write)、S(write)
    const success = (requestClass: 'READ' | 'WRITE', value: number) =>
      step({ group: '成功率', label: 'S', plain: '從這裡往下都成功的機率 {=}', value, unit: '%', requestClass })
    const [{ lines }] = explanationLines(
      [pass('READ', 1), success('READ', 1), pass('WRITE', 1), success('WRITE', 0.9)],
      false,
    )

    expect(lines.map((line) => line.prefix)).toEqual([MERGED_PREFIX, 'read：', 'write：'])
  })

  it('配對在整組裡算，兩種模式一樣', () => {
    // 假設只在看公式顯示的步驟也分 class：白話模式把它拿掉之後，後面的步驟不能錯開配對
    const formulaRead = step({ group: '成功率', label: 'x', view: 'FORMULA', requestClass: 'READ' })
    const steps = [formulaRead, pass('READ', 1), pass('WRITE', 1)]

    expect(explanationLines(steps, false)[0].lines.map((line) => line.prefix)).toEqual(['read：', 'write：'])
    expect(explanationLines(steps, true)[0].lines.map((line) => line.prefix)).toEqual(['read：', 'read：', 'write：'])
  })

  it('白話模式下整組都只在看公式顯示時不列這一組', () => {
    expect(explanationLines([step({ group: 'g', label: 'a', view: 'FORMULA' })], false)).toEqual([])
  })

  it('節點名稱不同時不合成一行', () => {
    const write = {
      ...ARRIVAL_READ,
      requestClass: 'WRITE' as const,
      terms: [{ ...ARRIVAL_READ.terms[0], nodeId: 'other' }, ARRIVAL_READ.terms[1]],
    }

    expect(explanationLines([ARRIVAL_READ, write], false)[0].lines).toHaveLength(2)
  })
})
