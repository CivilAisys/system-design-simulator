import { describe, expect, it } from 'vitest'
import type { Topology } from '@/api/client'
import { initialTopology } from '@/canvas/initialTopology'
import { restoreTopology, saveTopology, type TopologyStorage } from './autosave'

function memoryStorage(initial: Record<string, string> = {}): TopologyStorage {
  const items = { ...initial }
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

// 無痕模式或封鎖網站資料時，存取 localStorage 會丟例外
const blockedStorage: TopologyStorage = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError')
  },
}

// 和起始拓撲不同，才分得出是還原的存檔還是 fallback
const saved: Topology = { ...initialTopology, nodes: initialTopology.nodes.slice(0, 1), edges: [] }

describe('restoreTopology', () => {
  it('restores what saveTopology stored', () => {
    const storage = memoryStorage()
    saveTopology(saved, storage)
    expect(restoreTopology(initialTopology, storage)).toEqual({ topology: saved, error: null })
  })

  it('falls back silently when nothing is saved', () => {
    expect(restoreTopology(initialTopology, memoryStorage())).toEqual({ topology: initialTopology, error: null })
  })

  it('falls back silently when storage is blocked', () => {
    expect(restoreTopology(initialTopology, blockedStorage)).toEqual({ topology: initialTopology, error: null })
  })

  it('falls back with the error when the save is corrupt', () => {
    const restored = restoreTopology(initialTopology, memoryStorage({ topology: '{"version": 1, "nodes": [' }))
    expect(restored).toEqual({ topology: initialTopology, error: '不是合法的 JSON' })
  })

  it('falls back with the error when the version is unsupported', () => {
    const storage = memoryStorage({ topology: JSON.stringify({ ...saved, version: 2 }) })
    const restored = restoreTopology(initialTopology, storage)
    expect(restored.topology).toBe(initialTopology)
    expect(restored.error).toContain('不支援的版本 2')
  })
})

describe('saveTopology', () => {
  it('ignores storage errors', () => {
    expect(() => saveTopology(saved, blockedStorage)).not.toThrow()
  })
})
