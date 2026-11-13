# System Design Simulator — Roadmap

> 一個在瀏覽器上拖拉元件、組出系統架構，並模擬流量、找出瓶頸的工具。
> 用途：side project ＋ 系統設計面試練習（搭配 `../system-design-kb`）。

---

## 原則

1. **先能跑，再求準**：每一版都要能端到端操作，不做半成品功能。
2. **引擎與 UI 分離**：模擬引擎是純 Java 函式庫，不依賴 Spring 和 HTTP，用 JUnit 就能驗證。
3. **模型可解釋**：每個數字都能說明是怎麼算出來的（公式或事件），不做黑盒子。
4. **每版明確寫出「不做什麼」**，避免範圍不斷擴大。

---

## 階段規劃

> 階段是開發方向，不是版號。版號規則見 [ADR 0001](docs/adr/0001-versioning.md)：目前是 0.x，一個階段可能跨好幾個版本。

### 階段一 — 穩態分析 MVP（詳見 [docs/v1-spec.md](docs/v1-spec.md)）
- 畫布：拖拉 5 種元件（Client / Load Balancer / Service / Cache / Database）並連線
- 屬性面板：調整 RPS、讀寫比、instances、concurrency、service time、cache hit ratio
- 穩態計算：每個節點的使用率 ρ、平均延遲、丟棄量；標出瓶頸
- 視覺化：節點依 ρ 變色與發光、邊上顯示 RPS 與流量粒子動畫、指標表、Sankey 流量圖、深色主題
- JSON 匯入／匯出，附 1 個內建範例

### 階段二 — 動態模擬（DES）
- Discrete-Event Simulation 引擎：時間推進、隨機到達與處理時間
- 指標：p50 / p95 / p99、時間序列（Timeseries 圖），透過 WebSocket 推送
- 故障注入：節點掛掉、降級、延遲變高
- 新元件：Message Queue ＋ Worker（非同步、backlog）。0.3.0 先做穩態的簡化版（見下方版本規劃），階段二再加上 backlog 隨時間的變化
- 阻塞式呼叫模型：Service 等待下游時占用 worker，可重現「DB 變慢拖垮 Service」的連鎖過載
- 動畫：數字過場、被丟棄的請求從節點掉出
- 韌性行為：timeout、retry（可重現 retry storm）、rate limit

### 階段三 — 情境與練習
- 情境庫：把 `system-design-kb/04-problems` 的參考架構做成可載入的預設
- 更多元件：CDN、DB read replica、sharding、Rate Limiter（穩態模型就能算，提前到 0.3.0）
- 挑戰模式：給定流量與 SLO（例如 p99 < 200ms），讓使用者設計出能達標的架構
- 成本估算：各元件的粗估月費（提前到 0.4.0）

### 之後再說（Ideas）
- 分享連結（把拓撲壓縮進 URL，不需要後端）、雲端存檔
- 把畫布匯出成 PNG／SVG
- 流量曲線（尖峰／日夜週期），可以當成一連串的穩態計算
- 畫布分組：用框表示 Region、VPC、可用區
- 多區域部署與跨區延遲
- AI 面試官：把拓撲和模擬結果交給 Claude，像面試官一樣追問（需要 API key，會產生費用）

---

## 版本規劃

> 這是目前的方向，不是承諾。每個版本的 ticket 在 GitHub 上用同名 milestone 管理，ticket 之間的先後順序用 issue 的 blocked-by 關係表示。

### 0.3.0 — 新元件

穩態模型就能計算的新元件。設計細節寫在各 ticket 裡，做完時併入 [docs/v1-spec.md](docs/v1-spec.md) 和 [GLOSSARY.md](GLOSSARY.md)。

| Ticket | 內容 |
|---|---|
| #58 | 共用機制：選填欄位、集中的 type 定義、虛線 Edge（其他 ticket 都要等它） |
| #59 | CDN：計算沿用 Cache，預設值不同 |
| #60 | Rate Limiter：全域 `limitRps`，超量的請求記為新指標「拒絕量」 |
| #62 | Service 的 Edge 可以只送 read 或只送 write（`requestClass`） |
| #63 | Sharding：Cache 和 Database 的 `shards` 與熱點 shard 占比 |
| #64 | Object Storage |
| #65 | Message Queue（簡化版）：同步送進 queue，consumer 非同步處理，處理不完時顯示 backlog 成長率 |
| #66 | Cluster 節點顯示：分片的節點畫成外框加格子；Redis Cluster 是分片 Cache 的 palette 預設 |
| #67 | Read Replica：Database → Replica 的邊代表複製，replica 也要套用所有寫入 |
| #68 | External API：固定延遲與配額，超過配額記為拒絕量 |

新欄位一律可以省略，所以拓撲檔格式維持 `"version": 1`（見 [ADR 0001](docs/adr/0001-versioning.md)）。

### 0.4.0 — 估算

系統設計面試的 back-of-envelope 估算：QPS 已經有了，再加上儲存量、頻寬和成本。

| Ticket | 內容 |
|---|---|
| #69 | 使用者端頻寬估算，有 CDN 時顯示擋掉的 origin 頻寬 |
| #70 | 儲存量估算：每日增量、保留期總量、含副本、每個 shard 的用量、磁碟幾天後滿 |

還沒開 ticket，細節待討論：
- **What-if 比較**：同一個拓撲改參數前後並排比較
- **容量反推**：例如「要撐 10 萬 rps，這個 Service 要開幾台」
- **成本估算**：各元件的粗估月費，搭配儲存量計算
- **計算說明**：點節點時顯示每個數字代入實際值的算式，讓「每個數字都能解釋」的原則在畫面上看得到
- **負載掃描曲線**：rps 從 0 拉到 N，畫出延遲和成功率曲線，看出 ρ 接近 1 時延遲急遽上升

不做：依 Cache 大小推算命中率（要假設 key 的熱度分布，難以解釋），hitRatio 維持手動輸入。

### 0.5.0 — 情境與挑戰（提議）

0.3.0 的元件和 0.4.0 的估算做完後，提前做階段三的情境庫和挑戰模式。挑戰的目標先用穩態算得出來的指標：成功率、平均延遲、成本，不必等 p99。

### 之後

0.3.0 到 0.5.0 做完後，再決定是否進入階段二的 DES。

---

## 影響階段一架構的未來需求

階段一不實作以下功能，但設計時不能擋住它們：

| 未來功能 | 階段一必須做到的事 |
|---|---|
| DES 動態模擬（階段二） | 節點的「參數」與「計算行為」分離；穩態計算只是其中一種 `Simulator` 實作 |
| 故障注入（階段二） | 節點 schema 預留 `state` 欄位（階段一只有 `HEALTHY`） |
| 即時推送（階段二） | 引擎不依賴 HTTP 請求的生命週期；API 層只是轉接 |
| Queue／非同步（階段二） | 流量模型要能區分 request class（階段一先做 read / write） |
| 情境庫、分享（階段三） | 拓撲用單一 JSON schema 完整表達，前後端共用（OpenAPI 產生 TS 型別） |
