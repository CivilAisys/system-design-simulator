# 階段一 Spec — 穩態分析 MVP

> 狀態：**已確認**（2026-11-12）
> 目標：使用者能在畫布上組出「Client → LB → Service → Cache → DB」這類架構，調整參數後按 Run，馬上看到每個節點的負載、延遲和瓶頸。

---

## 1. 範圍

### 1.1 做什麼
- 3.3 各種元件的拖拉、連線、刪除、參數編輯
- 後端穩態（steady-state）計算：使用率、平均延遲、丟棄量、瓶頸
- 結果視覺化：節點變色、邊上 RPS、指標表、Sankey
- 畫布效果：邊上的流量粒子動畫、節點依 ρ 發光、深色主題（可切換淺色），見第 6 節
- 拓撲驗證與錯誤提示
- 自動存檔（JSON 匯入／匯出和內建範例在 0.6.0 移除，#135：範例之後一個一個重做，匯入／匯出等需要時再加回來。本 spec 裡「匯入」的檢查規則照樣用在還原自動存檔）

### 1.2 不做什麼（Non-goals）
- ❌ 時間推進的動態模擬、p99 等百分位數（→ 階段二 DES）
- ❌ 故障注入、timeout、retry（→ 階段二）
- ❌ 完整的 Message Queue（重送、順序、consumer 數量變化等，→ 階段二）；0.3.0 起有簡化版的 Message Queue、CDN、Read Replica（4.2.3、4.2.4）；Cache 可以設定熱點（4.2.2）
- ❌ 有環（cycle）的拓撲
- ❌ 一個請求同時是 read 和 write（例如寫入前先讀一次的 read-modify-write）：`requestClass` 只能篩選、不能轉換，要分開兩條路徑近似（見 3.4）
- ❌ 阻塞式呼叫模型：Service 等待下游時占用 worker（→ 階段二 DES，見 3.2）
- ❌ 數字過場動畫、丟棄粒子動畫（→ 階段二，搭配 DES 時間序列一起做）
- ❌ 前端元件測試和瀏覽器端到端測試（→ 階段二再考慮 Playwright）。純邏輯的單元測試在 0.2.0 加入，見第 9 節
- ❌ 帳號、資料庫、雲端存檔、部署上線（階段一只在本機跑）

---

## 2. 技術選型

| 層     | 選擇                                                               |
| ----- | ---------------------------------------------------------------- |
| 後端    | Java 21、Spring Boot 3、JUnit 5、springdoc-openapi                  |
| 建置    | Gradle（Kotlin DSL）多模組、Gradle Wrapper                             |
| 前端    | React + Vite + TypeScript、Tailwind CSS v4、Vitest（純邏輯的單元測試）     |
| UI 元件 | shadcn/ui（元件原始碼複製進專案，可完全客製）                                  |
| 圖表    | ECharts（Sankey）                                                  |
| 動畫    | SVG 和 CSS（流量粒子、節點發光），不另外用動畫函式庫                                |
| 畫布    | `@xyflow/react`（React Flow），可搭配官方 React Flow UI（shadcn 版）元件          |
| 型別同步  | springdoc 產出 OpenAPI → `openapi-typescript` 產生前端型別               |

**型別同步流程**：Gradle task 產生 `openapi.json` 並 commit 進 repo，前端從這個檔案產生型別，不需要先啟動後端。`api` 模組有一個測試比對「目前程式碼產生的 OpenAPI」和 repo 裡的 `openapi.json`，不一致就失敗，避免忘記重新產生。

**開發連線**：Vite dev server 把 `/api` proxy 到 Spring（`localhost:8080`），瀏覽器只跟同一個 origin 溝通，後端不開 CORS。

### 專案結構

```
system-design-simulator/
├─ README.md
├─ ROADMAP.md
├─ GLOSSARY.md
├─ docs/
│  └─ adr/      架構決策紀錄
├─ backend/
│  ├─ engine/   純 Java，不依賴 Spring（模型、驗證、穩態計算）
│  └─ api/      Spring Boot（REST controller、DTO ↔ engine model、openapi.json）
└─ frontend/
   └─ src/
      ├─ canvas/      React Flow 畫布、自訂節點、元件面板、屬性面板、編輯器狀態（復原、複製貼上）
      ├─ results/     結果面板：指標表、Sankey、錯誤清單
      ├─ simulation/  Run、Auto-run、過期判斷
      ├─ io/          拓撲檔的檢查與自動存檔
      ├─ api/         產生的型別與 API client
      └─ components/  shadcn/ui 元件（hooks/、lib/ 是它附帶的工具）
```

用多模組把 `engine` 獨立出來，由編譯期保證引擎不會意外依賴 Spring。

---

## 3. 領域模型

### 3.1 流量
- 請求分成兩種 class：**read**、**write**。Client 用 `readRatio` 決定比例。
- 為什麼階段一就要分：Cache 只對 read 有效，這是系統設計中最核心的取捨之一。

### 3.2 處理能力（所有可處理請求的節點共用）

每個節點看成一個 **M/M/c 排隊系統**：

| 參數 | 意義 | 💡 Java 類比 |
|---|---|---|
| `instances` | 機器／Pod 數量 | 部署幾台 |
| `concurrency` | 每個 instance 同時能處理幾個請求 | Thread pool size／connection pool size |
| `serviceTimeMs` | 處理一個請求的平均時間（不含排隊） | 單一請求的 CPU + IO 時間 |

推導出來的值：
- 總 worker 數 `c = instances × concurrency`
- 每個 worker 的服務率 `μ = 1000 / serviceTimeMs`（req/s）
- 容量 `capacity = c × μ`

> **簡化假設**：多個 instance 視為一個共用佇列（假設前面有完美的負載平衡）。真實情況會比這更差，階段二的 DES 可以模擬不平均的分流。
>
> **簡化假設**：Service 呼叫下游時**不占用 worker**（相當於非阻塞 I/O），所以 ρ 只由 `serviceTimeMs` 決定。真實的同步服務（thread-per-request）在等待下游時 thread 會被卡住，DB 變慢會連帶拖垮 Service。這種連鎖過載留給階段二的 DES 模擬。

### 3.3 元件

| 元件 | 角色 | 專屬參數 | 對下游的行為 | 預設值 |
|---|---|---|---|---|
| **Client** | 流量來源 | `rps`、`readRatio`、`readResponseBytes`、`writeRequestBytes` | 依邊的 `weight` 分流 | rps=1000, readRatio=0.9, readResponseBytes=10000, writeRequestBytes=1000 |
| **Load Balancer** | 分流 | — | 依邊的 `weight` 分流（預設平均） | 1 × 1000, 1ms（≈1M rps） |
| **Service** | 應用伺服器 | `callMode` | **Fan-out**：每個請求呼叫每個下游 `callsPerRequest` 次；`callMode` 決定依序（`SEQUENTIAL`）或平行（`PARALLEL`） | 2 × 200, 50ms（8,000 rps）, callMode=SEQUENTIAL |
| **Cache** | 快取（元件面板的「Redis Cluster」是 3 主 3 從的 Cache） | `hitRatio`、`hotShare`、`replicas` | read：只有 miss（`1 - hitRatio`）往下送；write：全部往下送 | 1 × 1, 0.01ms（≈100k rps，類似單執行緒 Redis）, hitRatio=0.8 |
| **CDN** | 邊緣快取，擋在 Client 和後端（origin）之間 | `hitRatio` | 同 Cache，但可以有多個下游，依邊的 `weight` 分配（同 LB），例如靜態檔案送到 Object Storage、API 送到 LB | 10 × 1000, 1ms（≈10M rps）, hitRatio=0.95 |
| **Database** | 資料儲存（終點） | `bytesPerWrite`、`retentionDays`、`diskGbPerInstance` | 只能連到 Read Replica（複製，4.2.3） | 1 × 100, 10ms（10,000 rps）, bytesPerWrite=1000, retentionDays=365 |
| **Read Replica** | primary Database 的唯讀副本 | — | 無下游；write 是 primary 複製過來的，read 由 Service 的 READ 邊送來 | 1 × 100, 10ms（10,000 rps） |
| **Message Queue** | 非同步佇列（broker） | — | 每條下游邊是一個 consumer group，都收到全部訊息；Client 只等到 ack | 1 × 1000, 1ms（≈1M rps） |
| **Object Storage** | 存放圖片、影片等大型檔案（例如 S3），終點 | `bytesPerWrite`、`retentionDays` | 無下游，同 Database | 1 × 10000, 20ms（≈500k rps）, bytesPerWrite=1000000, retentionDays=365 |
| **Rate Limiter** | 全域限流 | `limitRps` | 放行 `min(λ, limitRps)`，超過的部分是**拒絕量**，不往下送；必須剛好一個下游 | limitRps=1000 |
| **External API** | 第三方服務（金流、簡訊、地圖 API 等），終點 | `latencyMs`、`quotaRps` | 無下游；超過 `quotaRps` 的部分是**拒絕量**（HTTP 429） | latencyMs=100, quotaRps=1000 |

> Cache 的 write 直接往下送，等於把 cache-aside 的「寫 DB、刪 cache」簡化成穿透。
>
> CDN 的流量、延遲、成功率和驗證規則都和 Cache 相同（engine 裡兩者都是 `CachingNode`），只有預設值、圖示和名稱不同，讓架構圖和存下來的 JSON 看得出是 CDN。唯一的差別是 CDN 可以有多個下游：沒命中的 read 和全部 write 依邊的 `weight` 分配（4.3、4.3.1 的 CDN 公式）。位置不限制，不一定要接在 Client 後面。
>
> Object Storage 的計算和驗證都和 Database 相同（engine 裡兩者都是 `StorageNode`），只有預設值、圖示和名稱不同。容量由供應商負責，所以不能接 Read Replica。
>
> Client 的 `readResponseBytes`（每個 read 回應的大小）、`writeRequestBytes`（每個 write 上傳的大小）單位是 bytes，只用來估算使用者端頻寬（4.7），不影響其他計算。
>
> Database、Object Storage 的 `bytesPerWrite`（每次 write 平均新增的 bytes）、`retentionDays`（資料保留天數），以及 Database 的 `diskGbPerInstance`（每台機器的磁碟容量，GB；省略時不估算磁碟幾天後會滿）只用來估算儲存量（4.8）。Object Storage 的容量由供應商負責，沒有磁碟容量，也不判斷磁碟會滿；舊存檔或請求裡帶了這個欄位時直接忽略，不算錯誤。Read Replica 沿用 primary 的設定，不能另外設；Cache 不估算。
>
> Rate Limiter 沒有 M/M/c（沒有 instances、concurrency、serviceTimeMs），`limitRps` 是所有上游加總的全域上限，不分 Client。計算見 4.2.1。
>
> External API 也沒有 M/M/c，使用者不能調整 instances：節點延遲固定是 `latencyMs`、不排隊，`quotaRps` 是對方給的配額（所有上游加總）。計算和 Rate Limiter 共用 4.2.1。

