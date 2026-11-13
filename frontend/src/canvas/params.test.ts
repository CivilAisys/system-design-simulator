import { describe, expect, it } from 'vitest'
import type { NodeParams } from './catalog'
import {
  checkNodeParam,
  checkNumber,
  EDGE_PARAM_SPECS,
  fromSlider,
  NODE_PARAM_SPECS,
  parseDraft,
  sliderRange,
  syncDraft,
  toSlider,
} from './params'

const { rps, readRatio, instances, concurrency, serviceTimeMs } = NODE_PARAM_SPECS
const { weight, callsPerRequest, latencyMs } = EDGE_PARAM_SPECS

describe('checkNumber', () => {
  it.each([
    [rps, 0],
    [rps, 5_000_000],
    [readRatio, 0],
    [readRatio, 1],
    [instances, 1],
    [serviceTimeMs, 0.000001],
    [serviceTimeMs, 1e7],
    [latencyMs, 0],
    [rps, 1e12],
    [weight, 1e6],
  ])('%#: 範圍內的值合法', (spec, value) => {
    expect(checkNumber(spec, value)).toBeNull()
  })

  it('不是有限的數字', () => {
    expect(checkNumber(rps, Number.NaN)).toBe('請輸入數字（0 ～ 1,000,000,000,000）')
    expect(checkNumber(rps, Number.POSITIVE_INFINITY)).toBe('請輸入數字（0 ～ 1,000,000,000,000）')
  })

  it('整數參數不是整數', () => {
    expect(checkNumber(instances, 1.5)).toBe('必須是整數（1 ～ 1,000,000）')
  })

  it('小於下限', () => {
    expect(checkNumber(rps, -1)).toBe('超出範圍（0 ～ 1,000,000,000,000）')
    expect(checkNumber(instances, 0)).toBe('超出範圍（1 ～ 1,000,000）')
    expect(checkNumber(serviceTimeMs, 0)).toBe('超出範圍（0.000001 ～ 10,000,000）')
  })

  it('下限不含本身時，等於下限也不合法', () => {
    expect(checkNumber(weight, 0)).toBe('超出範圍（> 0 且 ≤ 1,000,000）')
  })

  it('大於上限', () => {
    expect(checkNumber(readRatio, 1.01)).toBe('超出範圍（0 ～ 1）')
    expect(checkNumber(rps, 1.1e12)).toBe('超出範圍（0 ～ 1,000,000,000,000）')
    expect(checkNumber(callsPerRequest, 10_001)).toBe('超出範圍（1 ～ 10,000）')
    expect(checkNumber(latencyMs, 1.1e7)).toBe('超出範圍（0 ～ 10,000,000）')
  })
})

describe('checkNodeParam', () => {
  const params: NodeParams = { instances: 1000, concurrency: 1000, serviceTimeMs: 10 }

  it('instances × concurrency 剛好是上限時合法', () => {
    expect(checkNodeParam(params, 'instances', 1000)).toBeNull()
  })

  it('乘積超過上限時不合法，即使各自都在範圍內', () => {
    expect(checkNodeParam(params, 'instances', 1001)).toBe(
      'instances × concurrency 不能超過 1,000,000（目前是 1,001,000）',
    )
    expect(checkNodeParam(params, 'concurrency', 2000)).toBe(
      'instances × concurrency 不能超過 1,000,000（目前是 2,000,000）',
    )
  })

  it('單一參數不合法時先報那個錯', () => {
    expect(checkNodeParam(params, 'instances', 0)).toBe('超出範圍（1 ～ 1,000,000）')
  })

  it('其他參數只看自己的範圍', () => {
    expect(checkNodeParam(params, 'serviceTimeMs', 1e7)).toBeNull()
  })
})

describe('sliderRange', () => {
  it('線性刻度直接用參數的範圍和間隔', () => {
    expect(sliderRange(readRatio)).toEqual({ min: 0, max: 1, step: 0.01 })
  })

  it('對數刻度在 0..1000 之間移動', () => {
    expect(sliderRange(rps)).toEqual({ min: 0, max: 1000, step: 1 })
  })
})

describe('線性刻度', () => {
  it('slider 位置就是參數值', () => {
    expect(toSlider(readRatio, 0.25)).toBe(0.25)
    expect(fromSlider(readRatio, 0.25)).toBe(0.25)
  })

  it('範圍外的值停在兩端', () => {
    expect(toSlider(latencyMs, 500)).toBe(200)
    expect(toSlider(weight, 0.01)).toBe(0.1)
  })

  it('去掉浮點誤差', () => {
    expect(fromSlider(weight, 0.1 * 3)).toBe(0.3)
  })
})

describe('對數刻度', () => {
  it('兩端和中點', () => {
    // rps 的 slider 是 1 ～ 1,000,000，中點是幾何平均 1000
    expect(toSlider(rps, 1)).toBe(0)
    expect(toSlider(rps, 1_000_000)).toBe(1000)
    expect(toSlider(rps, 1000)).toBeCloseTo(500)
    expect(fromSlider(rps, 0)).toBe(1)
    expect(fromSlider(rps, 500)).toBe(1000)
    expect(fromSlider(rps, 1000)).toBe(1_000_000)
  })

  it('範圍外的值停在兩端', () => {
    expect(toSlider(rps, 0)).toBe(0)
    expect(toSlider(rps, 5_000_000)).toBe(1000)
  })

  it('拖出來的值取 2 位有效數字', () => {
    // 1,000,000^0.123 ≈ 5.47
    expect(fromSlider(rps, 123)).toBe(5.5)
    // 0.01 × 1,000,000^0.777 ≈ 457.1
    expect(fromSlider(serviceTimeMs, 777)).toBe(460)
  })

  it('整數參數取整數，且不小於下限', () => {
    // concurrency 的 slider 是 1 ～ 10,000：10,000^0.333 ≈ 21.5
    expect(fromSlider(concurrency, 333)).toBe(21)
    expect(fromSlider(concurrency, 0)).toBe(1)
    expect(fromSlider(concurrency, 1)).toBe(1)
  })

  it.each([1, 20, 5000, 1_000_000])('2 位有效數字的值 %d 換到 slider 再換回來不變', (value) => {
    expect(fromSlider(rps, toSlider(rps, value))).toBe(value)
  })
})

describe('parseDraft', () => {
  it('空白不是 0', () => {
    expect(parseDraft('')).toBeNaN()
    expect(parseDraft('  ')).toBeNaN()
  })

  it('數字字串', () => {
    expect(parseDraft('0')).toBe(0)
    expect(parseDraft(' 1.5 ')).toBe(1.5)
    expect(parseDraft('1.')).toBe(1)
  })

  it('非數字', () => {
    expect(parseDraft('abc')).toBeNaN()
  })
})

describe('syncDraft', () => {
  it('清空的輸入框在值變成 0 時顯示 0', () => {
    expect(syncDraft('', 0)).toBe('0')
  })

  it('不合法的草稿換成目前的值', () => {
    expect(syncDraft('abc', 0.5)).toBe('0.5')
    expect(syncDraft('2', 0.5)).toBe('0.5')
  })

  it('還在打的合法字串保持不動', () => {
    expect(syncDraft('1.', 1)).toBe('1.')
    expect(syncDraft('0.50', 0.5)).toBe('0.50')
  })
})
