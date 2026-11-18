import type { Edge, Node, NodeType, Topology } from '@/api/client'
import { canFeed, NODE_KINDS, NODE_TYPES, type NodeParams } from '@/canvas/catalog'
import { EDGE_CHOICE_SPECS, NODE_CHOICE_SPECS, NODE_PARAM_SPECS } from '@/canvas/params'

const SUPPORTED_VERSION = 1
// 存檔沒有 ui 座標時，這些節點排成一列，放在有座標的節點下方
const FALLBACK_SPACING = 280

export type ParseResult = { ok: true; topology: Topology } | { ok: false; errors: string[] }

// 自動存檔是第 5 節的 Request 格式。這裡擋三種錯誤：
// - 後端會回 400 的格式錯誤（缺欄位、型別不對、數值溢位成 Infinity、id 重複）
// - 畫布畫不出來或選不到的邊（連到不存在的節點、連回自己、重複的邊、連進 Client、從沒有下游的 type 連出、Database 連到 Read Replica 以外的節點），
//   編輯器本身也不允許建立這些邊
// 參數範圍和其他拓撲規則交給後端驗證，還原後在錯誤分頁顯示，和使用者自己編輯出來的狀態一樣
export function parseTopology(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['不是合法的 JSON'] }
  }
  return toTopology(data)
}

export function toTopology(data: unknown): ParseResult {
  if (!isObject(data)) {
    return { ok: false, errors: ['最外層必須是物件'] }
  }
  if (data.version !== SUPPORTED_VERSION) {
    return { ok: false, errors: [`不支援的版本 ${JSON.stringify(data.version)}，目前只支援 ${SUPPORTED_VERSION}`] }
  }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return { ok: false, errors: ['nodes 和 edges 必須是陣列'] }
  }

  const errors: string[] = []
  const nodes: Node[] = []
  // 檔案裡出現過的節點 id → 類型（節點本身格式錯誤時是 null）。
  // 格式錯誤的節點已經報過一次，連到它的邊不再報「不存在的節點」
  const declared = new Map<string, NodeType | null>()
  data.nodes.forEach((raw: unknown, i: number) => {
    const id = rawId(raw)
    if (id != null && declared.has(id)) {
      errors.push(`nodes[${i}]：節點 id "${id}" 重複`)
      return
    }
    const node = toNode(raw, (message) => errors.push(`nodes[${i}]${describeId(id)}：${message}`))
    if (id != null) declared.set(id, node?.type ?? null)
    if (node) nodes.push(node)
  })

  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  const connected = new Set<string>()
  data.edges.forEach((raw: unknown, i: number) => {
    const id = rawId(raw)
    if (id != null && edgeIds.has(id)) {
      errors.push(`edges[${i}]：邊 id "${id}" 重複`)
      return
    }
    if (id != null) edgeIds.add(id)
    const edge = toEdge(raw, declared, (message) => errors.push(`edges[${i}]${describeId(id)}：${message}`))
    if (!edge) return
    // 疊在一起的邊畫布上只看得到一條
    const pair = JSON.stringify([edge.source, edge.target])
    if (connected.has(pair)) {
      errors.push(`edges[${i}]${describeId(id)}：${edge.source} → ${edge.target} 已經有一條邊，同一對節點只能有一條`)
      return
    }
    connected.add(pair)
    edges.push(edge)
  })

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  convertLegacyShards(data.nodes, nodes, edges)
  return { ok: true, topology: { version: SUPPORTED_VERSION, nodes: placeUnpositioned(nodes), edges } }
}

// 0.6.0 之前的存檔（spec 4.2.2）：分片節點的 instances 是每個 shard 的台數，換成總台數；
// 它的 Read Replica 沿用同樣的分片，也一起換。shards、hotShardShare 在 toNode 已經丟掉
function convertLegacyShards(rawNodes: unknown[], nodes: Node[], edges: Edge[]) {
  const shardsById = new Map<string, number>()
  for (const raw of rawNodes) {
    const shards = isObject(raw) && isObject(raw.params) ? raw.params.shards : undefined
    const id = rawId(raw)
    if (id != null && typeof shards === 'number' && Number.isInteger(shards) && shards > 1) {
      shardsById.set(id, shards)
    }
  }
  if (shardsById.size === 0) return
  for (const edge of edges) {
    const shards = shardsById.get(edge.source)
    if (shards !== undefined && nodes.find((n) => n.id === edge.target)?.type === 'READ_REPLICA') {
      shardsById.set(edge.target, shards)
    }
  }
  for (const node of nodes) {
    const shards = shardsById.get(node.id)
    if (shards !== undefined && node.params.instances !== undefined) {
      node.params.instances *= shards
    }
  }
}