### 3.4 邊（Edge）

| 欄位 | 意義 | 預設 |
|---|---|---|
| `source` / `target` | 節點 id | — |
| `weight` | 分流權重（Client、LB、CDN 用） | 1 |
| `callsPerRequest` | 每個請求呼叫幾次（Service 用） | 1 |
| `latencyMs` | 網路延遲（往返：送出請求到收到回應，在網路上花的時間） | 1（畫布上新建的邊見下） |
| `requestClass` | 哪個 class 的請求會走這條邊（Service 用）：`ALL`、`READ`、`WRITE` | `ALL` |

- 欄位只在對應的起點有意義：`weight` 只用在 Client／LB／CDN 的邊，`callsPerRequest`、`requestClass` 只用在 Service 的邊。其他邊上的這些欄位**計算時忽略**（存檔一律帶著預設值，所以不報錯），屬性面板也只顯示對該起點有意義的欄位。
- `requestClass`：一個 class 的請求只呼叫 `requestClass` 符合的下游（`ALL` 兩種都符合），例如 Service ─(READ)→ Read Replica、Service ─(WRITE)→ primary，或 CQRS 的讀寫分流。流量、延遲（4.3）、成功率（4.3.1）都只算符合的下游；沒有任何符合的下游時，Service 就是這個 class 的終點。Client／LB／CDN 的邊不支援（要依 class 重新正規化權重，還要處理某個 class 沒有邊可走的情況）。畫布上 `READ`／`WRITE` 的邊在標籤前面顯示「R」／「W」，邊上的 RPS 和粒子只有那個 class 的流量。
  - **限制：一個請求不能同時是 read 和 write**。`requestClass` 只能篩選，不能轉換，所以「寫入前先讀一次」（read-modify-write，例如先查庫存再扣）沒辦法表示成一個請求。要近似時分成兩條路徑：另外放一個 `readRatio = 1`、`rps` 等於寫入量的 Client 打到同一個 Database，代表每次寫入前的那一次讀；write 路徑的端到端延遲不包含這次讀。
- 畫布上新建的邊，`latencyMs` 依兩端決定，讓預設值落在屬性面板 ⓘ 的常見範圍內（第 6 節）：Client、CDN 的出邊和連到 External API 的邊走公開網路，用 30 ms；其他是機房內部，用 1 ms。只影響新建的邊；存檔省略 `latencyMs` 時仍補 1。
- 同一對 source → target 只能有一條邊（見 4.5 `DUPLICATE_EDGE`），畫布也會阻止拉出重複的連線。
- 不能有環（見 4.5 `CYCLE_DETECTED`）。畫布拉線時就擋掉會成環的連線（含自己連自己），和重複的連線一樣放不下去。讀入存檔時只擋自己連自己，經過其他節點的環照樣讀入，Run 之後在錯誤分頁顯示。

### 3.5 節點健康狀況（預留）
- `state`（Health）：階段一只有 `HEALTHY`。階段二加入 `DOWN`、`DEGRADED`。

### 3.6 新增元件時要改的地方

0.3.0 起新增的 Node type 和欄位都照這一節做。

**新欄位一律選填**：省略時套用預設值，所以舊的存檔照樣讀得進來，拓撲格式的 `"version"` 維持 1（ADR 0001）。給了但型別不對，仍然是格式錯誤（4.5、HTTP 400）。三個地方要一致，寫法照 Edge 的 `weight`：

| 地方 | 寫法 | 示範的測試 |
|---|---|---|
| 後端反序列化 | DTO 欄位用包裝型別（`Double`、`Integer`），`@Schema(defaultValue = …)`；轉成 engine 物件時 `null` 換成預設值 | `SimulateEndpointTest.missingEdgeFieldsDefaultToOne`；型別錯誤見 `wrongTypeIsBadRequest` |
| OpenAPI | 不標 `requiredMode = REQUIRED`，有 `default`。例外：`NodeParams` 的欄位不標 `default`，預設值寫在 `description`，因為 `NodeParams` 是所有 type 共用的，產生的前端型別會把有 `default` 的欄位當成必填 | `OpenApiSyncTest.fieldsWithDefaultsAreOptional` 檢查有預設值的欄位都不在 `required` |
| 前端讀入 | 節點參數在 `params.ts` 的 spec 標 `optional: true`，省略時用該類型 `defaults` 裡的值；沒有固定預設值的選填參數（例如 `hotShare`，省略時代表沒有熱點）不放進 `defaults`，在 `toNode` 另外讀，省略時不補；邊的欄位在 `topologyFile.ts` 的 `toEdge` 補；邊的下拉選單欄位（例如 `requestClass`）的選項在 `params.ts` 的 `EDGE_CHOICE_SPECS`，哪些起點會顯示寫在 `NODE_KINDS` 的 `edgeChoiceParams` | `topologyFile.test.ts` 的「選填的節點參數」、「邊省略的數值參數用預設值 1，requestClass 用 ALL」 |

**新增一種 Node type**：

- 後端 api：`NodeType` 加一個值；`NodeParamsDto` 加該類型的參數（`description` 寫上用到它的 type）；`NodeDto.toNode` 建出 engine 的節點。改完跑 `./gradlew :api:generateOpenApi` 更新 `openapi.json`，前端的型別跟著重新產生。
- 後端 engine：新增 `Node` 的實作並加進 `Node` 的 `permits`。編譯器會指出所有 `switch (node)` 要補的分支（`SteadyStateSimulator`、`SuccessRates`、`TopologyValidator` 的參數範圍、`TopologyGraph` 的出邊規則、`Explanations` 的計算步驟和成功率說明），`instanceof` 的判斷則要自己逐一確認：`TopologyValidator` 的上下游限制和出邊參數、`TopologyGraph` 哪些 type 依 `weight` 分流、`EndToEndLatencies`、`SuccessRates`、`SteadyStateSimulator`、`Explanations`。新元件的計算步驟要補進 4.9 的涵蓋範圍。
- 前端：在 `canvas/catalog.ts` 的 `NODE_TYPES`（元件面板的順序）和 `NODE_KINDS` 各加一筆。只換名稱、圖示和部分預設值、type 不變的元件（例如 Redis Cluster）不是新的 type，加在同一個檔案的 `PRESETS`，元件面板讀的是由兩者組成的 `PALETTE`。`NODE_KINDS` 是前端唯一的 type 定義：名稱、圖示、類別（流量／運算／資料／非同步，元件面板依它分組、圖示方塊依它上色；`NODE_TYPES` 要把同類別的排在一起）、id 前綴、預設參數、屬性面板列出的參數、能不能有上游／下游、出邊顯示的欄位、出邊的種類、節點上顯示的指標，元件面板、畫布、屬性面板和讀入存檔都從這裡讀。新的數值參數在 `params.ts` 的 `NODE_PARAM_SPECS` 加範圍（要和後端 4.5 一致），下拉選單參數加在 `NODE_CHOICE_SPECS`。
- 計算和既有 type 完全相同、只差預設值和名稱的新 type（例如 CDN 之於 Cache、Object Storage 之於 Database）：engine 讓兩者實作同一個 sealed 子介面（`CachingNode`、`StorageNode`），`switch` 對子介面寫一個分支，計算和驗證共用；前端 `NODE_KINDS` 仍各寫一筆。
- 出邊的種類（`outputEdgeKind`）：`ASYNC` 的邊畫成虛線，給不算進 Client 端到端延遲的邊用（replication、Message Queue 的 consumer）。種類只看 source 的 type。只能連到特定 type 時寫在 `outputTargets`（例如 Database 只能連到 Read Replica）。
- 文件：本 spec 的 3.3（元件表）、4.5（驗證規則）、5（API 範例有需要時），`GLOSSARY.md` 的新名詞。後端 `/simulate` 整合測試需要完整拓撲時，放在 `backend/api/src/test/resources/scenarios/`。

---

## 4. 穩態計算

### 4.0 引擎入口

`engine` 模組對外只公開一個入口：

```java
public interface Simulator {
    SimulationResult simulate(Topology topology);
}
```

- 輸入是整份拓撲，輸出是完整結果（驗證錯誤、`nodes`、`edges`、`summary`），對應第 5 節的 response。
- 階段一的實作是 `SteadyStateSimulator`。驗證、流量、延遲、成功率、瓶頸都是它的內部細節，可以拆成多個 class，但不給 API 層直接呼叫。
- 每次呼叫都是獨立的計算，不保留狀態。前端每次 Run 都送出整份拓撲重算。
- API 層只負責 JSON ↔ `Topology`／`SimulationResult` 的轉換，不做任何計算。
- 4.6 的測試案例都透過 `simulate()` 撰寫，測試的是行為而不是內部結構。階段二的 DES 是另一個實作，介面需要擴充時再決定。

### 4.1 流程
1. **驗證**拓撲（見 4.5），有錯誤就直接回傳錯誤，不計算。
2. **拓撲排序**（Kahn's algorithm）。
3. 依序計算每個節點：
   1. 加總上游送來的 read / write 到達率 `λ`
   2. 計算 ρ、排隊延遲、實際處理量、丟棄量
   3. 依元件行為把**實際處理量**分給下游邊
4. 由下游往上游計算平均端到端延遲（4.3）與成功率（4.3.1）。
5. 彙總 summary、找出瓶頸。

### 4.2 單一節點（M/M/c）

- 使用率 `ρ = λ / (c × μ)`
- **ρ < 1**：
  - 等待機率 `P_wait` 用 **Erlang C**
  - 平均排隊時間 `Wq = P_wait / (c × μ − λ)`
  - 節點延遲 `W = Wq + 1/μ`
  - 丟棄量 = 0
- **ρ ≥ 1**（過載）：
  - 實際處理量 = `c × μ`，丟棄量 = `λ − c × μ`（read / write 依比例丟）
  - 延遲記為 `null`（佇列會無限成長，穩態下沒有定義）
  - 狀態 = `OVERLOADED`

**數值穩定性**：c 可能上百（例如 2 × 200 = 400），直接算 `a^c / c!` 會溢位。改用 Erlang B 遞迴再轉成 Erlang C：

```
a = λ / μ
B(0) = 1
B(k) = a·B(k−1) / (k + a·B(k−1))          k = 1..c
C    = c·B(c) / (c − a·(1 − B(c)))
```

### 4.2.1 Rate Limiter、External API

兩者都沒有 M/M/c，只有一個上限：Rate Limiter 是 `limitRps`，External API 是 `quotaRps`。

