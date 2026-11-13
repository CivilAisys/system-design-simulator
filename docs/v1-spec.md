# 階段一 Spec — 穩態分析 MVP

> 狀態：**已確認**（2026-11-12）
> 目標：使用者能在畫布上組出「Client → LB → Service → Cache → DB」這類架構，調整參數後按 Run，馬上看到每個節點的負載、延遲和瓶頸。

---

## 1. 範圍

### 1.1 做什麼
- 5 種元件的拖拉、連線、刪除、參數編輯
- 後端穩態（steady-state）計算：使用率、平均延遲、丟棄量、瓶頸
- 結果視覺化：節點變色、邊上 RPS、指標表、Sankey
- 畫布效果：邊上的流量粒子動畫、節點依 ρ 發光、深色主題（可切換淺色），見第 6 節
- 拓撲驗證與錯誤提示
- JSON 匯入／匯出、1 個內建範例

### 1.2 不做什麼（Non-goals）
- ❌ 時間推進的動態模擬、p99 等百分位數（→ 階段二 DES）
- ❌ 故障注入、timeout、retry（→ 階段二）
- ❌ Message Queue、CDN、read replica、sharding（→ 階段二 / 階段三）
- ❌ 有環（cycle）的拓撲
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
| 前端    | React + Vite + TypeScript、Tailwind CSS v4                        |
| UI 元件 | shadcn/ui（元件原始碼複製進專案，可完全客製）                                  |
| 圖表    | ECharts（Sankey）                                                  |
| 動畫    | Motion                                                           |
| 畫布    | `@xyflow/react`（React Flow），可搭配官方 React Flow UI（shadcn 版）元件          |
| 型別同步  | springdoc 產出 OpenAPI → `openapi-typescript` 產生前端型別               |

**型別同步流程**：Gradle task 產生 `openapi.json` 並 commit 進 repo，前端從這個檔案產生型別，不需要先啟動後端。`api` 模組有一個測試比對「目前程式碼產生的 OpenAPI」和 repo 裡的 `openapi.json`，不一致就失敗，避免忘記重新產生。

**開發連線**：Vite dev server 把 `/api` proxy 到 Spring（`localhost:8080`），瀏覽器只跟同一個 origin 溝通，後端不開 CORS。

### 專案結構