// 只留下該類型用得到的參數和已知欄位，其他欄位丟掉。沒有 ui 時先不給座標，見 placeUnpositioned
function toNode(raw: unknown, fail: (message: string) => void): Node | null {
  if (!isObject(raw)) {
    fail('必須是物件')
    return null
  }
  const id = rawId(raw)
  const { type, name, params, state, ui } = raw
  if (id == null) {
    fail('缺少 id')
    return null
  }
  if (!isNodeType(type)) {
    fail(`type 必須是 ${NODE_TYPES.join('、')} 其中之一`)
    return null
  }
  if (typeof name !== 'string') {
    fail('缺少 name')
    return null
  }
  if (!isObject(params)) {
    fail('缺少 params')
    return null
  }
  if (state !== undefined && state !== 'HEALTHY') {
    fail('state 只能是 HEALTHY')
    return null
  }

  const kind = NODE_KINDS[type]
  const kept: NodeParams = {}
  for (const param of kind.numberParams) {
    const spec = NODE_PARAM_SPECS[param]
    const value = paramOrDefault(params, param, spec.optional, kind.defaults)
    if (!isFiniteNumber(value)) {
      fail(`缺少數值參數 params.${param}（或數值太大）`)
      return null
    }
    if (spec.integer) {
      const error = checkInteger(value)
      if (error) {
        fail(`params.${param} ${error}`)
        return null
      }
    }
    kept[param] = value
  }
  // 省略時沒有熱點，沒有預設值可以補；範圍（1/instances ～ 1）和其他參數一樣留給後端驗證
  if (kind.hasHotShare && params.hotShare !== undefined) {
    if (!isFiniteNumber(params.hotShare)) {
      fail('params.hotShare 必須是數字（或數值太大）')
      return null
    }
    kept.hotShare = params.hotShare
  }
  // 省略時不估算磁碟幾天後會滿，同樣沒有預設值可以補
  // 0.6.0 之前的存檔叫 diskGbPerShard，數值不變
  const disk = params.diskGbPerInstance ?? params.diskGbPerShard
  if (kind.numberParams.includes('retentionDays') && disk !== undefined) {
    if (!isFiniteNumber(disk)) {
      fail('params.diskGbPerInstance 必須是數字（或數值太大）')
      return null
    }
    kept.diskGbPerInstance = disk
  }
  for (const param of kind.choiceParams) {
    const spec = NODE_CHOICE_SPECS[param]
    const value = paramOrDefault(params, param, spec.optional, kind.defaults)
    const option = spec.options.find((o) => o.value === value)
    if (!option) {
      fail(`params.${param} 必須是 ${spec.options.map((o) => o.value).join(' 或 ')}`)
      return null
    }
    kept[param] = option.value
  }

  let position: Node['ui']
  if (ui !== undefined) {
    if (!isObject(ui) || !isFiniteNumber(ui.x) || !isFiniteNumber(ui.y)) {
      fail('ui 必須是 { x, y } 數字座標')
      return null
    }
    position = { x: ui.x, y: ui.y }
  }

  return {
    id,
    type,
    name,
    params: kept,
    ...(state === undefined ? {} : { state }),
    ...(position === undefined ? {} : { ui: position }),
  }
}