- 放行量 = `min(λ, 上限)`，read／write 依比例放行；**拒絕量** = `λ − 放行量`，不往下送（External API 沒有下游，放行量就是它處理完的請求）。
- 拒絕量和過載造成的丟棄量是不同的指標（回應的 `rejectedRps`、`droppedRps`），但都算進失敗率：`pass(n) = 放行量 / λ`（4.3.1），`summary.rejectedRps` 是所有節點拒絕量的總和。拒絕量和丟棄量一樣是到達這個節點的請求數：Rate Limiter／External API 放在 fan-out 的 Service 後面時算的是子呼叫，不是使用者請求數，成功率仍以 4.3.1 計算。
- 不排隊，`avgQueueMs` 為 0。Rate Limiter 的節點延遲 `W` 記為 0（**簡化假設**：limiter 本身不會成為瓶頸）；External API 的 `W = latencyMs`。端到端延遲只算被放行的請求，超過上限不會讓延遲變成無定義。
- 沒有容量和 ρ（`capacityRps`、`utilization` 為 `null`），不列入瓶頸候選。狀態不套用 4.4 的 ρ 分級，只看 `λ` 是否超過上限（剛好等於上限不拒絕）：

| 元件 | 超過上限 | 沒超過 |
|---|---|---|
| Rate Limiter | `LIMITING`（限流中） | `NOT_LIMITING`（未觸發） |
| External API | `OVER_QUOTA`（超過配額） | `WITHIN_QUOTA`（配額內） |

觸發限流是設計上預期的行為，不算故障，所以不變色、不發光。External API 超過配額會讓請求失敗，用紅色外框和紅字標出，但不脈動、不列入瓶頸。

### 4.2.2 熱點（Hot spot）

畫面只表示機器數：`instances` 是**處理流量的節點數**（Redis Cluster 是主節點數），所有節點共用一條佇列，用 4.2 的 M/M/c 計算（c = instances × concurrency）。模型裡沒有分片參數（0.6.0 移除 `shards`、`hotShardShare`）：資料怎麼切、熱點 shard 怎麼解，照圖補充說明，不在畫面上計算。

Cache 保留一個熱點的教學點：Redis Cluster 一個主就是一個 shard，所以「最熱的 shard」就是「最熱的那台」。

- 選填參數 `hotShare`（只有 Cache 有）：最熱的那台分到的流量比例，必須介於 `1/instances` 和 1 之間，而且 `instances` 至少 2（否則沒有「其他台」）。省略時沒有熱點，照上面共用一條佇列。
- 有 `hotShare` 時，最熱的那台單獨是一個 M/M/c（c = concurrency），到達率 = `hotShare` × λ；其他 `instances − 1` 台共用一條佇列，處理剩下的流量。read／write 依相同比例分配，`hitRatio` 兩邊相同，送往下游的是兩邊的 miss 加總。
- 節點層級：
  - ρ 和狀態取 ρ 較高的一邊（通常是最熱的那台，決定瓶頸）。
  - 容量 `capacityRps` 是所有機器的加總；有熱點時節點的 ρ 會比 `λ / capacityRps` 高。
  - 處理量和丟棄量是兩邊的加總，所以 `pass(n)` = 總處理量 ÷ 到達量（4.3.1）。
  - 節點延遲 `W`、`avgQueueMs` 依兩邊的流量加權平均；有流量的一邊過載時為 `null`。
- 回應的節點結果有 `hotSpot`（5）：`hottest` 是最熱那台的到達率、ρ、狀態、處理量、丟棄量、延遲；`others` 是其他台合起來的同樣指標（ρ 是每台相同的使用率）。沒有 `hotShare` 時 `hotSpot` 為 `null`。
- 選填參數 `replicas`（只有 Cache 有，0–5 的整數，省略時為 0）：每個主有幾個從，例如 Redis Cluster 的 3 主 3 從是 `instances = 3, replicas = 1`。**只是標記，不影響任何計算**：Redis 的從節點預設不分擔讀取，只做備援，所以 `instances` 只算主節點。從節點 failover、讀取分流、寫入同步到從節點的成本，照圖補充說明。
- Database 沒有 `hotShare`：它的 Read Replica 共用一條佇列，primary 的熱點到了 replica 會被平均掉，看起來像被 replica 解決了，教學上是錯的。
- **補充說明（hot key 的解法）**：熱點的根源是一個 key 只對應到一台機器，不論是 Redis Cluster 的 hash slot 還是 hash ring。讀熱時把 key 複製成 `key#1`～`key#N` 寫到不同機器、讀取時隨機挑一份，或在應用伺服器上做本地快取；寫熱時把 key 拆成多個子 key 寫到不同機器、讀取時合併（只適用計數、集合這類可以合併的資料；Redis 的子 key 不能用 hash tag，否則會落在同一個 slot）。這些是應用層的手法，模擬器不計算。
- **舊的自動存檔**：0.6.0 之前的存檔裡，有 `shards` 的節點 `instances` 是每個 shard 的台數。前端還原時把 `instances` 乘上 `shards`，丟掉 `shards`、`hotShardShare`；後端收到這兩個欄位時忽略。`diskGbPerShard` 改名成 `diskGbPerInstance`，數值不變（4.8）。

### 4.2.3 Read Replica

用來分擔 primary Database 的 read，並呈現「replica 也要套用所有寫入，所以無法擴展寫入」。預設值和 Database 相同（1 × 100、10 ms），一樣用 4.2 的 M/M/c 計算。

- **Replication 邊**：從 Database 拉到 Read Replica 的邊代表複製關係。primary 每秒**處理完**的 write，會在 replica 上同樣套用一次，算成 replica 的 write 到達率（primary 過載丟掉的 write 不會複製）。複製是非同步的，不算進 Client 的端到端延遲（4.3）和成功率（4.3.1），邊畫成虛線，邊上沒有參數可調。
- **Read 怎麼送到 replica**：用 Service 邊的 `requestClass`（3.4），例如 Service ─(WRITE)→ primary、Service ─(READ)→ replica。要分給多個 replica，中間放一個 LB。
- **唯讀**：write 只能經由複製邊到達 replica，其他路徑送得到 write 就是驗證錯誤 `REPLICA_RECEIVES_WRITES`（4.5），例如 Service ─(ALL 或 WRITE)→ replica，或有 write 的 Client／LB 直接連過去。這條規則只看拓撲、不看算出來的流量：從每個 `readRatio < 1` 的 Client 出發，Service 的邊只有 `requestClass` 包含 write 時才傳下去，Database／Object Storage 的出邊不傳，其他元件原樣往下傳。所以 Service ─(READ)→ LB → 多個 replica、`readRatio = 1` 的 Client → LB → replica 都合法。畫布上從 Service 拉到 Read Replica 的新邊，`requestClass` 預設 `READ`（其他新邊預設 `ALL`）。
- **過載**：replica 的丟棄量依比例分給 read 和複製寫入。read 的丟棄照常算進失敗率；複製寫入被丟棄時，節點結果的 `warnings` 有 `REPLICATION_LAG`，畫面顯示「複製跟不上」（replication lag 會持續增加）。警告不影響狀態分級。

### 4.2.4 Message Queue（簡化版）

引入「非同步」：展示 MQ 能削峰、降低使用者延遲，但下游的總負載不變。

**同步的部分（producer → MQ）**
- MQ 本身（broker）用 4.2 的 M/M/c 計算，預設 1 × 1000、1 ms（約 100 萬 rps）。broker 過載時會丟棄，算進 Client 的失敗率。
- Client 的端到端延遲**只算到 MQ 回 ack 為止**；訊息成功進入 queue 就算這個請求成功（相當於 HTTP 202 Accepted）。至少要有一個下游（`NO_DOWNSTREAM`）。

**非同步的部分（MQ → consumer）**
- MQ 的每條下游邊代表一個 **consumer group**，每個 group 都收到**全部**訊息（pub/sub，類似 Kafka）。同一個 group 內的 consumer 數量用下游節點的 instances 表示。邊上沒有參數可調，畫成虛線。
- consumer 處理不完時**不丟棄**，訊息留在 queue 裡：超過容量的部分依到達量比例分給各條上游邊，MQ 送來的那份記成那條邊的 `backlogRps`（backlog 每秒增加的筆數），從節點的丟棄量扣掉，節點的 `warnings` 有 `BACKLOG`，畫面顯示「積壓中」。同步送來的那份照常丟棄。
- consumer 的狀態照常依 ρ 分級（過載時是 `OVERLOADED`、也可能是瓶頸），「積壓中」是另外加上的警告：處理不完本身就是要看到的問題。
- consumer 實際處理的量 `min(λ, 容量)` 照常往下游送，所以 consumer 對 DB 的負載會和同步路徑疊加。
- consumer 處理了、但往下游失敗（例如 DB 過載丟掉 consumer 的寫入）的訊息也**不算丟棄**，同樣留在 queue 裡等重試：用 4.3.1 的成功率 `S` 計算，MQ 送來的 class `c` 每秒有 `rps_c × (pass(consumer) − S(consumer, c))` 筆，加進同一條邊的 `backlogRps`，consumer 也有 `BACKLOG` 警告。所以邊的 `backlogRps` = 處理不完的部分 + 處理了但下游失敗的部分，以訊息數計算（consumer fan-out 時 `S` 已經是「一則訊息的所有子呼叫都成功」的機率，不會乘上 `callsPerRequest`）。下游節點自己的丟棄量照常顯示（例如 DB 過載仍是瓶頸、仍有丟棄）。
- **簡化假設**：留在 queue 裡的訊息之後會重試，但重試對 consumer 和下游增加的負載不計算。
- MQ 下游所有節點的延遲都不算進 Client 的端到端延遲（4.3），成功率（4.3.1）也只看 broker 的 `pass`。同一個節點如果同時在同步和非同步路徑上，它的 W 只有一個，同步路徑照常計算。

### 4.3 端到端平均延遲

設 `L(n, class)` 為一個 class 的請求從節點 n 開始到完成的平均延遲：

| 元件 | `L(n)` |
|---|---|
| Database、External API | `W(n)`（External API 的 `W = latencyMs`） |
| Load Balancer／Client | `W(n) + Σ (weight_i / Σweight) × (edge_i.latencyMs + L(child_i))` |
| Service（`SEQUENTIAL`） | `W(n) + Σ callsPerRequest_i × (edge_i.latencyMs + L(child_i))`（依序呼叫，所以相加；只加 `requestClass` 符合這個 class 的下游，下同） |
| Service（`PARALLEL`） | `W(n) + max_i [ callsPerRequest_i × (edge_i.latencyMs + L(child_i)) ]`（各下游同時呼叫，取最慢的；同一個下游呼叫多次時仍依序） |
| Cache（read） | `W(n) + (1 − hitRatio) × (edge.latencyMs + L(child))` |
| Cache（write） | `W(n) + edge.latencyMs + L(child)` |
| CDN（read） | `W(n) + (1 − hitRatio) × Σ (weight_i / Σweight) × (edge_i.latencyMs + L(child_i))` |
| CDN（write） | `W(n) + Σ (weight_i / Σweight) × (edge_i.latencyMs + L(child_i))` |
| Rate Limiter | `W(n) + edge.latencyMs + L(child)`，`W(n) = 0` |