```
system-design-simulator/
├─ ROADMAP.md
├─ docs/
├─ backend/
│  ├─ engine/   純 Java，不依賴 Spring（模型、驗證、穩態計算）
│  └─ api/      Spring Boot（REST controller、DTO ↔ engine model）
└─ frontend/
   └─ src/
      ├─ canvas/     React Flow 畫布、自訂節點
      ├─ panels/     屬性面板、結果面板
      ├─ api/        產生的型別與 API client
      └─ examples/   內建範例 JSON
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
| **Client** | 流量來源 | `rps`、`readRatio` | 依邊的 `weight` 分流 | rps=1000, readRatio=0.9 |
| **Load Balancer** | 分流 | — | 依邊的 `weight` 分流（預設平均） | 1 × 1000, 1ms（≈1M rps） |
| **Service** | 應用伺服器 | `callMode` | **Fan-out**：每個請求呼叫每個下游 `callsPerRequest` 次；`callMode` 決定依序（`SEQUENTIAL`）或平行（`PARALLEL`） | 2 × 200, 50ms（8,000 rps）, callMode=SEQUENTIAL |
| **Cache** | 快取 | `hitRatio` | read：只有 miss（`1 - hitRatio`）往下送；write：全部往下送 | 1 × 1, 0.01ms（≈100k rps，類似單執行緒 Redis）, hitRatio=0.8 |
| **Database** | 資料儲存（終點） | — | 無下游 | 1 × 100, 10ms（10,000 rps） |

> Cache 的 write 直接往下送，等於把 cache-aside 的「寫 DB、刪 cache」簡化成穿透。

### 3.4 邊（Edge）

| 欄位 | 意義 | 預設 |
|---|---|---|
| `source` / `target` | 節點 id | — |
| `weight` | 分流權重（Client、LB 用） | 1 |
| `callsPerRequest` | 每個請求呼叫幾次（Service 用） | 1 |
| `latencyMs` | 網路延遲（單程） | 1 |

- 欄位只在對應的起點有意義：`weight` 只用在 Client／LB 的邊，`callsPerRequest` 只用在 Service 的邊。其他邊上的這些欄位**計算時忽略**（匯出的檔案一律帶著預設值，所以不報錯），屬性面板也只顯示對該起點有意義的欄位。
- 同一對 source → target 只能有一條邊（見 4.5 `DUPLICATE_EDGE`），畫布也會阻止拉出重複的連線。

### 3.5 節點健康狀況（預留）
- `state`（Health）：階段一只有 `HEALTHY`。階段二加入 `DOWN`、`DEGRADED`。

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

### 4.3 端到端平均延遲

設 `L(n, class)` 為一個 class 的請求從節點 n 開始到完成的平均延遲：

| 元件 | `L(n)` |
|---|---|
| Database | `W(n)` |
| Load Balancer／Client | `W(n) + Σ (weight_i / Σweight) × (edge_i.latencyMs×2 + L(child_i))` |
| Service（`SEQUENTIAL`） | `W(n) + Σ callsPerRequest_i × (edge_i.latencyMs×2 + L(child_i))`（依序呼叫，所以相加） |
| Service（`PARALLEL`） | `W(n) + max_i [ callsPerRequest_i × (edge_i.latencyMs×2 + L(child_i)) ]`（各下游同時呼叫，取最慢的；同一個下游呼叫多次時仍依序） |
| Cache（read） | `W(n) + (1 − hitRatio) × (edge.latencyMs×2 + L(child))` |
| Cache（write） | `W(n) + edge.latencyMs×2 + L(child)` |

Client 本身沒有 W（記為 0）。

**「路徑」只算這個 class 實際會走到的下游**：一個請求平均往某條邊送的次數為 0 時（目前只有 Cache read 的 `1 − hitRatio`，weight 和 `callsPerRequest` 都不能為 0），那個下游不在這個 class 的路徑上，公式裡也略過它（避免 `0 × null`）。例如 `hitRatio = 1` 時 read 不會到 DB，DB 被 write 壓到過載只讓 write 變成 `null`。

端到端延遲在下列情況記為 `null`，回應的 `undefinedReason` 說明原因：

| `undefinedReason` | 情況 |
|---|---|
| `OVERLOADED` | 路徑上有節點過載，系統不在穩態。`overloadedNodeIds` 列出這些節點 |
| `NO_TRAFFIC` | 沒有這個 class 的請求，沒有平均可言 |

Client 或 LB 沒有下游時請求沒有地方送，這種拓撲會被驗證規則 `NO_DOWNSTREAM`（4.5）擋下，不會進到計算。前端要在 `null` 旁邊顯示原因（例如「DB 過載，穩態延遲無定義」），並搭配 `successRps`（4.3.1）讓使用者看到還有多少請求成功。原因和過載節點由後端判斷，前端只負責顯示。

**多個 Client**：每個 Client 各自的端到端延遲 `L(client, class)` 放在回應 `nodes` 中該 Client 的 `endToEndMs`。`summary.avgEndToEndMs` 用各 Client 該 class 的請求數加權平均：

```
avgEndToEndMs[class] = Σ_client (client.rps × classRatio × L(client, class)) / Σ_client (client.rps × classRatio)
```

其中 `classRatio` 是 read 的 `readRatio` 或 write 的 `1 − readRatio`。沒有該 class 請求的 Client 權重為 0，不參與平均；其餘任一 Client 的該 class 為 `null` 時，summary 的該 class 也是 `null`（`overloadedNodeIds` 為各 Client 的聯集）；分母為 0（沒有該 class 的流量）時記為 `null`、原因 `NO_TRAFFIC`。只有一個 Client 時，結果就等於該 Client 的延遲。

> 階段一只算**平均值**。p99 不能沿路徑相加，需要分佈或模擬，留到階段二。
>
> ⚠️ **`PARALLEL` 是近似值**：「各下游平均值的最大值」會低估真實延遲（真實的是「每個請求各自取最大值」再平均）。回應以 `approximate: true` 標示，前端顯示「近似」；路徑上的 `PARALLEL` Service 只呼叫一個下游時取最大值就是它本身，不算近似；`ms` 為 `null` 時 `approximate` 一定是 `false`。summary 只要有一個參與平均的 Client 是近似，就是近似。階段二用 DES 算出正確值。

### 4.3.1 成功率

Service 有 fan-out 時，下游的 RPS 是「子呼叫」而不是「使用者請求」，所以不能直接用丟棄量加總算成功數。改用成功機率沿呼叫樹由下往上乘：

- 每個節點的通過率 `pass(n) = 實際處理量 / 到達量`（未過載時為 1）
- 設 `S(n, class)` 為一個 class 的請求從節點 n 開始、最後完整成功的機率

| 元件 | `S(n)` |
|---|---|
| Database | `pass(n)` |
| Load Balancer／Client | `pass(n) × Σ (weight_i / Σweight) × S(child_i)` |
| Service（依序或平行都一樣） | `pass(n) × Π S(child_i)^callsPerRequest_i`（任何一個子呼叫失敗，整個請求就失敗） |
| Cache（read） | `pass(n) × (hitRatio + (1 − hitRatio) × S(child))` |
| Cache（write） | `pass(n) × S(child)` |

Client 的 `pass` 記為 1。彙總：
- `successRps = Σ_client Σ_class client 的該 class rps × S(client, class)`
- `dropRate = 1 − successRps / offeredRps`，限制在 [0, 1]，浮點誤差造成的極小值（|x| < 1e-9）歸零；`offeredRps = 0` 時沒有東西被丟，記為 0

> **簡化假設**：各節點的丟棄彼此獨立。

### 4.4 狀態分級

| ρ | 狀態 | 顏色 |
|---|---|---|
| < 0.7 | `OK` | 綠 |
| 0.7 – 0.9 | `WARN` | 黃 |
| 0.9 – 1.0 | `CRITICAL` | 橘 |
| ≥ 1.0 | `OVERLOADED` | 紅 |

**瓶頸** = ρ 最高的節點。Client 不處理請求，ρ 為 `null`，不列入瓶頸候選。

### 4.5 驗證規則

| 規則 | 錯誤碼 |
|---|---|
| 至少一個 Client | `NO_CLIENT` |
| 不能有環 | `CYCLE_DETECTED` |
| Client 不能有上游 | `CLIENT_HAS_INPUT` |
| Database 不能有下游 | `DATABASE_HAS_OUTPUT` |
| Cache 必須剛好一個下游 | `CACHE_DOWNSTREAM_COUNT` |
| Client／LB 至少一個下游（Service 可以是終點，代表不依賴其他元件的服務） | `NO_DOWNSTREAM` |
| 邊的 source / target 必須存在 | `UNKNOWN_NODE` |
| 同一對 source → target 只能有一條邊 | `DUPLICATE_EDGE` |
| 參數範圍（rps ≥ 0、0 ≤ ratio ≤ 1、instances ≥ 1、serviceTimeMs > 0…） | `INVALID_PARAM` |

每個錯誤要附上 `nodeId` 或 `edgeId`，前端用來把有問題的節點標出來：

- `NO_CLIENT` 兩個都是 `null`（沒有可以指的節點）。
- `CYCLE_DETECTED` 在環上的每個節點各一個錯誤；環下游、夾在兩個環中間的節點不算。
- `CLIENT_HAS_INPUT`、`DATABASE_HAS_OUTPUT`、`CACHE_DOWNSTREAM_COUNT`、`NO_DOWNSTREAM` 附 `nodeId`。
- `UNKNOWN_NODE`、`DUPLICATE_EDGE`（第二條以後的邊）附 `edgeId`。連到不存在節點的邊不參與其他規則，但仍算在另一端的上下游數量裡（畫布上看得到這條邊，不重複報錯）。
- `INVALID_PARAM`：節點參數附 `nodeId`、邊的參數附 `edgeId`。Client／LB 出邊的 `weight` 必須 > 0：weight 為 0 的下游收不到流量，等於沒有接，要停用就刪掉連線。每條都合法但總和溢位成無限大時無法計算比例，附該節點的 `nodeId`。

錯誤依 `NO_CLIENT`、各節點、各邊排列，節點和邊依輸入順序。`message` 是給使用者看的中文說明，用節點名稱指稱節點。

節點或邊的 `id` 重複、缺少必填欄位是**格式錯誤**，錯誤沒辦法指到哪一個節點，回 HTTP 400。

### 4.6 驗算用的測試案例

| 情境 | 輸入 | 預期 |
|---|---|---|
| M/M/1 | c=1, μ=100, λ=80 | ρ=0.8, Wq=40ms, W=50ms |
| M/M/2 | c=2, μ=100, λ=150 | ρ=0.75, P_wait=0.6429, Wq≈12.86ms, W≈22.86ms |
| 過載 | c=1, μ=100, λ=150 | 處理量 100、丟棄 50、W=null |
| Cache 分流 | λ_read=900, λ_write=100, hit=0.8 | 下游 read=180、write=100 |
| 大 c 不溢位 | c=400, ρ=0.9 | 結果有限且合理 |
| 依序呼叫 | Service W=50ms，兩個下游 L=10ms、30ms，邊 latency=1ms | L = 50 + 12 + 32 = 94ms |
| 平行呼叫 | 同上，`callMode=PARALLEL` | L = 50 + max(12, 32) = 82ms |
| Fan-out 成功率 | Client 1000 rps → Service（pass=1）→ DB-A（pass=0.9，callsPerRequest=2）、DB-B（pass=1） | S = 0.9² × 1 = 0.81，successRps=810，dropRate=0.19 |

---

## 5. API

### `POST /api/v1/simulate`

**Request**（也是匯入／匯出的檔案格式）

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

`ui` 只給前端用，後端忽略但不刪除，所以匯出的檔案能還原畫布位置。

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
      "successRps": 1000,
      "endToEndMs": {
        "read":  { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null },
        "write": { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null }
      },
      "capacityRps": null,
      "utilization": null,
      "avgQueueMs": null,
      "avgLatencyMs": null,
      "status": null
    },
    "svc-1": {
      "arrivalRps": { "read": 900, "write": 100 },
      "throughputRps": 1000,
      "droppedRps": 0,
      "capacityRps": 8000,
      "utilization": 0.125,
      "avgQueueMs": 0.0,
      "avgLatencyMs": 50.0,
      "status": "OK"
    }
  },
  "edges": {
    "e1": { "rps": { "read": 900, "write": 100 } }
  },
  "summary": {
    "offeredRps": 1000,
    "successRps": 1000,
    "dropRate": 0.0,
    "avgEndToEndMs": {
      "read":  { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null },
      "write": { "ms": 52.0, "approximate": false, "overloadedNodeIds": [], "undefinedReason": null }
    },
    "bottleneckNodeId": "svc-1"
  }
}
```

