import { Database, Network, Server, Users, Zap, type LucideIcon } from 'lucide-react'
import type { Node, NodeType } from '@/api/client'

export type NodeParams = Node['params']

type NodeKind = {
  label: string
  icon: LucideIcon
  // 新節點的 id 前綴
  idPrefix: string
  // spec 3.3 的預設值
  defaults: NodeParams
}

// 左側元件面板的順序
export const NODE_TYPES: NodeType[] = ['CLIENT', 'LOAD_BALANCER', 'SERVICE', 'CACHE', 'DATABASE']

export const NODE_KINDS: Record<NodeType, NodeKind> = {
  CLIENT: {
    label: 'Client',
    icon: Users,
    idPrefix: 'client',
    defaults: { rps: 1000, readRatio: 0.9 },
  },
  LOAD_BALANCER: {
    label: 'Load Balancer',
    icon: Network,
    idPrefix: 'lb',
    defaults: { instances: 1, concurrency: 1000, serviceTimeMs: 1 },
  },
  SERVICE: {
    label: 'Service',
    icon: Server,
    idPrefix: 'svc',
    defaults: { instances: 2, concurrency: 200, serviceTimeMs: 50, callMode: 'SEQUENTIAL' },
  },
  CACHE: {
    label: 'Cache',
    icon: Zap,
    idPrefix: 'cache',
    defaults: { instances: 1, concurrency: 1, serviceTimeMs: 0.01, hitRatio: 0.8 },
  },
  DATABASE: {
    label: 'Database',
    icon: Database,
    idPrefix: 'db',
    defaults: { instances: 1, concurrency: 100, serviceTimeMs: 10 },
  },
}

// Client 沒有上游、Database 沒有下游（spec 4.5），畫布上直接不給對應的 handle
export function hasInput(type: NodeType): boolean {
  return type !== 'CLIENT'
}

export function hasOutput(type: NodeType): boolean {
  return type !== 'DATABASE'
}

// 拖到畫布或點擊元件面板時建立的節點：id 和名稱都取同類型中第一個沒被用掉的編號
// usedIds 是這次編輯用過的所有 id（含已刪除的），新節點不能沿用：
// 過期的結果（Auto-run 關閉或還在 debounce）會用 id 把狀態和驗證錯誤畫到同 id 的新節點上
export function newNode(type: NodeType, usedIds: ReadonlySet<string>, position: { x: number; y: number }): Node {
  const { label, idPrefix, defaults } = NODE_KINDS[type]
  let n = 1
  while (usedIds.has(`${idPrefix}-${n}`)) {
    n++
  }
  return {
    id: `${idPrefix}-${n}`,
    type,
    name: `${label} ${n}`,
    params: { ...defaults },
    state: 'HEALTHY',
    ui: position,
  }
}