function toEdge(
  raw: unknown,
  declared: ReadonlyMap<string, NodeType | null>,
  fail: (message: string) => void,
): Edge | null {
  if (!isObject(raw)) {
    fail('必須是物件')
    return null
  }
  const id = rawId(raw)
  if (id == null) {
    fail('缺少 id')
    return null
  }
  const source = endpoint(raw, 'source', declared, fail)
  const target = source == null ? null : endpoint(raw, 'target', declared, fail)
  if (source == null || target == null) {
    return null
  }
  // 和編輯器的連線規則一致（useTopologyEditor 的 isValidConnection、SimNode 的 handle）。
  // 只有經過其他節點的環例外：可以讀入，Run 之後顯示 CYCLE_DETECTED，刪掉邊就能修好
  if (source === target) {
    fail('不能連回自己')
    return null
  }
  const sourceType = declared.get(source)
  const targetType = declared.get(target)
  if (sourceType != null && !NODE_KINDS[sourceType].hasOutput) {
    fail(`${NODE_KINDS[sourceType].label} 不能有下游（source 是 "${source}"）`)
    return null
  }
  if (targetType != null && !NODE_KINDS[targetType].hasInput) {
    fail(`${NODE_KINDS[targetType].label} 不能有上游（target 是 "${target}"）`)
    return null
  }
  if (sourceType != null && targetType != null && !canFeed(sourceType, targetType)) {
    const targets = NODE_KINDS[sourceType].outputTargets!.map((t) => NODE_KINDS[t].label).join('、')
    fail(`${NODE_KINDS[sourceType].label} 只能連到 ${targets}（target 是 "${target}"）`)
    return null
  }

  // 省略時為 spec 3.4 的預設值 1，和後端一致
  const numbers = { weight: 1, callsPerRequest: 1, latencyMs: 1 }
  for (const field of ['weight', 'callsPerRequest', 'latencyMs'] as const) {
    const value = raw[field]
    if (value === undefined) continue
    if (!isFiniteNumber(value)) {
      fail(`${field} 必須是數字（或數值太大）`)
      return null
    }
    if (field === 'callsPerRequest') {
      const error = checkInteger(value)
      if (error) {
        fail(`callsPerRequest ${error}`)
        return null
      }
    }
    numbers[field] = value
  }
  // 省略時為 ALL：每個 class 都會走這條邊。和數值欄位一樣，給了 null 是格式錯誤
  const requestClass = raw.requestClass === undefined ? 'ALL' : raw.requestClass
  const classes = EDGE_CHOICE_SPECS.requestClass.options.map((option) => option.value)
  const known = classes.find((value) => value === requestClass)
  if (known == null) {
    fail(`requestClass 必須是 ${classes.join('、')} 其中之一`)
    return null
  }
  return { id, source, target, ...numbers, requestClass: known }
}

function endpoint(
  raw: Record<string, unknown>,
  field: 'source' | 'target',
  declared: ReadonlyMap<string, NodeType | null>,
  fail: (message: string) => void,
): string | null {
  const value = raw[field]
  if (!isNonEmptyString(value)) {
    fail(`缺少 ${field}`)
    return null
  }
  if (!declared.has(value)) {
    fail(`${field} 指到不存在的節點 "${value}"`)
    return null
  }
  return value
}

// 選填參數省略時換成該類型的預設值，其他情況照原樣交給呼叫端檢查
function paramOrDefault(
  params: Record<string, unknown>,
  param: keyof NodeParams,
  optional: boolean | undefined,
  defaults: NodeParams,
): unknown {
  return params[param] === undefined && optional ? defaults[param] : params[param]
}

// 沒有座標的節點排在所有有座標的節點下方一列，不會和它們重疊
function placeUnpositioned(nodes: Node[]): Node[] {
  const placedYs = nodes.flatMap((n) => (n.ui ? [n.ui.y] : []))
  const y = placedYs.length > 0 ? Math.max(...placedYs) + FALLBACK_SPACING : 0
  const minX = Math.min(0, ...nodes.flatMap((n) => (n.ui ? [n.ui.x] : [])))
  let column = 0
  return nodes.map((n) => (n.ui ? n : { ...n, ui: { x: minX + column++ * FALLBACK_SPACING, y } }))
}

// 節點和邊的 id 規則只寫在這裡：重複檢查、錯誤訊息和 toNode／toEdge 共用
function rawId(raw: unknown): string | null {
  return isObject(raw) && isNonEmptyString(raw.id) ? raw.id : null
}

// 錯誤訊息裡附上 id，使用者比較好在檔案裡找到是哪一個
function describeId(id: string | null): string {
  return id == null ? '' : `（id "${id}"）`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

// JSON.parse 會把 1e400 這類溢位的數字變成 Infinity，送出時又變成 null
const INT32_MAX = 2 ** 31 - 1

// 整數參數在 API 是 32 位元整數，超出時後端整份拒絕（HTTP 400），沒辦法在錯誤分頁指出是哪個節點，
// 所以和 Infinity 一樣當成格式錯誤。範圍內但超過上限的值照樣讀入，由 Run 回報（spec 4.5）
function checkInteger(value: number): string | null {
  if (!Number.isInteger(value)) {
    return '必須是整數'
  }
  return Math.abs(value) > INT32_MAX ? `數值太大（整數最多 ${INT32_MAX.toLocaleString('en-US')}）` : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNodeType(value: unknown): value is NodeType {
  return NODE_TYPES.includes(value as NodeType)
}

// 自動存檔的內容，parseTopology 讀回來會得到相同的拓撲
export function serializeTopology(topology: Topology): string {
  return `${JSON.stringify(topology, null, 2)}\n`
}
