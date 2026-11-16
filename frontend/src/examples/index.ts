import type { Topology } from '@/api/client'
import { toTopology } from '@/io/topologyFile'
import basicWebApp from './basic-web-app.json'
import cdn from './cdn.json'
import externalApi from './external-api.json'
import fanOut from './fan-out.json'
import mediaStorage from './media-storage.json'
import overload from './overload.json'
import rateLimiter from './rate-limiter.json'
import readWriteSplit from './read-write-split.json'
import redisCluster from './redis-cluster.json'
import sharding from './sharding.json'

export type Example = { id: string; label: string; topology: Topology }

// 工具列「範例」選單的內容。這個資料夾的範例檔也是後端 /simulate 整合測試的輸入（spec 第 7 節）
export const EXAMPLES: Example[] = [
  { id: 'basic-web-app', label: '基本 Web App', topology: builtIn(basicWebApp) },
  // LB 用 weight 分流，只有 Catalog 這條路徑有 Cache：DB 的 read 被擋下、write 穿透
  { id: 'read-write-split', label: '讀寫分流', topology: builtIn(readWriteSplit) },
  // Gateway 呼叫三個下游（含 callsPerRequest 3）：切換 Call mode 比較依序與平行的端到端延遲
  { id: 'fan-out', label: 'Fan-out', topology: builtIn(fanOut) },
  // Inventory DB 被 write 和 Cache miss 壓到過載：瓶頸通知、Dropped、Drop rate 和「延遲無定義」
  { id: 'overload', label: '過載', topology: builtIn(overload) },
  // CDN 擋掉 95% 的 read，origin 只收到 miss 和 write；把 hitRatio 調低，Web API 就會過載
  { id: 'cdn', label: 'CDN', topology: builtIn(cdn) },
  // 圖片、影片放 Object Storage，metadata 放 Database：兩者都是終點，Object Storage 的容量大得多
  { id: 'media-storage', label: '媒體儲存', topology: builtIn(mediaStorage) },
  // 12,000 rps 會壓垮容量 8,000 的 API：Rate Limiter 只放行 6,000，其餘拒絕，API 回到穩態
  { id: 'rate-limiter', label: 'Rate Limiter', topology: builtIn(rateLimiter) },
  // 結帳呼叫第三方金流：300ms 的固定延遲佔掉大半端到端延遲，1,500 rps 超過 1,000 的配額，三分之一被拒絕
  { id: 'external-api', label: 'External API', topology: builtIn(externalApi) },
  // Database 切 4 片，容量 40,000，但最熱的 shard 分到 40%：28,000 rps 就讓它過載。把 hotShardShare 刪掉（平均分配）就撐得住
  { id: 'sharding', label: '分片熱點', topology: builtIn(sharding) },
  // 熱門貼文的 key 都在同一個 shard：它分到一半的流量而過載，另外兩格還很閒
  { id: 'redis-cluster', label: 'Redis Cluster 熱點 key', topology: builtIn(redisCluster) },
]

// JSON import 的型別太寬（type 是 string），走和匯入檔案相同的檢查來取得 Topology
function builtIn(data: unknown): Topology {
  const parsed = toTopology(data)
  if (!parsed.ok) {
    throw new Error(`內建範例格式錯誤：${parsed.errors.join('；')}`)
  }
  return parsed.topology
}