Client 本身沒有 W（記為 0）。

**「路徑」只算這個 class 實際會走到的下游**：一個請求平均往某條邊送的次數為 0 時（Cache read 的 `1 − hitRatio`、Service 上 `requestClass` 不符合的邊；weight 和 `callsPerRequest` 都不能為 0），那個下游不在這個 class 的路徑上，公式裡也略過它（避免 `0 × null`）。例如 `hitRatio = 1` 時 read 不會到 DB，DB 被 write 壓到過載只讓 write 變成 `null`。

端到端延遲在下列情況記為 `null`，回應的 `undefinedReason` 說明原因：

| `undefinedReason` | 情況 |
|---|---|
| `OVERLOADED` | 路徑上有節點過載，系統不在穩態。`overloadedNodeIds` 列出這些節點 |
| `NO_TRAFFIC` | 沒有這個 class 的請求，沒有平均可言 |

Client、LB 或 CDN 沒有下游時請求沒有地方送，這種拓撲會被驗證規則 `NO_DOWNSTREAM`（4.5）擋下，不會進到計算。前端要在 `null` 旁邊顯示原因（例如「DB 過載，穩態延遲無定義」），並搭配 `successRps`（4.3.1）讓使用者看到還有多少請求成功。原因和過載節點由後端判斷，前端只負責顯示。

**多個 Client**：每個 Client 各自的端到端延遲 `L(client, class)` 放在回應 `nodes` 中該 Client 的 `endToEndMs`。`summary.avgEndToEndMs` 用各 Client 該 class 的請求數加權平均：

```
avgEndToEndMs[class] = Σ_client (client.rps × classRatio × L(client, class)) / Σ_client (client.rps × classRatio)
```

其中 `classRatio` 是 read 的 `readRatio` 或 write 的 `1 − readRatio`。沒有該 class 請求的 Client 權重為 0，不參與平均；其餘任一 Client 的該 class 為 `null` 時，summary 的該 class 也是 `null`（`overloadedNodeIds` 為各 Client 的聯集）；分母為 0（沒有該 class 的流量）時記為 `null`、原因 `NO_TRAFFIC`。只有一個 Client 時，結果就等於該 Client 的延遲。

> 階段一只算**平均值**。p99 不能沿路徑相加，需要分佈或模擬，留到階段二。
>
> ⚠️ **`PARALLEL` 是近似值**：「各下游平均值的最大值」會低估真實延遲（真實的是「每個請求各自取最大值」再平均）。回應以 `approximate: true` 標示，前端顯示「近似」；路徑上的 `PARALLEL` Service 這個 class 實際只呼叫一個下游時（例如 READ、WRITE 各一條邊），取最大值就是它本身，不算近似；`ms` 為 `null` 時 `approximate` 一定是 `false`。summary 只要有一個參與平均的 Client 是近似，就是近似。階段二用 DES 算出正確值。

### 4.3.1 成功率

Service 有 fan-out 時，下游的 RPS 是「子呼叫」而不是「使用者請求」，所以不能直接用丟棄量加總算成功數。改用成功機率沿呼叫樹由下往上乘：

- 每個節點的通過率 `pass(n) = 實際處理量 / 到達量`（未過載時為 1）
- 設 `S(n, class)` 為一個 class 的請求從節點 n 開始、最後完整成功的機率

| 元件 | `S(n)` |
|---|---|
| Database、External API | `pass(n)`（External API 的 `pass(n) = 放行量 / 到達量`） |
| Load Balancer／Client | `pass(n) × Σ (weight_i / Σweight) × S(child_i)` |
| Service（依序或平行都一樣） | `pass(n) × Π S(child_i)^callsPerRequest_i`（任何一個子呼叫失敗，整個請求就失敗；只乘 `requestClass` 符合這個 class 的下游） |
| Cache（read） | `pass(n) × (hitRatio + (1 − hitRatio) × S(child))` |
| Cache（write） | `pass(n) × S(child)` |
| CDN（read） | `pass(n) × (hitRatio + (1 − hitRatio) × Σ (weight_i / Σweight) × S(child_i))` |
| CDN（write） | `pass(n) × Σ (weight_i / Σweight) × S(child_i)` |
| Rate Limiter | `pass(n) × S(child)`，`pass(n) = 放行量 / 到達量`（拒絕也算失敗） |

Client 的 `pass` 記為 1。彙總：
- `successRps = Σ_client Σ_class client 的該 class rps × S(client, class)`
- `dropRate = 1 − successRps / offeredRps`（丟棄和拒絕都算），限制在 [0, 1]，浮點誤差造成的極小值（|x| < 1e-9）歸零；`offeredRps = 0` 時沒有東西被丟，記為 0

> **簡化假設**：各節點的丟棄彼此獨立。

### 4.4 狀態分級

| ρ | 狀態 | 顏色 |
|---|---|---|
| < 0.7 | `OK` | 綠 |
| 0.7 – 0.9 | `WARN` | 黃 |
| 0.9 – 1.0 | `CRITICAL` | 橘 |
| ≥ 1.0 | `OVERLOADED` | 紅 |

畫面另外有兩種灰色狀態，由前端判斷，不在 API 的 `status` 裡：

| 情況 | 顯示 | 顏色 |
|---|---|---|
| 節點沒有任何邊（未連線，4.5） | 未連線 | 灰，整個節點畫淡 |
| 有連線但到達率是 0（例如 Service 的邊是 READ only，下游的 DB 收不到請求） | 無流量 | 灰，優先於 OK、未觸發、配額內 |

Client 不適用（它沒有狀態，沒連線時是驗證錯誤）。

Rate Limiter 和 External API 的狀態不看 ρ（4.2.1）：Rate Limiter 只有 `LIMITING`、`NOT_LIMITING`，中性灰、不發光；External API 只有 `OVER_QUOTA`（紅色外框、不脈動）和 `WITHIN_QUOTA`（中性灰）。

**瓶頸** = ρ 最高的節點。Client、Rate Limiter 和 External API 的 ρ 為 `null`，不列入瓶頸候選；未連線的節點（4.5）不在拓撲裡，也不列入。後端的 `bottleneckNodeId` 永遠是 ρ 最高的節點；畫面只在它的狀態是 `WARN` 以上（ρ ≥ 0.7）時稱它為瓶頸，低於門檻時顯示「無瓶頸」（第 6 節）。

### 4.5 驗證規則

| 規則 | 錯誤碼 |
|---|---|
| 至少一個 Client | `NO_CLIENT` |
| 不能有環 | `CYCLE_DETECTED` |
| Client 不能有上游 | `CLIENT_HAS_INPUT` |
| Database 只能連到 Read Replica；Object Storage 不能有下游（沿用同一個錯誤碼，訊息寫各自的 type） | `DATABASE_HAS_OUTPUT` |
| Read Replica 必須剛好有一個 Database 上游（primary） | `REPLICA_PRIMARY_COUNT` |
| Read Replica 不能有下游 | `REPLICA_HAS_OUTPUT` |
| Read Replica 是唯讀的：write 只能經由複製邊送到（4.2.3） | `REPLICA_RECEIVES_WRITES` |
| Cache 必須剛好一個下游 | `CACHE_DOWNSTREAM_COUNT` |
| Rate Limiter 必須剛好一個下游 | `RATE_LIMITER_DOWNSTREAM_COUNT` |
| External API 不能有下游 | `EXTERNAL_API_HAS_OUTPUT` |
| Message Queue 只能連到 Service（consumer group 的 consumer 數量用 Service 的 instances 表示） | `QUEUE_CONSUMER_TYPE` |
| Client／LB／CDN／Message Queue 至少一個下游（Service 可以是終點，代表不依賴其他元件的服務） | `NO_DOWNSTREAM` |
| 邊的 source / target 必須存在 | `UNKNOWN_NODE` |
| 同一對 source → target 只能有一條邊 | `DUPLICATE_EDGE` |
| 參數範圍（見下方合法範圍） | `INVALID_PARAM` |

**未連線的節點**：沒有任何入邊和出邊的節點（例如剛從元件面板加進來的 Cache）不在拓撲裡，不檢查上表跟邊有關的規則（下游數、primary 數等），參數範圍照樣檢查。它照常計算，到達率是 0，Read Replica 沒有 primary 時沒有複製寫入、也不算進任何 Database 的副本。只連了一半的節點（例如 Cache 有上游、沒有下游）照常驗證。Client 例外：沒連線的 Client 仍然報 `NO_DOWNSTREAM`，因為它宣告的流量沒有地方送。畫面上的顯示見第 6 節。

每個錯誤要附上 `nodeId` 或 `edgeId`，前端用來把有問題的節點標出來：

- `NO_CLIENT` 兩個都是 `null`（沒有可以指的節點）。
- `CYCLE_DETECTED` 在環上的每個節點各一個錯誤；環下游、夾在兩個環中間的節點不算。
- `CLIENT_HAS_INPUT`、`DATABASE_HAS_OUTPUT`、`CACHE_DOWNSTREAM_COUNT`、`RATE_LIMITER_DOWNSTREAM_COUNT`、`EXTERNAL_API_HAS_OUTPUT`、`REPLICA_PRIMARY_COUNT`、`REPLICA_HAS_OUTPUT`、`REPLICA_RECEIVES_WRITES`、`QUEUE_CONSUMER_TYPE`、`NO_DOWNSTREAM` 附 `nodeId`。
- `UNKNOWN_NODE`、`DUPLICATE_EDGE`（第二條以後的邊）附 `edgeId`。連到不存在節點的邊不參與其他規則，但仍算在另一端的上下游數量裡（畫布上看得到這條邊，不重複報錯）。
- `INVALID_PARAM`：節點參數附 `nodeId`、邊的參數附 `edgeId`。Client／LB／CDN 出邊的 `weight` 必須 > 0：weight 為 0 的下游收不到流量，等於沒有接，要停用就刪掉連線。Rate Limiter 的 `limitRps`、External API 的 `quotaRps` 也必須 > 0：0 等於全部拒絕，要停用就刪掉節點。

參數的合法範圍。上限擋掉會讓 Run 太慢（worker 數決定 Erlang C 的計算量）或結果溢位成 `Infinity` 的極端數值；屬性面板的輸入框用同一組範圍，讀入超出範圍的存檔時不擋，Run 之後在錯誤分頁顯示。