驗證失敗時一樣回 200，`valid: false`，`errors` 為錯誤清單，不做任何計算：`nodes`、`edges` 為 `{}`，`summary` 為 `null`。拓撲有問題是使用者的編輯狀態，不是 HTTP 錯誤。

**Client 節點**：`arrivalRps` 是它送出的流量；`successRps` 和 `endToEndMs` 只有 Client 才有，代表這個 Client 的請求有多少成功、平均要等多久。其餘描述伺服器的欄位（容量、使用率、排隊、延遲、狀態）都是 `null`；非 Client 節點的 `endToEndMs` 也是 `null`。

**`null` 和 `0` 的語意不同**：

- `0` 表示「這個量存在，數值剛好是零」，例如沒有流量的 Service `utilization: 0`、Client `droppedRps: 0`。
- `null` 有兩種意思：**不適用**（Client 的 `utilization`、`status` 等）和**無定義**（過載時的延遲，見 4.2、4.3）。
- 前端把 `null` 顯示為「—」，不能當成 0。「無定義」的情況要附上原因；`status: null` 的節點不變色、不發光。
- 流量類欄位（`arrivalRps`、`throughputRps`、`droppedRps`）永遠是數字，不會是 `null`。`successRps` 只有 Client 有：Client 一律是數字，其他節點是 `null`（不適用，fan-out 後下游的子呼叫數不是使用者請求數）。

