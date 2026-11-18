import type { NodeType } from '@/api/client'
import type { EdgeChoiceParam, EdgeNumberParam, NodeChoiceParam, NodeNumberParam } from './params'

// 屬性面板參數名稱後面 ⓘ 的內容：這個參數的值大概多少才合理。只是建議，不影響驗證和 Run（spec 6）
export type ParamGuide = {
  // 有實值的參數才有（例如 serviceTimeMs）；看情境（rps）或比例、結構（weight）的參數沒有
  range?: { min: number; max: number }
  note: string
  example?: string
}

type EdgeParam = EdgeNumberParam | EdgeChoiceParam

// 每個 type 在屬性面板顯示的參數，要和 catalog.ts 的 NODE_KINDS 一致（paramGuide.test.ts 檢查）。
// 寫成型別，GUIDES 漏寫任何一個參數就編譯失敗
type GuidedParams = {
  CLIENT: { node: 'rps' | 'readRatio' | 'readResponseBytes' | 'writeRequestBytes'; edge: 'weight' | 'latencyMs' }
  LOAD_BALANCER: { node: Capacity; edge: 'weight' | 'latencyMs' }
  CDN: { node: Capacity | 'hitRatio'; edge: 'weight' | 'latencyMs' }
  RATE_LIMITER: { node: 'limitRps'; edge: 'latencyMs' }
  SERVICE: { node: Capacity | 'callMode'; edge: 'callsPerRequest' | 'requestClass' | 'latencyMs' }
  // 沒有下游的 type 沒有出邊，所以沒有邊參數的說明
  EXTERNAL_API: { node: 'latencyMs' | 'quotaRps'; edge: never }
  CACHE: { node: Capacity | 'hitRatio' | 'replicas' | 'hotShare'; edge: 'latencyMs' }
  DATABASE: { node: Capacity | Storage | 'diskGbPerInstance'; edge: never }
  READ_REPLICA: { node: Capacity; edge: never }
  OBJECT_STORAGE: { node: Capacity | Storage; edge: never }
  MESSAGE_QUEUE: { node: Capacity; edge: never }
}
type Capacity = 'instances' | 'concurrency' | 'serviceTimeMs'
type Storage = 'bytesPerWrite' | 'retentionDays'

type Guides = {
  [T in NodeType]: {
    node: Record<GuidedParams[T]['node'] & (NodeNumberParam | NodeChoiceParam), ParamGuide>
    edge: Record<GuidedParams[T]['edge'] & EdgeParam, ParamGuide>
  }
}

// 說明相同的參數共用一筆（表格裡的「同 X」）
const WEIGHT: ParamGuide = { note: '多個下游時依比例分流，1:1 就是平均', example: '兩個 region 7:3' }
const DATACENTER_LATENCY: ParamGuide = {
  range: { min: 0.1, max: 2 },
  note: '機房內部的網路往返',
  example: '同 AZ ≈ 0.5 ms；跨 AZ 1–2 ms',
}
const DB_CONCURRENCY: ParamGuide = {
  range: { min: 20, max: 500 },
  note: '同時執行的查詢數，受 connection 上限和核心數限制',
  example: 'Postgres max_connections 預設 100；MySQL 151',
}
const DB_SERVICE_TIME: ParamGuide = {
  range: { min: 1, max: 50 },
  note: '一次查詢的時間；有索引的小查詢很快，JOIN、掃描慢很多',
  example: '主鍵查詢 ≈ 1 ms；一般寫入 5–10 ms；複雜報表 100 ms+',
}
const RETENTION: ParamGuide = {
  note: '資料要留多久；依法規或產品需求',
  example: '日誌 30–90 天；交易紀錄 7 年 ≈ 2,555 天',
}

