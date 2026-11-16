import {
  Archive,
  Boxes,
  Cloud,
  Database,
  DatabaseBackup,
  Gauge,
  Globe,
  Inbox,
  Network,
  Server,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Edge, Node, NodeType } from '@/api/client'
import type { EdgeChoiceParam, EdgeNumberParam, NodeChoiceParam, NodeNumberParam } from './params'

export type NodeParams = Node['params']

// 非同步的邊（之後的 replication、Message Queue 的 consumer）不算進 Client 的端到端延遲，畫成虛線
export type EdgeKind = 'SYNC' | 'ASYNC'

// 元件的類別：元件面板依它分組，圖示方塊依它上色（category.ts、CategoryIcon）
export type Category = 'TRAFFIC' | 'COMPUTE' | 'DATA' | 'ASYNC'

// 元件面板的分組順序
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'TRAFFIC', label: '流量' },
  { id: 'COMPUTE', label: '運算' },
  { id: 'DATA', label: '資料' },
  { id: 'ASYNC', label: '非同步' },
]

// 一種 Node type 在前端的全部定義。新增 type 時只要在 NODE_TYPES 和 NODE_KINDS 各加一筆（spec 3.6）
type NodeKind = {
  label: string
  icon: LucideIcon
  category: Category
  // 新節點的 id 前綴
  idPrefix: string
  // spec 3.3 的預設值，涵蓋 numberParams 和 choiceParams 的每個參數
  defaults: NodeParams
  // 屬性面板依序列出的參數，也是匯入時讀取的參數。有 shards 的 type 可以分片，另外有 hotShardShare（spec 4.2.2）；
  // 有 retentionDays 的 type 估算儲存量，另外有 diskGbPerShard（spec 4.8）
  numberParams: NodeNumberParam[]
  choiceParams: NodeChoiceParam[]
  // 能不能有上游／下游（spec 4.5），畫布上沒有對應的 handle
  hasInput: boolean
  hasOutput: boolean
  // 出邊在屬性面板顯示的參數（spec 3.4）
  edgeParams: EdgeNumberParam[]
  edgeChoiceParams: EdgeChoiceParam[]
  // 出邊的種類，依 source 的 type 決定
  outputEdgeKind: EdgeKind
  // 只能連到這些 type（Database 只能連到 Read Replica，spec 4.5）；沒有時不限制
  outputTargets?: NodeType[]
  // Run 之後節點上顯示的指標：ρ，或沒有 ρ 的 Rate Limiter、External API 改顯示拒絕量
  nodeMetric: 'utilization' | 'rejected'
}

const CAPACITY_PARAMS: NodeNumberParam[] = ['instances', 'concurrency', 'serviceTimeMs']
// 儲存量估算（spec 4.8）；另外有沒有預設值的 diskGbPerShard
const STORAGE_PARAMS: NodeNumberParam[] = ['bytesPerWrite', 'retentionDays']
function storageDefaults(bytesPerWrite: number): NodeParams {
  return { bytesPerWrite, retentionDays: 365 }
}

// 左側元件面板的順序，同一類別的放在一起，類別的順序同 CATEGORIES
export const NODE_TYPES: NodeType[] = [
  'CLIENT',
  'LOAD_BALANCER',
  'CDN',
  'RATE_LIMITER',
  'SERVICE',
  'EXTERNAL_API',
  'CACHE',
  'DATABASE',
  'READ_REPLICA',
  'OBJECT_STORAGE',
  'MESSAGE_QUEUE',
]