---

## 6. 前端畫面

```
┌────────────────────────────────────────────────────────────────┐
│ System Design Simulator    [▶ Run] [Auto-run ☑] [匯入] [匯出] [範例▾] │
├──────────┬─────────────────────────────────────┬───────────────┤
│ 元件      │                                     │ 屬性           │
│ ▢ Client │      ┌──────┐     ┌────┐             │ API Server    │
│ ▢ LB     │      │Users │────▶│ LB │──┐          │ instances  [2]│
│ ▢ Service│      └──────┘     └────┘  ▼          │ concurrency   │
│ ▢ Cache  │                      ┌─────────┐     │ ━━━━●━━ 200   │
│ ▢ DB     │                      │API  ρ=.8│(黃) │ serviceTime   │
│          │                      └─────────┘     │ ━━●━━━━ 50ms  │
│          │          （React Flow 畫布）           │ ρ ████░ 0.80  │
├──────────┴─────────────────────────────────────┴───────────────┤
│ [指標表] [流量 Sankey] [錯誤 (0)]                                    │
│ 節點    λ      容量    ρ     延遲    丟棄   狀態                        │
└────────────────────────────────────────────────────────────────┘
```

| 區塊 | 元件 |
|---|---|
| 左側元件面板 | shadcn Sidebar（拖到畫布） |
| 右側屬性面板 | shadcn Input、Slider、Progress（ρ） |
| 下方結果 | shadcn Tabs、Table、Badge（狀態）；ECharts Sankey |
| 工具列 | shadcn Button、Switch、DropdownMenu |
| 通知 | shadcn Sonner（例如「發現瓶頸：DB」） |