| 參數 | 合法範圍 |
|---|---|
| `rps` | 0 ～ 1,000,000,000,000（1e12） |
| `limitRps`、`quotaRps` | > 0 且 ≤ 1e12 |
| `hotShare`（選填，Cache） | `1/instances` ～ 1，且 `instances` ≥ 2 |
| `replicas`（選填，Cache） | 0 ～ 5 的整數 |
| `readRatio`、`hitRatio` | 0 ～ 1 |
| `readResponseBytes`、`writeRequestBytes`、`bytesPerWrite` | 0 ～ 1,000,000,000,000（1e12，1 TB） |
| `retentionDays` | 0 ～ 100,000 |
| `diskGbPerInstance`（選填，Database） | > 0 且 ≤ 1,000,000,000（1e9 GB） |
| `instances`、`concurrency` | 各自 ≥ 1 的整數，且 `instances × concurrency` ≤ 1,000,000（看乘積，不是各自檢查） |
| `serviceTimeMs` | 0.000001 ～ 10,000,000（1e-6 ～ 1e7） |
| `latencyMs`（邊和 External API） | 0 ～ 10,000,000（1e7） |
| `callsPerRequest` | 1 ～ 10,000 的整數 |
| `weight` | > 0 且 ≤ 1,000,000（1e6） |

Worker 上限 1e6 時單一節點的 Erlang C 最多約 6 ms；1e7 時約 60 ms，十幾個節點就超過 1 秒。這組上限保證的是一般大小的拓撲：上百個接近滿載的節點仍可能超過 1 秒，幾十層、每層都把 `callsPerRequest` 開到上限的依序呼叫鏈，端到端延遲仍可能溢位。

存檔裡的整數參數（`instances`、`concurrency`、`callsPerRequest`）超出 32 位元整數時，API 沒辦法解析，所以讀入時就當成格式錯誤擋下；32 位元範圍內但超過上限的值照樣讀入。

錯誤依 `NO_CLIENT`、各節點、各邊排列，節點和邊依輸入順序。`message` 是給使用者看的中文說明，用節點名稱指稱節點。

以下是**格式錯誤**，錯誤沒辦法指到哪一個節點，回 HTTP 400，`detail` 說明是哪個欄位：

- 不是合法的 JSON。
- `version` 不是 1。
- 缺少必填欄位，或節點、邊的 `id` 重複。
- 欄位型別不符：數字欄位給字串或布林、整數欄位（`instances`、`concurrency`、`callsPerRequest`、`version`）給小數（`2.0` 也算；前端讀入分不出 `2.0` 和 `2`，會當成 `2` 送出）、字串欄位給數字、`type` 等 enum 給數字或不在清單內的值。API 不做自動轉換。

其他例外是後端的程式錯誤，回 HTTP 500。

### 4.6 驗算用的測試案例

| 情境 | 輸入 | 預期 |
|---|---|---|
| M/M/1 | c=1, μ=100, λ=80 | ρ=0.8, Wq=40ms, W=50ms |
| M/M/2 | c=2, μ=100, λ=150 | ρ=0.75, P_wait=0.6429, Wq≈12.86ms, W≈22.86ms |
| 過載 | c=1, μ=100, λ=150 | 處理量 100、丟棄 50、W=null |
| Cache 分流 | λ_read=900, λ_write=100, hit=0.8 | 下游 read=180、write=100 |
| 大 c 不溢位 | c=400, ρ=0.9 | 結果有限且合理 |
| 依序呼叫 | Service W=50ms，兩個下游 L=10ms、30ms，邊 latency=1ms | L = 50 + 11 + 31 = 92ms |
| 平行呼叫 | 同上，`callMode=PARALLEL` | L = 50 + max(11, 31) = 81ms |
| Fan-out 成功率 | Client 1000 rps → Service（pass=1）→ DB-A（pass=0.9，callsPerRequest=2）、DB-B（pass=1） | S = 0.9² × 1 = 0.81，successRps=810，dropRate=0.19 |
| 頻寬 | Client 1000 rps、readRatio=0.9、回應 10 KB、上傳 1 KB → CDN（hit=0.95） | 出口 9,000,000 B/s、入口 100,000 B/s、CDN 擋掉 8,550,000 B/s |
| 儲存量 | write 100 rps 全部處理、bytesPerWrite=2000、retentionDays=30、instances=2、diskGbPerInstance=100、2 個 Read Replica | 每日 17.28 GB、總量 518.4 GB、含副本 1,555.2 GB、每台 259.2 GB、約 11.6 天磁碟滿（保留期內會滿） |

### 4.7 使用者端頻寬

back-of-envelope 估算只算 **Client 進出的流量**。內部呼叫每條的封包大小都不一樣，逐條設定的參數太多，所以不估算。

```
出口（egress） = Client 邊上的 read rps  × readResponseBytes    # read 回應送給使用者
入口（ingress）= Client 邊上的 write rps × writeRequestBytes    # write 從使用者上傳
```

- 每條 Client 的邊各自計算（邊結果的 `bandwidth`），`summary.bandwidth` 是所有 Client 的邊加總。
- 用 Client **送出**的請求數計算，是需求量：之後被丟棄或拒絕的請求不扣除。
- **CDN 擋掉的 origin 頻寬**（`summary.cdnOffloadBytesPerSec`）：CDN 命中的 read 由 CDN 直接回應，不必從 origin 送出。每個 CDN 擋掉 `處理的 read × hitRatio × 平均回應大小`，平均回應大小是到達這個 CDN 的 read 依來源 Client 的 `readResponseBytes` 加權平均（不同 Client 的 read 經過同一個 CDN 時）。origin 出口 = 出口 − CDN 擋掉的部分。CDN 只算它實際處理的命中，所以 CDN 過載或上游拒絕時，被丟棄或拒絕的 read 也算在 origin 出口裡，是上限值（和出口一樣是需求量；過載照常標示）。
- 只有 CDN 算，Cache 不算：Cache 命中的回應仍由 origin 的 Service 送出。
- CDN 放在 Service 後面時，fan-out 的子呼叫沿用 Client 的回應大小，是近似值；擋掉的量最多等於出口頻寬。

### 4.8 儲存量估算

back-of-envelope 估算的儲存量，每個 Database、Object Storage 各算一份（回應的 `storage`，以節點 id 為 key）。

```
每日增量 = 處理完的 write × bytesPerWrite × 86,400
總量     = 每日增量 × retentionDays
含副本   = 總量 × (1 + Read Replica 數)
每台     = 總量 ÷ instances                              # 資料平均分布在處理流量的機器上
磁碟滿   = diskGbPerInstance × 10⁹ ÷ (每日增量 ÷ instances)   # 約幾天後磁碟滿
```

- 用**成功處理**的 write（丟棄依 read／write 比例發生，4.2），過載時被丟棄的 write 不算，所以過載時數字偏低；容量估算分頁照常標示過載。
- Read Replica 數是 primary 是這個 Database 的 Read Replica 個數；Replica 存的是同一份資料，沒有自己的估算。
- GB 是十進位（10⁹ bytes）。Object Storage、沒有設定 `diskGbPerInstance`、沒有寫入（資料不會增加），或寫入量小到天數超出浮點數範圍時，`daysUntilFull` 是 `null`。
- **副本跟不上**：primary 的 Read Replica 有 `REPLICATION_LAG`（4.2.3）時，「含副本」仍照完整副本計算，數字不改，但回應的 `replicasLagging` 為 true，容量估算分頁在那一列加註「副本複製跟不上，實際副本量會比這少」。
- **磁碟會滿**（`fillsDisk`）：`daysUntilFull < retentionDays`，也就是保留期內每台的資料會超過磁碟容量。這是另一種瓶頸，和 ρ 分開顯示，不混進「瓶頸 = ρ 最高」的規則（`bottleneckNodeId` 不變）。

### 4.9 計算說明

讓每個數字都能說明是怎麼算出來的：引擎在同一次計算裡替每個節點列出步驟，放在回應的節點結果 `explanation`（第 5 節），前端不重算。

**格式**：一串步驟，依計算順序排列。每一步有：

| 欄位 | 意思 |
|---|---|
| `group` | 分組標題，例如「到達量」「容量與使用率」「最熱那台」；同一組的步驟相鄰 |
| `label` | 這一步算的是什麼，例如「使用率 ρ（0.7 ≤ ρ < 0.9：WARN）」 |
| `formula` | 公式，用大括號標出代入值，例如 `{λ} ÷ ({c} × {μ})`；沒有大括號的是純文字說明 |
| `terms` | 代入值 `{ symbol, value, unit, nodeId }`，依在 `formula` 裡出現的順序，`symbol` 對應大括號裡的文字 |
| `value`、`unit` | 這一步的結果 |

- `unit` 是 `rps`、`ms`、`%`（0–1 的比例，顯示成百分比）或 `null`（沒有單位，例如 ρ、c）。
- `value` 為 `null` 表示**沒有定義**（例如過載時的延遲），不是 0；代入值也一樣（例如下游過載時它的端到端延遲）。
- 代入值來自另一個節點時（上游送來的量、下游的成功率或延遲），`nodeId` 是那個節點，前端可以點過去；其他時候為 `null`。
- 名稱和公式文字由後端產生（跟驗證錯誤的 `message` 一樣），數字由前端用自己的格式顯示，畫面上是「ρ = λ ÷ (c × μ) = 1,000 ÷ (2 × 1,000) = 0.50」。

**每個節點只說明自己這一層**：上下游的數字直接當作代入值，不展開它們的算式；要往下追就點那個節點。

**涵蓋範圍**（依順序；沒有的部分不列）：