export const NODE_KINDS: Record<NodeType, NodeKind> = {
  CLIENT: {
    label: 'Client',
    icon: Users,
    category: 'TRAFFIC',
    idPrefix: 'client',
    defaults: { rps: 1000, readRatio: 0.9, readResponseBytes: 10_000, writeRequestBytes: 1_000 },
    numberParams: ['rps', 'readRatio', 'readResponseBytes', 'writeRequestBytes'],
    choiceParams: [],
    hasInput: false,
    hasOutput: true,
    // weight 只對 Client／LB 的出邊有意義，callsPerRequest、requestClass 只對 Service 的出邊有意義
    edgeParams: ['weight', 'latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  LOAD_BALANCER: {
    label: 'Load Balancer',
    icon: Network,
    category: 'TRAFFIC',
    idPrefix: 'lb',
    defaults: { instances: 1, concurrency: 1000, serviceTimeMs: 1 },
    numberParams: CAPACITY_PARAMS,
    choiceParams: [],
    hasInput: true,
    hasOutput: true,
    edgeParams: ['weight', 'latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  SERVICE: {
    label: 'Service',
    icon: Server,
    category: 'COMPUTE',
    idPrefix: 'svc',
    defaults: { instances: 2, concurrency: 200, serviceTimeMs: 50, callMode: 'SEQUENTIAL' },
    numberParams: CAPACITY_PARAMS,
    choiceParams: ['callMode'],
    hasInput: true,
    hasOutput: true,
    edgeParams: ['callsPerRequest', 'latencyMs'],
    edgeChoiceParams: ['requestClass'],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  CACHE: {
    label: 'Cache',
    icon: Zap,
    category: 'DATA',
    idPrefix: 'cache',
    defaults: { instances: 1, concurrency: 1, serviceTimeMs: 0.01, hitRatio: 0.8, shards: 1 },
    numberParams: [...CAPACITY_PARAMS, 'hitRatio', 'shards'],
    choiceParams: [],
    hasInput: true,
    hasOutput: true,
    edgeParams: ['latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  // 計算和 Cache 相同（spec 3.3），只有預設值、圖示和名稱不同
  CDN: {
    label: 'CDN',
    icon: Globe,
    category: 'TRAFFIC',
    idPrefix: 'cdn',
    defaults: { instances: 10, concurrency: 1000, serviceTimeMs: 1, hitRatio: 0.95 },
    numberParams: [...CAPACITY_PARAMS, 'hitRatio'],
    choiceParams: [],
    hasInput: true,
    hasOutput: true,
    edgeParams: ['latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  DATABASE: {
    label: 'Database',
    icon: Database,
    category: 'DATA',
    idPrefix: 'db',
    defaults: { instances: 1, concurrency: 100, serviceTimeMs: 10, shards: 1, ...storageDefaults(1_000) },
    numberParams: [...CAPACITY_PARAMS, 'shards', ...STORAGE_PARAMS],
    choiceParams: [],
    hasInput: true,
    hasOutput: true,
    // 複製是非同步的（spec 4.2.3），邊上沒有參數可調
    edgeParams: [],
    edgeChoiceParams: [],
    outputEdgeKind: 'ASYNC',
    outputTargets: ['READ_REPLICA'],
    nodeMetric: 'utilization',
  },
  // primary 的唯讀副本：write 是 primary 複製過來的，read 由 Service 的 READ 邊送來；分片沿用 primary（spec 4.2.3）
  READ_REPLICA: {
    label: 'Read Replica',
    icon: DatabaseBackup,
    category: 'DATA',
    idPrefix: 'replica',
    defaults: { instances: 1, concurrency: 100, serviceTimeMs: 10 },
    numberParams: CAPACITY_PARAMS,
    choiceParams: [],
    hasInput: true,
    hasOutput: false,
    edgeParams: ['latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  // 計算和 Database 相同（spec 3.3），只有預設值、圖示和名稱不同
  OBJECT_STORAGE: {
    label: 'Object Storage',
    icon: Archive,
    category: 'DATA',
    idPrefix: 'storage',
    defaults: { instances: 1, concurrency: 10000, serviceTimeMs: 20, ...storageDefaults(1_000_000) },
    numberParams: [...CAPACITY_PARAMS, ...STORAGE_PARAMS],
    choiceParams: [],
    hasInput: true,
    hasOutput: false,
    edgeParams: ['latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'utilization',
  },
  // 沒有 M/M/c：只有全域上限 limitRps，超過的部分拒絕（spec 3.3）
  RATE_LIMITER: {
    label: 'Rate Limiter',
    icon: Gauge,
    category: 'TRAFFIC',
    idPrefix: 'limiter',
    defaults: { limitRps: 1000 },
    numberParams: ['limitRps'],
    choiceParams: [],
    hasInput: true,
    hasOutput: true,
    edgeParams: ['latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'rejected',
  },
  // 第三方服務，終點：固定延遲 latencyMs，超過 quotaRps 的部分被對方拒絕（spec 3.3）
  EXTERNAL_API: {
    label: 'External API',
    icon: Cloud,
    category: 'COMPUTE',
    idPrefix: 'ext',
    defaults: { latencyMs: 100, quotaRps: 1000 },
    numberParams: ['latencyMs', 'quotaRps'],
    choiceParams: [],
    hasInput: true,
    hasOutput: false,
    edgeParams: ['latencyMs'],
    edgeChoiceParams: [],
    outputEdgeKind: 'SYNC',
    nodeMetric: 'rejected',
  },
  // 非同步：Client 只等到 ack；每條下游邊是一個 consumer group，都收到全部訊息（spec 4.2.4）
  MESSAGE_QUEUE: {
    label: 'Message Queue',
    icon: Inbox,
    category: 'ASYNC',
    idPrefix: 'mq',
    defaults: { instances: 1, concurrency: 1000, serviceTimeMs: 1 },
    numberParams: CAPACITY_PARAMS,
    choiceParams: [],
    hasInput: true,
    hasOutput: true,
    // consumer group 的邊沒有參數可調：訊息全部送過去，延遲不算進 Client
    edgeParams: [],
    edgeChoiceParams: [],
    outputEdgeKind: 'ASYNC',
    // consumer group 的 consumer 數量用 Service 的 instances 表示
    outputTargets: ['SERVICE'],
    nodeMetric: 'utilization',
  },
}

// 元件面板的一個項目：每個 type 一個，另外有 preset（type 不變，只換名稱、圖示和部分預設值，JSON 裡看不出來）
export type PaletteItem = {
  id: string
  type: NodeType
  label: string
  icon: LucideIcon
  params?: Partial<NodeParams>
}

// preset 放在它的 type 後面
const PRESETS: PaletteItem[] = [
  // Redis Cluster = 分片的 Cache（spec 4.2.2）
  { id: 'REDIS_CLUSTER', type: 'CACHE', label: 'Redis Cluster', icon: Boxes, params: { shards: 3 } },
]

export const PALETTE: PaletteItem[] = NODE_TYPES.flatMap((type) => {
  const { label, icon } = NODE_KINDS[type]
  return [{ id: type, type, label, icon }, ...PRESETS.filter((preset) => preset.type === type)]
})

// 拖到畫布或點擊元件面板時建立的節點：id 和名稱都取同類型中第一個沒被用掉的編號
// usedIds 是這次編輯用過的所有 id（含已刪除的），新節點不能沿用：
// 過期的結果（Auto-run 關閉或還在 debounce）會用 id 把狀態和驗證錯誤畫到同 id 的新節點上
export function newNode(item: PaletteItem, usedIds: ReadonlySet<string>, position: { x: number; y: number }): Node {
  const { type, label } = item
  const n = nextNodeNumber(type, usedIds)
  return {
    id: nodeId(type, n),
    type,
    name: `${label} ${n}`,
    params: { ...NODE_KINDS[type].defaults, ...item.params },
    state: 'HEALTHY',
    ui: position,
  }
}

// 同類型中第一個沒用過的節點 id，規則同 newNode
export function newNodeId(type: NodeType, usedIds: ReadonlySet<string>): string {
  return nodeId(type, nextNodeNumber(type, usedIds))
}

function nextNodeNumber(type: NodeType, usedIds: ReadonlySet<string>): number {
  let n = 1
  while (usedIds.has(nodeId(type, n))) {
    n++
  }
  return n
}

function nodeId(type: NodeType, n: number): string {
  return `${NODE_KINDS[type].idPrefix}-${n}`
}

// 新邊的 id，理由同 newNode：刪掉再重連同一對節點時不能沿用舊的 id
export function newEdgeId(source: string, target: string, usedIds: ReadonlySet<string>): string {
  const base = `e-${source}-${target}`
  let id = base
  for (let n = 2; usedIds.has(id); n++) {
    id = `${base}-${n}`
  }
  return id
}

// source 的 type 能不能連到 target 的 type（另外還有 hasOutput／hasInput、重複和環的規則）
export function canFeed(source: NodeType, target: NodeType): boolean {
  return NODE_KINDS[source].outputTargets?.includes(target) ?? true
}

// 新邊的 requestClass：Read Replica 是唯讀的，Service 連過去的邊預設只送 read（spec 4.2.3），其他維持 ALL
export function newEdgeRequestClass(source: NodeType, target: NodeType): Edge['requestClass'] {
  return source === 'SERVICE' && target === 'READ_REPLICA' ? 'READ' : 'ALL'
}

// 複製的來源（Database）：連出去的邊是 Read Replica 套用的寫入，不是請求的流向
export function isReplicationSource(type: NodeType): boolean {
  return NODE_KINDS[type].outputTargets?.includes('READ_REPLICA') ?? false
}
