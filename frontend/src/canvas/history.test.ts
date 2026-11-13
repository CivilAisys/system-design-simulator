import { describe, expect, it } from 'vitest'
import { commit, createHistory, MERGE_MS, redo, replace, undo } from './history'

describe('commit', () => {
  it('每次修改記成一步，可以一步步復原', () => {
    let h = createHistory('a')
    h = commit(h, 'b', { at: 1 })
    h = commit(h, 'c', { at: 2 })
    expect(h.present).toBe('c')
    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    expect(h.past).toEqual([])
  })

  it('沒有改變時不記', () => {
    const h = createHistory('a')
    expect(commit(h, 'a', { at: 1 })).toBe(h)
  })

  it('同一個群組連續修改併成一步', () => {
    let h = createHistory('')
    h = commit(h, 'a', { group: 'name', at: 0 })
    h = commit(h, 'ab', { group: 'name', at: MERGE_MS - 1 })
    // 間隔從上一次修改算起，一直打字就一直合併
    h = commit(h, 'abc', { group: 'name', at: 2 * MERGE_MS - 2 })
    expect(h.past).toEqual([''])
    expect(undo(h).present).toBe('')
  })

  it('停太久、換群組或沒有群組時是新的一步', () => {
    let h = createHistory(0)
    h = commit(h, 1, { group: 'rps', at: 0 })
    h = commit(h, 2, { group: 'rps', at: MERGE_MS })
    h = commit(h, 3, { group: 'latency', at: MERGE_MS + 1 })
    h = commit(h, 4, { at: MERGE_MS + 2 })
    h = commit(h, 5, { at: MERGE_MS + 3 })
    expect(h.past).toEqual([0, 1, 2, 3, 4])
  })

  it('復原後做新的修改，重做紀錄清空', () => {
    let h = createHistory('a')
    h = commit(h, 'b', { at: 1 })
    h = undo(h)
    h = commit(h, 'c', { at: 2 })
    expect(h.future).toEqual([])
    expect(redo(h)).toBe(h)
  })

  it('復原之後的修改不會併進復原前的群組', () => {
    let h = createHistory('')
    h = commit(h, 'a', { group: 'name', at: 0 })
    h = commit(h, 'ab', { group: 'name', at: 1 })
    h = undo(h)
    h = commit(h, 'x', { group: 'name', at: 2 })
    expect(h.past).toEqual([''])
    expect(undo(h).present).toBe('')
  })

  it('只留最近 100 步', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 150; i++) {
      h = commit(h, i, { at: i })
    }
    expect(h.past).toHaveLength(100)
    expect(h.past[0]).toBe(50)
  })
})

describe('replace', () => {
  it('改狀態但不算一步，也不清重做紀錄', () => {
    let h = createHistory('a')
    h = commit(h, 'b', { at: 1 })
    h = undo(h)
    h = replace(h, 'a*')
    expect(h.past).toEqual([])
    expect(h.future).toEqual(['b'])
    expect(undo(commit(h, 'c', { at: 2 })).present).toBe('a*')
  })

  it('不打斷正在合併的群組', () => {
    let h = createHistory('')
    h = commit(h, 'a', { group: 'name', at: 0 })
    h = replace(h, 'a*')
    h = commit(h, 'a*b', { group: 'name', at: 1 })
    expect(h.past).toEqual([''])
  })
})

describe('undo／redo', () => {
  it('重做回到復原前', () => {
    let h = createHistory('a')
    h = commit(h, 'b', { at: 1 })
    h = commit(h, 'c', { at: 2 })
    h = undo(undo(h))
    h = redo(h)
    expect(h.present).toBe('b')
    h = redo(h)
    expect(h.present).toBe('c')
    expect(h.future).toEqual([])
  })

  it('沒有東西可復原或重做時不變', () => {
    const h = createHistory('a')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })
})