export const GUIDES: Guides = {
  CLIENT: {
    node: {
      rps: {
        note: '日活 × 每人每日請求數 ÷ 86,400 是平均值，尖峰再乘 2–3',
        example: '日活 100 萬、每人 50 次 ≈ 600 rps，尖峰 ≈ 1,500 rps',
      },
      readRatio: {
        range: { min: 0.5, max: 0.99 },
        note: '讀取占全部請求的比例，多數系統讀遠多於寫',
        example: '社群動態 0.95–0.99；電商 ≈ 0.9；聊天 ≈ 0.5',
      },
      readResponseBytes: {
        range: { min: 1_000, max: 1_000_000 },
        note: '一次讀取回傳的大小，用來估算對外頻寬',
        example: 'JSON API 1–50 KB；縮圖 20–200 KB；整頁 HTML ≈ 100 KB',
      },
      writeRequestBytes: {
        range: { min: 100, max: 100_000 },
        note: '一次寫入上傳的大小',
        example: '發文、留言 ≈ 1 KB；表單 1–10 KB；照片上傳另外估 1–5 MB',
      },
    },
    edge: {
      weight: WEIGHT,
      latencyMs: {
        range: { min: 10, max: 200 },
        note: '使用者到你的機房的網路往返',
        example: '同國家 10–50 ms；跨洲 100–200 ms',
      },
    },
  },
  LOAD_BALANCER: {
    node: {
      instances: {
        note: '通常 1–3 台就夠，多台多半是為了容錯，不是效能',
        example: '雲端負載平衡器自動擴充，可當 1 台大的',
      },
      concurrency: {
        range: { min: 1_000, max: 50_000 },
        note: '事件驅動的代理，一台可同時持有大量連線',
        example: 'Nginx、HAProxy 單台數萬連線',
      },
      serviceTimeMs: {
        range: { min: 0.05, max: 2 },
        note: '只轉發不處理；L7 解析 HTTP、TLS 終止會偏高',
        example: 'L4 ≈ 0.05 ms；L7 + TLS ≈ 1 ms',
      },
    },
    edge: {
      weight: { ...WEIGHT, example: '新版灰階 9:1' },
      latencyMs: DATACENTER_LATENCY,
    },
  },
  CDN: {
    node: {
      instances: { note: '代表邊緣節點（PoP）的數量，供應商負責擴充', example: '大型 CDN 數百個 PoP' },
      concurrency: { range: { min: 1_000, max: 100_000 }, note: '每個 PoP 可同時服務大量連線' },
      serviceTimeMs: { range: { min: 0.1, max: 5 }, note: '命中時從邊緣記憶體或 SSD 直接回傳' },
      hitRatio: {
        range: { min: 0.85, max: 0.99 },
        note: '靜態資源幾乎都命中，個人化內容低很多',
        example: '圖片、JS ≈ 0.95–0.99',
      },
    },
    edge: {
      weight: { note: WEIGHT.note },
      latencyMs: {
        range: { min: 10, max: 100 },
        note: '邊緣回源（origin）的網路往返',
        example: '同洲 10–50 ms；跨洲 100 ms+',
      },
    },
  },
  RATE_LIMITER: {
    node: {
      limitRps: {
        note: '依下游容量設：略低於下游在 ρ ≈ 0.7 時的流量',
        example: '下游極限 2,000 rps → 設 ≈ 1,400',
      },
    },
    edge: { latencyMs: { range: DATACENTER_LATENCY.range, note: DATACENTER_LATENCY.note } },
  },
  SERVICE: {
    node: {
      instances: { note: '先設 2 台以上容錯，再依 Run 的 ρ 加減，常見目標 ρ ≤ 0.7' },
      concurrency: {
        range: { min: 10, max: 500 },
        note: '一台同時處理的請求數；等 I/O 的服務可設高，吃 CPU 的接近核心數',
        example: 'Tomcat 預設 200 執行緒；CPU 密集 ≈ 核心數 4–32',
      },
      serviceTimeMs: {
        range: { min: 5, max: 200 },
        note: '一個請求自己花的時間，不含呼叫下游（下游另外算）',
        example: '簡單 CRUD ≈ 10 ms；含驗證、組裝 JSON ≈ 50 ms；圖片處理 500 ms+',
      },
      callMode: {
        note: '依序：下游延遲相加；平行：取最慢的那個',
        example: '查購物車再結帳 = 依序；同時查商品和庫存 = 平行',
      },
    },
    edge: {
      callsPerRequest: {
        note: '每個進來的請求對這個下游呼叫幾次；大於 1 會放大下游流量',
        example: '一頁列表查 10 筆資料且沒有批次 = 10（N+1 問題）',
      },
      requestClass: {
        note: '這條邊送哪些請求：全部、只有 read 或只有 write',
        example: '讀寫分離：read 送 Read Replica，write 送 Database',
      },
      latencyMs: { range: DATACENTER_LATENCY.range, note: DATACENTER_LATENCY.note },
    },
  },
  EXTERNAL_API: {
    node: {
      latencyMs: {
        range: { min: 50, max: 1_000 },
        note: '第三方服務的回應時間，含對方的處理；常是整條路徑最慢的一段',
        example: '金流 300–800 ms；簡訊 100–300 ms；地圖查詢 50–200 ms',
      },
      quotaRps: {
        note: '對方給你的配額，寫在合約或方案裡；超過的部分會被拒絕（429）',
        example: '免費方案常只有 1–100 rps',
      },
    },
    edge: {},
  },
  // Redis Cluster 是 Cache 的 preset，用同一份說明
  CACHE: {
    node: {
      instances: { note: '主節點數量，資料依 key 分散在各台', example: 'Redis Cluster 常見 3 主' },
      concurrency: {
        range: { min: 1, max: 16 },
        note: 'Redis 靠單執行緒處理命令，所以是 1；多執行緒的快取可設核心數',
        example: 'Redis = 1；Memcached ≈ 4–16',
      },
      serviceTimeMs: {
        range: { min: 0.005, max: 0.1 },
        note: '一個命令的 CPU 時間，不含網路（網路算在邊上）',
        example: 'Redis GET ≈ 0.01 ms（單台約 10 萬 ops/s）',
      },
      hitRatio: {
        range: { min: 0.7, max: 0.99 },
        note: '快取對讀取的命中比例，沒命中的會穿到下游',
        example: '熱門商品頁 0.9+；長尾查詢 0.5–0.7',
      },
      replicas: { note: '每個主的從節點數，只是標記，不影響計算', example: 'Redis Cluster 常見 1' },
      hotShare: {
        note: '最熱那台分到的流量比例，模擬熱門 key 擠在同一台',
        example: '3 台平均 = 0.33；一個爆紅商品 key 可能讓單台吃到 0.5+',
      },
    },
    edge: { latencyMs: { range: DATACENTER_LATENCY.range, note: DATACENTER_LATENCY.note } },
  },
  DATABASE: {
    node: {
      instances: { note: '主節點（master）數量；大於 1 就是分片（sharding）', example: '單一 Postgres = 1' },
      concurrency: DB_CONCURRENCY,
      serviceTimeMs: DB_SERVICE_TIME,
      bytesPerWrite: {
        range: { min: 100, max: 10_000 },
        note: '每次寫入留下的資料量，含索引約再乘 1.5–2',
        example: '一筆訂單、留言 ≈ 1 KB',
      },
      retentionDays: RETENTION,
      diskGbPerInstance: {
        range: { min: 100, max: 16_000 },
        note: '每台機器的磁碟容量，用來估幾天後會滿',
        example: '雲端 SSD 常見 500 GB–4 TB；單顆上限約 16 TB–64 TB',
      },
    },
    edge: {},
  },
  READ_REPLICA: {
    node: {
      instances: { note: '副本數量；每台都要套用全部的寫入，只分擔 read', example: '常見 1–5 台' },
      concurrency: { range: DB_CONCURRENCY.range, note: DB_CONCURRENCY.note },
      serviceTimeMs: { range: DB_SERVICE_TIME.range, note: DB_SERVICE_TIME.note },
    },
    edge: {},
  },
  OBJECT_STORAGE: {
    node: {
      instances: { note: '由供應商負責擴充，通常維持 1，用 concurrency 代表整體容量', example: 'S3、GCS' },
      concurrency: {
        range: { min: 1_000, max: 100_000 },
        note: '整體能同時處理的請求數，實際上限由供應商的分區規則決定',
        example: 'S3 每個 prefix 約 3,500 PUT/s、5,500 GET/s',
      },
      serviceTimeMs: {
        range: { min: 10, max: 200 },
        note: '一次讀寫物件的時間，含小物件的第一個 byte',
        example: 'S3 小物件 GET 20–100 ms',
      },
      bytesPerWrite: {
        range: { min: 10_000, max: 100_000_000 },
        note: '每次上傳的物件大小',
        example: '照片 1–5 MB；影片 100 MB+',
      },
      retentionDays: { note: RETENTION.note },
    },
    edge: {},
  },
  MESSAGE_QUEUE: {
    node: {
      instances: { note: 'broker 數量；通常 3 台起跳以容錯', example: 'Kafka 叢集常見 3–9 個 broker' },
      concurrency: { range: { min: 100, max: 10_000 }, note: '一台 broker 同時處理的寫入數；批次寫入讓它很高' },
      serviceTimeMs: {
        range: { min: 0.1, max: 5 },
        note: '寫入一則訊息到回 ack 的時間；要等副本寫好會偏高',
        example: 'Kafka acks=1 ≈ 1 ms；acks=all 2–5 ms',
      },
    },
    // consumer group 的邊沒有參數
    edge: {},
  },
}

