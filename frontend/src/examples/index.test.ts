import { describe, expect, it } from 'vitest'
import { toTopology } from '@/io/topologyFile'
import { EXAMPLES } from './index'

// 這個資料夾裡的所有範例檔，包含還沒加進選單的
const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' })

describe('內建範例', () => {
  it('找得到範例檔', () => {
    // glob 沒找到任何檔案時，下面的 it.each 不會產生測試
    expect(Object.keys(files).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(files))('%s 通過匯入檢查', (_, data) => {
    expect(toTopology(data)).toMatchObject({ ok: true })
  })

  it('選單裡的範例都有內容', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0)
    for (const example of EXAMPLES) {
      expect(example.topology.nodes.length).toBeGreaterThan(0)
    }
  })
})
