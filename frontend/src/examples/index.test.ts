import { describe, expect, it } from 'vitest'
import { toTopology } from '@/io/topologyFile'
import { EXAMPLES } from './index'

// 這個資料夾裡的所有範例檔
const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' })

describe('內建範例', () => {
  it('找得到範例檔', () => {
    // glob 沒找到任何檔案時，下面的 it.each 不會產生測試
    expect(Object.keys(files).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(files))('%s 通過匯入檢查', (_, data) => {
    expect(toTopology(data)).toMatchObject({ ok: true })
  })

  // 後端整合測試跑資料夾裡的每一個檔案，選單漏掉的範例檔就只測到、使用者看不到
  it('每個範例檔都在選單裡，id 和檔名相同', () => {
    const names = Object.keys(files).map((path) => path.replace(/^\.\/(.*)\.json$/, '$1'))
    expect(EXAMPLES.map((example) => example.id).sort()).toEqual(names.sort())
  })

  it('選單裡的範例都有內容', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0)
    for (const example of EXAMPLES) {
      expect(example.topology.nodes.length).toBeGreaterThan(0)
    }
  })
})