// 依 target type 覆寫邊參數的說明：連到 External API 要走公開網路，延遲比機房內部高很多
const EDGE_TARGET_GUIDES: Partial<Record<NodeType, Partial<Record<EdgeParam, ParamGuide>>>> = {
  EXTERNAL_API: {
    latencyMs: {
      range: { min: 10, max: 100 },
      note: '呼叫第三方要走公開網路',
      example: '同區域雲端服務 ≈ 10 ms；跨洲 100 ms',
    },
  },
}

// 型別只保證 GuidedParams 列出的參數都有說明；參數和 NODE_KINDS 對不上時（例如之後新增參數）回傳 undefined，
// 由 paramGuide.test.ts 抓出來
export function nodeParamGuide(type: NodeType, param: NodeNumberParam | NodeChoiceParam): ParamGuide | undefined {
  const guides: Partial<Record<NodeNumberParam | NodeChoiceParam, ParamGuide>> = GUIDES[type].node
  return guides[param]
}

export function edgeParamGuide(source: NodeType, target: NodeType, param: EdgeParam): ParamGuide | undefined {
  const guides: Partial<Record<EdgeParam, ParamGuide>> = GUIDES[source].edge
  return EDGE_TARGET_GUIDES[target]?.[param] ?? guides[param]
}