| 分組 | 步驟 |
|---|---|
| 送出（Client） | read = rps × readRatio、write = rps − read |
| 到達量 | read、write 各是每條上游邊送來的量加總：上游處理完的流量 × visits（3.3、3.4），再加成 λ |
| 容量與使用率 | c = instances × concurrency、μ = 1000 ÷ serviceTimeMs、容量 c × μ、ρ = λ ÷ (c × μ)；ρ 的名稱後面寫判斷狀態的門檻（4.4） |
| 節點延遲（ρ < 1） | a = λ ÷ μ、P_wait = ErlangC(c, a)、Wq = P_wait ÷ (c × μ − λ)、W = Wq + 1/μ（4.2，Erlang C 只列結果，不列遞迴過程） |
| 過載（ρ ≥ 1） | 處理量 = c × μ、超過容量的部分 = λ − c × μ、W 沒有定義 |
| 最熱那台、其他 N 台、整個節點（有 hotShare 的 Cache） | 兩邊各自的到達量和上面兩組；整個節點的容量、ρ 取較高的一邊、處理量和丟棄量加總、Wq 和 W 依流量加權平均（4.2.2） |
| 往下游（Cache、CDN） | 沒命中、往下游送的 read = 處理的 read × (1 − hitRatio) |
| 限流、配額（Rate Limiter、External API） | 放行量 = min(λ, 上限)、拒絕量 = λ − 放行量（名稱寫畫面上的狀態，例如「限流中」）、固定的節點延遲（4.2.1） |
| 複製（Read Replica） | 複製寫入 = primary 處理完的 write；有 `REPLICATION_LAG` 時，丟掉的複製寫入 = 丟棄量 × λ_write ÷ λ（4.2.3） |
| Message Queue 積壓（consumer） | 有 `BACKLOG` 時，每條 Message Queue 送來的邊每秒留在 queue 的訊息，以及扣掉留在 queue 的部分之後的丟棄量（4.2.4）；這時「過載」那組的 λ − c × μ 只叫「超過容量」，不叫丟棄 |
| 成功率 | 每個有流量的 class：通過率 pass = 處理量 ÷ λ，以及從這個節點開始的 S（4.3.1），下游的 S 當作代入值；Client 再加上每秒完整成功的請求數 |
| 端到端延遲 | 每個有流量的 class：從這個節點開始的 L = W + Σ visits × (邊的延遲 + 下游的 L)，平行呼叫取最大值；非同步的下游不在路徑上（4.3） |

- **未連線的節點**（4.5）沒有步驟，`explanation` 是空陣列。有連線但 λ = 0 的節點照常列出到達量和容量與使用率；沒有流量的 class 不列成功率和端到端延遲。
- 步驟的結果直接取自同一次計算的結果，跟 `nodes` 裡的欄位相同（測試鎖住）；中間值用同一組函式重算。

---

## 5. API

### `POST /api/v1/simulate`

**Request**（也是自動存檔的格式）

```json
{
  "version": 1,
  "nodes": [
    { "id": "client-1", "type": "CLIENT", "name": "Users",
      "params": { "rps": 1000, "readRatio": 0.9 },
      "ui": { "x": 0, "y": 0 } },
    { "id": "svc-1", "type": "SERVICE", "name": "API",
      "params": { "instances": 2, "concurrency": 200, "serviceTimeMs": 50,
                  "callMode": "SEQUENTIAL" },
      "state": "HEALTHY",
      "ui": { "x": 300, "y": 0 } }
  ],
  "edges": [
    { "id": "e1", "source": "client-1", "target": "svc-1",
      "weight": 1, "callsPerRequest": 1, "latencyMs": 1 }
  ]
}
```

`ui` 只給前端用，後端忽略但不刪除，所以自動存檔能還原畫布位置。

**Response 200**

```json
{
  "valid": true,
  "errors": [],
  "nodes": {
    "client-1": {
      "arrivalRps": { "read": 900, "write": 100 },
      "throughputRps": 1000,
      "droppedRps": 0,
      "rejectedRps": 0,
      "successRps": 1000,
      "endToEndMs": {
        "read":  { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null },
        "write": { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null }
      },
      "capacityRps": null,
      "utilization": null,
      "avgQueueMs": null,
      "avgLatencyMs": null,
      "status": null,
      "hotSpot": null,
      "warnings": [],
      "explanation": [
        { "group": "送出", "label": "read", "formula": "{rps} × {readRatio}",
          "terms": [{ "symbol": "rps", "value": 1000, "unit": "rps", "nodeId": null },
                    { "symbol": "readRatio", "value": 0.9, "unit": "%", "nodeId": null }],
          "value": 900, "unit": "rps" }
      ]
    },
    "svc-1": {
      "arrivalRps": { "read": 900, "write": 100 },
      "throughputRps": 1000,
      "droppedRps": 0,
      "rejectedRps": 0,
      "capacityRps": 8000,
      "utilization": 0.125,
      "avgQueueMs": 0.0,
      "avgLatencyMs": 50.0,
      "status": "OK",
      "hotSpot": null,
      "warnings": [],
      "explanation": [
        { "group": "容量與使用率", "label": "使用率 ρ（ρ < 0.7：OK）", "formula": "{λ} ÷ ({c} × {μ})",
          "terms": [{ "symbol": "λ", "value": 1000, "unit": "rps", "nodeId": null },
                    { "symbol": "c", "value": 400, "unit": null, "nodeId": null },
                    { "symbol": "μ", "value": 20, "unit": "rps", "nodeId": null }],
          "value": 0.125, "unit": null }
      ]
    }
  },
  "edges": {
    "e1": { "rps": { "read": 900, "write": 100 }, "backlogRps": 0,
            "bandwidth": { "egressBytesPerSec": 9000000, "ingressBytesPerSec": 100000 } }
  },
  "summary": {
    "offeredRps": 1000,
    "successRps": 1000,
    "rejectedRps": 0,
    "dropRate": 0.0,
    "avgEndToEndMs": {
      "read":  { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null },
      "write": { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null }
    },
    "bottleneckNodeId": "svc-1",
    "bandwidth": { "egressBytesPerSec": 9000000, "ingressBytesPerSec": 100000 },
    "cdnOffloadBytesPerSec": 0
  },
  "storage": {}
}
```

驗證失敗時一樣回 200，`valid: false`，`errors` 為錯誤清單，不做任何計算：`nodes`、`edges` 為 `{}`，`summary` 為 `null`。拓撲有問題是使用者的編輯狀態，不是 HTTP 錯誤。

**警告**：`warnings` 永遠是陣列，沒有警告時為空；Read Replica 的 `REPLICATION_LAG`（4.2.3）、consumer 的 `BACKLOG`（4.2.4）。邊結果的 `backlogRps` 只有 Message Queue 的下游邊會大於 0（4.2.4）。

**儲存量**：`storage` 以 Database、Object Storage 的 id 為 key（拓撲裡沒有時是 `{}`，例如上面的範例），每筆有 `dailyBytes`、`totalBytes`、`replicas`、`totalWithReplicasBytes`、`replicasLagging`（4.8）、`perInstanceBytes`（bytes）、`daysUntilFull`（可為 `null`）、`fillsDisk`（4.8），以及計算時用的 `retentionDays`、`diskGbPerInstance`（沒有設定時和 Object Storage 為 `null`），畫面依這兩個欄位顯示，不讀目前的拓撲。驗證失敗時也是 `{}`。

**計算說明**：每個節點的 `explanation` 是計算步驟（4.9），上面的範例各只列一步；未連線的節點是 `[]`。

**頻寬**：單位 bytes/s（4.7）。邊結果的 `bandwidth` 只有 Client 的邊有，其他邊為 `null`；`summary.bandwidth` 一定有。

**熱點**：`hotSpot` 只有設定了 `hotShare` 的 Cache 有，`hottest`、`others` 各有 `arrivalRps`、`throughputRps`、`droppedRps`、`utilization`、`avgLatencyMs`、`status`；其他節點為 `null`（4.2.2）。

**Rate Limiter、External API 節點**：`throughputRps` 是放行量；`capacityRps`、`utilization` 為 `null`，`avgQueueMs` 為 0，`avgLatencyMs` 是 Rate Limiter 的 0 或 External API 的 `latencyMs`；`status` 見 4.2.1。

**Client 節點**：`arrivalRps` 是它送出的流量；`successRps` 和 `endToEndMs` 只有 Client 才有，代表這個 Client 的請求有多少成功、平均要等多久。其餘描述伺服器的欄位（容量、使用率、排隊、延遲、狀態）都是 `null`；非 Client 節點的 `endToEndMs` 也是 `null`。

**`null` 和 `0` 的語意不同**：

- `0` 表示「這個量存在，數值剛好是零」，例如沒有流量的 Service `utilization: 0`、Client `droppedRps: 0`。
- `null` 有兩種意思：**不適用**（Client 的 `utilization`、`status` 等）和**無定義**（過載時的延遲，見 4.2、4.3）。
- 前端把 `null` 顯示為「—」，不能當成 0。「無定義」的情況要附上原因；`status: null` 的節點不變色、不發光。
- 流量類欄位（`arrivalRps`、`throughputRps`、`droppedRps`、`rejectedRps`）永遠是數字，不會是 `null`。`rejectedRps` 只有 Rate Limiter 和 External API 會大於 0（4.2.1），`summary.rejectedRps` 是它們的總和。`successRps` 只有 Client 有：Client 一律是數字，其他節點是 `null`（不適用，fan-out 後下游的子呼叫數不是使用者請求數）。

---

## 6. 前端畫面

```
┌────────────────────────────────────────────────────────────────┐
│ System Design Simulator [▶ Run] [Auto-run ☑] [↶][↷] [起始拓撲]           │
├──────────┬─────────────────────────────────────┬───────────────┤
│ 元件      │                                     │ 屬性           │
│ ● 流量    │      ┌──────┐     ┌────┐             │ ▣ API Server  │
│ ▣ Client │      │Users │────▶│ LB │──┐          │ instances  [2]│
│ ▣ LB     │      └──────┘     └────┘  ▼          │ concurrency   │
│ ● 運算    │                      ┌─────────┐     │ ━━━━●━━ 200   │
│ ▣ Service│                      │▣ API    │(黃) │ serviceTime   │
│ ● 資料    │                      │  ρ 0.80 │     │ ━━●━━━━ 50ms  │
│ ▣ Cache  │                      └─────────┘     │ ρ ████░ 0.80  │
│ ▣ DB     │          （React Flow 畫布）           │               │
│ ● 非同步  │                                      │               │
│ ▣ MQ     │                                      │               │
├──────────┴─────────────────────────────────────┴───────────────┤
│ [指標表] [流量 Sankey] [容量估算] [錯誤 (0)]  頻寬 出口 … 入口 …         │
│ ┌成功率──┐ ┌端到端延遲┐ ┌丟棄───┐ ┌瓶頸────────┐              │
│ │ 99.5% │ │ 52.0 ms │ │ 64 rps│ │ Orders DB ρ 1.03│         │
│ └───────┘ └─────────┘ └───────┘ └─────────────┘              │
│ 節點    λ     容量   ρ    延遲   丟棄   拒絕   狀態                   │
└────────────────────────────────────────────────────────────────┘
```

| 區塊 | 元件 |
|---|---|
| 左側元件面板 | shadcn Sidebar，依類別分成流量、運算、資料、非同步四組，每組有類別色（流量藍、運算紫、資料粉、非同步青），元件圖示放在類別色的圓角方塊裡，畫布節點和屬性面板標題用同一個樣式（拖到畫布，放在滑鼠放開的位置；點一下則放在畫面中央，被占了就往外找最近一個不重疊的位置） |
| 右側屬性面板 | shadcn Input、Slider、Progress（ρ）。參數名稱寫成「中文（英文）」，英文是 API 的欄位名稱、用較淡的顏色，例如「機器數（instances）」「使用率（ρ）」；下拉選項寫成「依序（SEQUENTIAL）」；元件名稱和單位維持英文 |
| 下方結果 | shadcn Tabs、Table、Badge（狀態）；ECharts Sankey；分頁下方的重點數字卡片 |
| 工具列 | shadcn Button、Switch、DropdownMenu |
| 通知 | shadcn Sonner（例如「發現瓶頸：DB」），出現在畫布右上角，不蓋住屬性面板和工具列；每則都有 ✕ 可以關閉 |

