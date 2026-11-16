import { describe, expect, it } from 'vitest'
import { NODE_KINDS, NODE_TYPES } from './catalog'
import { checkNodeParam, NODE_CHOICE_SPECS } from './params'

describe('Node type 定義', () => {
  it('元件面板列出每一種 type', () => {
    expect([...NODE_TYPES].sort()).toEqual(Object.keys(NODE_KINDS).sort())
  })

  it.each(NODE_TYPES)('%s 的預設值剛好涵蓋它的參數，而且都合法', (type) => {
    const { defaults, numberParams, choiceParams } = NODE_KINDS[type]
    expect(Object.keys(defaults).sort()).toEqual([...numberParams, ...choiceParams].sort())
    for (const param of numberParams) {
      expect(checkNodeParam(defaults, param, defaults[param]!)).toBeNull()
    }
    for (const param of choiceParams) {
      expect(NODE_CHOICE_SPECS[param].options.map((o) => o.value)).toContain(defaults[param])
    }
  })
})