// 值落在常見範圍外時欄位下方的黃字；剛好等於 min 或 max 不算超出。沒有範圍的參數永遠是 null。
// 只是建議，不擋輸入也不影響 Run，和 params.ts 的合法範圍分開
export function outOfRangeHint(guide: ParamGuide | undefined, unit: string | undefined, value: number): string | null {
  const range = guide?.range
  if (!range || (value >= range.min && value <= range.max)) {
    return null
  }
  return `⚠ 超出常見範圍（${formatGuideRange(range, unit)}）`
}

// tooltip 第一行和超出範圍黃字的範圍文字，例如「10–200 ms」「1 KB–1 MB」「0.5–0.99」
export function formatGuideRange({ min, max }: NonNullable<ParamGuide['range']>, unit: string | undefined): string {
  if (unit === 'bytes') {
    return `${formatByteSize(min)}–${formatByteSize(max)}`
  }
  const range = `${min.toLocaleString()}–${max.toLocaleString()}`
  return unit ? `${range} ${unit}` : range
}

// 範圍都是整數的 KB、MB，format.ts 的 formatBytes 固定三位有效數字（1.00 KB），這裡不補 0
function formatByteSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let scaled = bytes
  let unit = 0
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000
    unit++
  }
  return `${scaled.toLocaleString()} ${units[unit]}`
}