**互動規則**
- 自訂 React Flow 節點：顯示名稱、類型圖示、ρ 和狀態色；Run 之後才會出現指標。
- 邊上的 label 顯示 RPS，粗細依流量比例。
- 節點有警告時（Read Replica 的「複製跟不上」、consumer 的「積壓中」）在節點和指標表的狀態旁顯示。Message Queue 的下游邊有積壓時，標籤第二行顯示「積壓 +X rps/s」（不拉長標籤）。邊的標籤畫在節點上面一層，節點靠得近時不會被擋住，也不攔截節點的點擊和拖曳。
- Rate Limiter、External API 節點沒有 ρ，改顯示拒絕量和狀態（「限流中」／「未觸發」、「超過配額」／「配額內」）。
- 延遲（指標表、端到端延遲）取一位小數；小於 0.1 ms 時改用兩位有效數字（例如 Cache 預設的 `0.010 ms`），0 顯示 `0 ms`。
- 指標表的到達率 λ 顯示總和，下面一行小字分開列 read、write（例如 `read 180・write 100`），看得出 Cache 只擋下 read。
- **參數說明 ⓘ**：屬性面板每個參數（含邊參數、下拉選單、`hotShare`、`diskGbPerInstance`）的名稱後面有 ⓘ，滑過或用鍵盤聚焦時顯示：「常見：a–b 單位」（有實值的參數才有，例如 `serviceTimeMs`）、一句說明、「例：…」。說明依「元件 type × 參數」各寫一筆（Redis Cluster 用 Cache 的），邊參數依起點的 type，連到 External API 的邊另有一筆。看情境的參數（`rps`、`instances` 等）寫怎麼估算，比例或結構的參數（`weight`、`hotShare` 等）只寫用途，都沒有範圍。值落在常見範圍外時（剛好等於兩端不算），欄位下方多一行黃字「⚠ 超出常見範圍（a–b 單位）」，範圍寫法同 tooltip；值不合法時只顯示錯誤，不同時出現黃字。常見範圍只是建議，**不影響驗證和 Run**：不擋輸入、不進錯誤分頁、畫布上的節點也不標記。數字以 `frontend/src/canvas/paramGuide.ts` 為準，不抄進 spec。
- **怎麼算的**：點節點時，屬性面板最下面有一個「怎麼算的」區塊，預設收起；展開後換到別的節點仍然展開，重新整理後回到收起。內容是節點的計算步驟（4.9），依分組列出，每一步四行：名稱、符號的公式、代入值、結果，例如「使用率 ρ」「λ ÷ (c × μ)」「= 1,000 ÷ (8 × 100)」「= 1.25」，窄的面板裡換行，不出現水平捲軸。數字的寫法：整數加千分位、100 以上取整數、其他兩位小數，太小的用兩位有效數字；比例寫成百分比；代入值沒有定義寫「—」，結果寫「沒有定義」。純文字的公式（例如過載時延遲沒有定義）沒有代入值那一行。代入值來自別的節點時，後面接著那個節點的名稱（連結），點了就選取那個節點、畫布平移到它（縮放不變），屬性面板換成它的算式，可以一路從 Client 追到 Database。未連線的節點寫「未連線，沒有計算」；還沒有結果時寫「Run 之後顯示」；結果過期時算式照樣顯示並畫淡，上方註明結果已過期；拓撲有驗證錯誤、沒有結果時不顯示這個區塊。
- **多台機器**：能設定 `instances` 的元件（LB、Service、Cache、CDN、Database、Read Replica、Object Storage、Message Queue）在 `instances` > 1 時，節點內容右側畫一個小機櫃：一台一條橫槽、縱向疊放，最多 5 條（超過 5 台仍是 5 條），槽用節點的狀態色；有熱點的 Cache（4.2.2）第一條是最熱的那台、用它自己的狀態色，其他條用其他台的狀態色，滑鼠移到機櫃上列出兩邊的到達率、ρ、延遲、丟棄量（結果過期時先註明）。還沒有結果時是淡灰，結果過期時跟著節點畫淡。右上角用類別色的標籤顯示實際台數（`×2`、`×10`、`×200`，大數字加千分位）。屬性面板的 `instances` 下方顯示 worker 總數，例如「共 2 台 × 180 並行 ＝ 360 個 worker」，有熱點時下一行是「最熱那台分到 50.0%」。
- **叢集內從節點**：Cache 的 `replicas` > 0 時，節點名稱下面一行小字顯示「3 主 3 從」（主 = `instances`，從 = `instances × replicas`）；屬性面板的 worker 提示下一行是「另有 N 個從節點，共 M 個節點；從節點不分擔流量」。
- **Preset**：元件面板的「Redis Cluster」是 `instances = 3`、`replicas = 1` 的 Cache，其他沿用 Cache 的預設值；JSON 裡的 type 是 `CACHE`，沒有新的 type。preset 定義在 `catalog.ts` 的 `PRESETS`，放在它的 type 後面。
- 指標表在有熱點的 Cache 名稱旁標示「熱點」；屬性面板在 Cache 的 `instances` ≥ 2 時，`instances` 下方有「設定熱點」，按下去先填平均的 1.5 倍（`min(1, 1.5/instances)`），之後可以按「沒有熱點」拿掉這個參數。設定了 `hotShare` 時，`instances` 不能減到 1，也不能減到讓 `hotShare` 小於新的平均。
- **頻寬**（4.7）：Client 的邊在 RPS 下面一行小字顯示「出 X・入 Y」；結果面板上方的 summary 列出出口、入口頻寬，有 CDN 擋掉流量時加上 origin 出口和擋掉的比例。單位自動換算（B/s、KB/s、MB/s、GB/s…，十進位，最大到 PB/s，超過時用科學記號，例如 `1.2e18 B/s`），括號裡附上 bits（Mbps、Gbps…，同樣最大到 Pbps）。
- **容量估算**分頁（4.8）：每個 Database、Object Storage 一列：每日增量、總量（附保留天數）、含副本（附 replica 數）、每台、磁碟幾天後會滿。單位自動換算（B、KB、MB、GB、TB、PB，十進位，超過 PB 時用科學記號）。過載的節點名稱旁標示「過載，偏低」；有 Read Replica 複製跟不上時，含副本那一格加註「副本複製跟不上，實際副本量會比這少」。磁碟在保留期內會滿時該格是紅字，summary 也另外列出「磁碟會滿」的節點，和 ρ 的瓶頸分開。屬性面板的 `diskGbPerInstance`（只有 Database）預設不設定，按「設定磁碟容量」才出現（先填 1000 GB），按「不估算」拿掉。Object Storage 那一列只有每日增量和總量，其他欄是「—」；沒有 Database 時不顯示磁碟那一欄。
- **重點數字**：結果面板的分頁下方、內容上方有一排卡片，每個分頁都顯示，數值直接取自 `summary`；有驗證錯誤時不顯示。窄螢幕時自動換行。
  - 成功率：`1 − dropRate`，有丟棄或拒絕時紅字（少到取一位小數會變成 100.0% 時顯示「> 99.9%」），下面一行是成功的 rps。
  - 端到端延遲：read、write 排在同一行；`null` 時顯示「—」，下面一行是原因（和指標表同樣的說明，兩個 class 原因相同時只列一次），近似值加上「近似」。
  - 丟棄：`dropRate × offeredRps`（沒有完整成功的使用者請求數），包含拒絕；有拒絕時下面另外列出 `summary.rejectedRps`。它是各節點拒絕量的總和，fan-out 後算的是子呼叫數，可能比丟棄數還大，所以不寫成「其中」。
  - 瓶頸：ρ 最高的節點狀態是 `WARN` 以上時，顯示節點名稱和 ρ，整張卡片強調顯示（和「發現瓶頸」通知同一個門檻）；低於門檻時大字寫「無瓶頸」，小字寫「最忙：節點名稱 ρ 值」；所有節點的 ρ 都是 0 時只寫「無瓶頸」；沒有可計算 ρ 的節點時顯示「—」。
  - 頻寬、磁碟會滿不在卡片裡，列在分頁旁邊。
  - 卡片和分頁內容在同一個捲動區：面板夠高時只有分頁內容（表格等）自己捲動；面板太矮（最矮 120px）或卡片換成多行時，分頁內容至少保留 160px，整個區域一起捲動，表格和 Sankey 不會被擠到看不見。
- 指標表「丟棄」和「拒絕」分兩欄。
- **流量 Sankey**：沒被送往下游的流量各自流進「丟棄」（紅）和「拒絕」（灰）兩個終點，分開顯示。複製的邊不畫，它不是請求的流向（Message Queue 送給 consumer 的訊息照畫，consumer 處理不完的流進「積壓」終點；處理了但下游失敗的訊息已經流到下游、在下游的「丟棄」裡，不再畫一次）；所以 Read Replica 的流入只有 read，丟棄裡可能含複製寫入。
- **流量粒子動畫**：Run 之後，邊上有小點沿方向流動，速度或密度依該邊 RPS 調整。
- **節點發光**：節點外框依狀態（4.4）顯示綠、黃、橘、紅的光暈；`OVERLOADED` 時脈動。Client 是流量的來源、不是機器，外框畫成虛線、沒有陰影和狀態色。
- **未連線與無流量**（4.4、4.5）：未連線的節點看畫布就判斷，不必等 Run：整個節點約 40% 不透明度、灰色虛線外框，狀態列寫「未連線」，不列 ρ、沒有光暈，選取或滑過時恢復不透明。有連線但沒流量的節點照常顯示，狀態點變灰並寫「無流量」。指標表和容量估算表把未連線的節點移到最後並畫淡，指標表的狀態欄寫「未連線」或「無流量」，容量估算表沒有狀態欄，在名稱旁標「未連線」；有驗證錯誤的未連線節點不畫淡，紅框才看得清楚；Sankey 不畫沒有流量的節點；指標表的「瓶頸」標記和瓶頸卡片用同一個門檻（WARN 以上）。
- **主題**：預設深色，工具列可切換淺色。
- **結果面板高度**：拖動結果面板上緣的分隔線調整高度（分隔線中間有三個點的握把，平常就看得到，滑過或聚焦時換成強調色），或聚焦分隔線後用方向鍵調整（↑ 變高、↓ 變矮，Home／End 到最矮／最高）。最矮 120px，最高為視窗高度的 70%，畫布不會被擠到看不見。高度存在 localStorage，重新整理後保留；Sankey 跟著重新排版。
- **Auto-run**（預設開啟）：拓撲有實質變化時自動 Run，debounce 300ms（連續修改時只在停下 300ms 後送出一次）。
  - 會觸發：新增／刪除節點、新增／刪除邊、修改節點或邊的參數、回到起始拓撲。
  - 不會觸發：拖動節點位置、選取節點、切換主題等只影響畫面的操作（`ui` 欄位不影響計算）。
  - 改節點名稱不影響計算，通常不會觸發；但結果有驗證錯誤時會觸發，因為錯誤訊息用節點名稱指稱節點（第 5 節）。
  - 只套用最新一次 Run 的結果：送出新的 Run、回到起始拓撲時，取消還在進行的請求；被取消的請求不算 Run 失敗。
  - 編輯到一半的拓撲（例如剛拉出還沒連線的 Client）會即時顯示驗證錯誤，這是預期行為。