**互動規則**
- 自訂 React Flow 節點：顯示名稱、類型圖示、ρ 和狀態色；Run 之後才會出現指標。
- 邊上的 label 顯示 RPS，粗細依流量比例。
- **流量粒子動畫**：Run 之後，邊上有小點沿方向流動，速度或密度依該邊 RPS 調整。
- **節點發光**：節點外框依狀態（4.4）顯示綠、黃、橘、紅的光暈；`OVERLOADED` 時脈動。
- **主題**：預設深色，工具列可切換淺色。
- **Auto-run**（預設開啟）：拓撲有實質變化時自動 Run，debounce 300ms（連續修改時只在停下 300ms 後送出一次）。
  - 會觸發：新增／刪除節點、新增／刪除邊、修改節點或邊的參數、匯入或載入範例。
  - 不會觸發：拖動節點位置、選取節點、切換主題等只影響畫面的操作（`ui` 欄位不影響計算）。
  - 改節點名稱不影響計算，通常不會觸發；但結果有驗證錯誤時會觸發，因為錯誤訊息用節點名稱指稱節點（第 5 節）。
  - 只套用最新一次 Run 的結果，較早送出但較晚回來的回應直接丟棄。
  - 編輯到一半的拓撲（例如剛拉出還沒連線的 Client）會即時顯示驗證錯誤，這是預期行為。