- **Run 按鈕**保留，用於 Auto-run 關閉時手動計算。
- 驗證錯誤：有問題的節點加紅框，錯誤 Tab 列出清單，點擊可跳到該節點。
- Run 失敗時顯示原因：後端回的錯誤（例如 400）顯示後端的說明；連不到後端（連線失敗，或 proxy 回沒有說明的 502／503）時顯示「連不到後端，請確認後端是否已啟動」。
- Auto-run 關閉時，拓撲在 Run 之後若被修改，結果標示為「已過期」。改名稱只在結果有驗證錯誤時算修改，按 Run 後錯誤訊息換成新名稱。
- **復原／重做**：工具列按鈕或 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z（焦點在輸入框時不攔截，交給輸入框自己的復原）。
  - 算一步：新增／刪除節點、新增／刪除邊、修改參數、改名、移動節點、貼上節點。刪除節點時連帶刪掉的邊和節點算同一步。
  - 不算一步：選取、切換主題。復原時連同當時的選取一起還原。
  - 連續修改併成一步：拖一次節點；同一個欄位的連續修改（打字、拖 slider）只要間隔不到 1 秒都併在一起。
  - 復原後做新的修改，重做紀錄清空。最多記 100 步。
  - 回到起始拓撲整份換掉畫布，不跳確認對話框，而是算一步：通知上有「復原」可以一步回到原本的拓撲（之後又改過畫布時，請用工具列的復原）。
  - 復原／重做是一般的修改，Auto-run 照常觸發。節點和邊的 id 不會重複使用，復原回來的元素不會套上別的元素的結果。復原或重做跨過回到起始拓撲時，兩份拓撲的 id 可能重疊，所以先清掉結果（同回到起始拓撲），再依 Auto-run 重新 Run。
- **複製貼上節點**：選取一個或多個節點後 Ctrl/Cmd+C、Ctrl/Cmd+V（焦點在輸入框時不攔截，維持文字的複製貼上）。
  - 複製當下的參數和位置；之後再改原本的節點不影響要貼上的內容。剪貼簿只在這個分頁裡，不寫入系統剪貼簿。
  - 新節點參數相同，id 取同類型下一個沒用過的編號，名稱接上沒被用掉的編號（「API」→「API 2」）。每貼一次往右下多偏移一點，連續貼上不會疊在一起。
  - 同時複製的節點之間的邊一起複製（參數相同）；連到沒被複製的節點的邊不複製。
  - 貼上後選取新節點；貼上算一步，Auto-run 照常觸發。
- **自動存檔**：畫布（節點、邊、參數、名稱、位置）每次變化都存進瀏覽器的 localStorage，內容是第 5 節的 Request 格式；重新整理或關掉再開時還原，Auto-run 開啟時接著自動 Run。
  - 還原時檢查格式（規則同 5、4.5 的匯入檢查）。存檔壞掉或版本不支援時改用起始拓撲，並通知讀不回來的原因；在使用者修改畫布之前不蓋掉這份存檔（例如被新版本存過的存檔，回到新版本還讀得到）。
  - 瀏覽器不允許存取 localStorage（例如封鎖網站資料）或空間不夠時，其他功能照常，只是不記住畫布。
  - 復原／重做紀錄和 Run 結果不存。同時開兩個分頁時，最後修改的那一個蓋掉另一個的存檔。
  - 工具列的「起始拓撲」回到一開始的畫布，算一步，可以復原。

---

## 7. 驗收標準

- [ ] 能從左側拖出 3.3 的每一種元件，連線、刪除節點和邊
- [ ] 改參數後 Run，節點顏色、邊 RPS、指標表、Sankey 都會更新
- [ ] 把 Client RPS 調高到超過 DB 容量時，DB 變紅，並顯示為瓶頸和丟棄量
- [ ] 調高 Cache hitRatio，DB 負載下降
- [ ] 違反驗證規則時有明確錯誤，並標出問題節點
- [ ] ~~匯出 JSON 再匯入後，畫布與參數完全還原~~（0.6.0 移除匯入／匯出，改為重新整理後自動存檔還原畫布）
- [ ] ~~內建範例「基本 Web App」：Client → LB → Service → Cache → DB~~（0.6.0 移除內建範例）
- [ ] Run 之後邊上有流量粒子動畫，節點依狀態發光，可切換深色／淺色主題
- [ ] `engine` 模組通過第 4.6 節的所有測試案例
- [ ] `api` 模組有一個 `/simulate` 整合測試（用 `scenarios/basic-web-app.json`，檢查回應的 JSON 欄位）

---

## 8. 里程碑

| # | 內容 | 完成時可以展示 |
|---|---|---|
| M0 | 專案骨架：Gradle 多模組、Vite + Tailwind v4 + shadcn/ui + React Flow 能啟動，深色主題，Vite proxy `/api` → Spring | 空畫布、透過 proxy 打到 `/actuator/health` |
| M1 | `engine`：`Simulator` 入口、模型、驗證、Erlang C、穩態計算、成功率與測試 | JUnit 全部通過 |
| M2 | API ＋ commit `openapi.json`（含同步檢查測試）＋ 前端型別產生 ＋ `/simulate` 整合測試 | 用 curl 打 `/simulate` 得到結果 |
| M3 | 畫布：拖拉、連線、屬性面板 | 能組出架構 |
| M4 | 串接：Run、Auto-run、節點變色、指標表、Sankey、錯誤提示 | 完整 demo |
| M5 | 匯入／匯出、內建範例 | 階段一完成 🎉 |

---

## 9. 決策紀錄

| 日期 | 決定 | 理由 |
|---|---|---|
| 2026-11-12 | 建置工具用 **Gradle（Kotlin DSL）** | 多模組設定簡潔、增量建置快、順便學 Gradle |
| 2026-11-12 | 階段一支援 Service **依序與平行呼叫** | 平行呼叫在穩態模型是近似值，前端標示；階段二由 DES 給出正確值 |
| 2026-11-12 | 初始化 git repo（推到 GitHub 之後再決定） | — |
| 2026-11-12 | **先做出階段一，再決定階段二要加什麼** | 實際用過才知道需要什麼；ROADMAP 的階段二／階段三只是方向，不是承諾 |
| 2026-11-12 | Service 呼叫下游時**不占用 worker** | 阻塞模型會讓 ρ 和延遲互相依賴、需要迭代求解，可解釋性變差；階段二 DES 天生能模擬 |
| 2026-11-12 | `successRps` 用**成功機率沿呼叫樹相乘**計算（4.3.1） | fan-out 讓下游 RPS 變成子呼叫，不能直接加總丟棄量；遞迴算法和延遲公式一致、可解釋 |
| 2026-11-12 | 部分路徑過載時，端到端延遲**維持 `null`**，前端顯示原因 | 過載節點的延遲在穩態下沒有定義，不硬塞假設值；成功率另由 `successRps` 呈現 |
| 2026-11-12 | 測試範圍：**engine 單元測試＋一個 `/simulate` API 整合測試** | 計算正確性集中在 engine；前端靠手動驗收，階段二再考慮 Playwright |
| 2026-11-12 | UI 改用 **shadcn/ui + Tailwind v4 + ECharts + Motion**，不用 `@cloudflare/kumo`（Motion 後來沒用，見 `docs/adr/0002-no-animation-library.md`） | 想要華麗又清晰的畫面，需要完全掌控外觀；Kumo 的外觀綁在 Cloudflare 的設計語言 |
| 2026-11-12 | 階段一畫布效果只做**流量粒子、節點發光、深色主題** | 成本低且直接幫助理解瓶頸；數字過場、丟棄動畫等階段二有時間序列時一起做 |
| 2026-11-12 | 多個 Client 時，summary 延遲用**請求數加權平均**，每個 Client 的延遲另外列在 `nodes` | 加權平均代表「隨機一個請求要等多久」；summary 為 `null` 時仍看得到各 Client 的情況 |
| 2026-11-12 | Client 留在 `nodes` 裡，伺服器類欄位為 `null`，不列入瓶頸 | 前端用同一套方式查所有節點；`null` 明確表示「不適用」，不會被誤認為 0 |
| 2026-11-12 | 用不到的邊欄位**忽略**；重複的邊報 `DUPLICATE_EDGE` | 匯出檔一律帶預設值，報錯會讓自己的檔案無法匯入；重複邊幾乎都是操作失誤 |
| 2026-11-12 | `openapi.json` **commit 進 repo** 並有同步檢查；開發時用 **Vite proxy** | 前端不必啟動後端就能產生型別，API 變動看得到 diff；proxy 免去 CORS 設定 |
| 2026-11-12 | 引擎只公開 **`Simulator.simulate(Topology)`** 一個入口 | 計算不會散落到 API 層；測試透過公開介面驗證行為；階段二 DES 是另一個實作 |
| 2026-11-12 | **Auto-run 預設開啟**，節點、邊、參數有變化就自動重算（debounce 300ms），移到 M4 | 改了就看到結果最直覺；穩態計算是毫秒等級，每次重算整份拓撲沒有負擔 |
| 2026-11-13 | 前端加入 **Vitest 單元測試**，只測不需要瀏覽器的純邏輯（匯入檢查、匯出再匯入、內建範例、參數範圍與 slider 換算、顯示格式、連線規則），在 CI 執行（0.2.0，#34） | 匯入檢查規則多，手動驗收容易漏；元件和端到端測試仍不做 |
| 2026-11-18 | 邊的 `latencyMs` 改成**往返**，端到端延遲不再乘 2（0.7.0，#155）；舊存檔不轉換 | 查得到的延遲數字（ping、雲端跨區延遲表）幾乎都是往返，使用者查到多少就填多少；原本的單程要自己除以 2，很容易填錯 |