- **Run 按鈕**保留，用於 Auto-run 關閉時手動計算。
- 驗證錯誤：有問題的節點加紅框，錯誤 Tab 列出清單，點擊可跳到該節點。
- Auto-run 關閉時，拓撲在 Run 之後若被修改，結果標示為「已過期」。改名稱只在結果有驗證錯誤時算修改，按 Run 後錯誤訊息換成新名稱。

---

## 7. 驗收標準

- [ ] 能從左側拖出 5 種元件，連線、刪除節點和邊
- [ ] 改參數後 Run，節點顏色、邊 RPS、指標表、Sankey 都會更新
- [ ] 把 Client RPS 調高到超過 DB 容量時，DB 變紅，並顯示為瓶頸和丟棄量
- [ ] 調高 Cache hitRatio，DB 負載下降
- [ ] 違反驗證規則時有明確錯誤，並標出問題節點
- [ ] 匯出 JSON 再匯入後，畫布與參數完全還原
- [ ] 內建範例「基本 Web App」：Client → LB → Service → Cache → DB
- [ ] Run 之後邊上有流量粒子動畫，節點依狀態發光，可切換深色／淺色主題
- [ ] `engine` 模組通過第 4.6 節的所有測試案例
- [ ] `api` 模組有一個 `/simulate` 整合測試（用內建範例拓撲，檢查回應的 JSON 欄位）

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
| 2026-11-12 | UI 改用 **shadcn/ui + Tailwind v4 + ECharts + Motion**，不用 `@cloudflare/kumo` | 想要華麗又清晰的畫面，需要完全掌控外觀；Kumo 的外觀綁在 Cloudflare 的設計語言 |
| 2026-11-12 | 階段一畫布效果只做**流量粒子、節點發光、深色主題** | 成本低且直接幫助理解瓶頸；數字過場、丟棄動畫等階段二有時間序列時一起做 |
| 2026-11-12 | 多個 Client 時，summary 延遲用**請求數加權平均**，每個 Client 的延遲另外列在 `nodes` | 加權平均代表「隨機一個請求要等多久」；summary 為 `null` 時仍看得到各 Client 的情況 |
| 2026-11-12 | Client 留在 `nodes` 裡，伺服器類欄位為 `null`，不列入瓶頸 | 前端用同一套方式查所有節點；`null` 明確表示「不適用」，不會被誤認為 0 |
| 2026-11-12 | 用不到的邊欄位**忽略**；重複的邊報 `DUPLICATE_EDGE` | 匯出檔一律帶預設值，報錯會讓自己的檔案無法匯入；重複邊幾乎都是操作失誤 |
| 2026-11-12 | `openapi.json` **commit 進 repo** 並有同步檢查；開發時用 **Vite proxy** | 前端不必啟動後端就能產生型別，API 變動看得到 diff；proxy 免去 CORS 設定 |
| 2026-11-12 | 引擎只公開 **`Simulator.simulate(Topology)`** 一個入口 | 計算不會散落到 API 層；測試透過公開介面驗證行為；階段二 DES 是另一個實作 |
| 2026-11-12 | **Auto-run 預設開啟**，節點、邊、參數有變化就自動重算（debounce 300ms），移到 M4 | 改了就看到結果最直覺；穩態計算是毫秒等級，每次重算整份拓撲沒有負擔 |
| 2026-11-13 | 前端加入 **Vitest 單元測試**，只測不需要瀏覽器的純邏輯（匯入檢查、匯出再匯入、內建範例、參數範圍與 slider 換算、顯示格式），在 CI 執行（0.2.0，#34） | 匯入檢查規則多，手動驗收容易漏；元件和端到端測試仍不做 |
