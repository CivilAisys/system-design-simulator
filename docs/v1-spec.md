# v1 Spec — 穩態分析 MVP

> 狀態：**已確認**（2026-11-12）
> 目標：使用者能在畫布上組出「Client → LB → Service → Cache → DB」這類架構，調整參數後按 Run，馬上看到每個節點的負載、延遲和瓶頸。

---

## 1. 範圍

### 1.1 做什麼
- 5 種元件的拖拉、連線、刪除、參數編輯
- 後端穩態（steady-state）計算：使用率、平均延遲、丟棄量、瓶頸
- 結果視覺化：節點變色、邊上 RPS、指標表、Sankey
- 拓撲驗證與錯誤提示
- JSON 匯入／匯出、1 個內建範例

### 1.2 不做什麼（Non-goals）
- ❌ 時間推進的動態模擬、p99 等百分位數（→ v2 DES）
- ❌ 故障注入、timeout、retry（→ v2）
- ❌ Message Queue、CDN、read replica、sharding（→ v2 / v3）
- ❌ 有環（cycle）的拓撲
- ❌ 帳號、資料庫、雲端存檔、部署上線（v1 只在本機跑）

---

## 2. 技術選型

| 層     | 選擇                                                               |
| ----- | ---------------------------------------------------------------- |
| 後端    | Java 21、Spring Boot 3、JUnit 5、springdoc-openapi                  |
| 建置    | Gradle（Kotlin DSL）多模組、Gradle Wrapper                             |
| 前端    | React + Vite + TypeScript、Tailwind CSS v4                        |
| UI 元件 | `@cloudflare/kumo`（Sidebar、Tabs、Table、Slider、Meter、Toast、Charts） |
| 畫布    | `@xyflow/react`（React Flow）                                      |
| 型別同步  | springdoc 產出 OpenAPI → `openapi-typescript` 產生前端型別               |

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
- 為什麼 v1 就要分：Cache 只對 read 有效，這是系統設計中最核心的取捨之一。

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

> **簡化假設**：多個 instance 視為一個共用佇列（假設前面有完美的負載平衡）。真實情況會比這更差，v2 的 DES 可以模擬不平均的分流。

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

### 3.5 節點狀態（預留）
- `state`：v1 只有 `HEALTHY`。v2 加入 `DOWN`、`DEGRADED`。

---

## 4. 穩態計算

### 4.1 流程
1. **驗證**拓撲（見 4.5），有錯誤就直接回傳錯誤，不計算。
2. **拓撲排序**（Kahn's algorithm）。
3. 依序計算每個節點：
   1. 加總上游送來的 read / write 到達率 `λ`
   2. 計算 ρ、排隊延遲、實際處理量、丟棄量
   3. 依元件行為把**實際處理量**分給下游邊
4. 由下游往上游計算平均端到端延遲。
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

Client 本身沒有 W（記為 0）。路徑上只要有任何節點過載，該 class 的端到端延遲記為 `null`。

> v1 只算**平均值**。p99 不能沿路徑相加，需要分佈或模擬，留到 v2。
>
> ⚠️ **`PARALLEL` 是近似值**：「各下游平均值的最大值」會低估真實延遲（真實的是「每個請求各自取最大值」再平均）。前端要標示「近似」，v2 用 DES 算出正確值。

### 4.4 狀態分級

| ρ | 狀態 | 顏色 |
|---|---|---|
| < 0.7 | `OK` | 綠 |
| 0.7 – 0.9 | `WARN` | 黃 |
| 0.9 – 1.0 | `CRITICAL` | 橘 |
| ≥ 1.0 | `OVERLOADED` | 紅 |

**瓶頸** = ρ 最高的節點。

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
| 參數範圍（rps ≥ 0、0 ≤ ratio ≤ 1、instances ≥ 1、serviceTimeMs > 0…） | `INVALID_PARAM` |

每個錯誤要附上 `nodeId` 或 `edgeId`，前端用來把有問題的節點標出來。

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
    "avgEndToEndMs": { "read": 52.0, "write": 52.0 },
    "bottleneckNodeId": "svc-1"
  }
}
```

驗證失敗時一樣回 200，`valid: false`，`errors` 為錯誤清單。拓撲有問題是使用者的編輯狀態，不是 HTTP 錯誤。

---

## 6. 前端畫面

```
┌────────────────────────────────────────────────────────────────┐
│ System Design Simulator    [▶ Run] [Auto-run ☐] [匯入] [匯出] [範例▾] │
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

| 區塊 | Kumo 元件 |
|---|---|
| 左側元件面板 | Sidebar（拖到畫布） |
| 右側屬性面板 | Input、Slider、Meter（ρ） |
| 下方結果 | Tabs、Table、Sankey、Badge（狀態） |
| 工具列 | Toolbar、Button、Switch、Dropdown |
| 通知 | Toast（例如「發現瓶頸：DB」） |

**互動規則**
- 自訂 React Flow 節點：顯示名稱、類型圖示、ρ 和狀態色；Run 之後才會出現指標。
- 邊上的 label 顯示 RPS，粗細依流量比例。
- **Auto-run** 開啟時，參數改變後 debounce 300ms 自動重算。
- 驗證錯誤：有問題的節點加紅框，錯誤 Tab 列出清單，點擊可跳到該節點。
- 拓撲在 Run 之後若被修改，結果標示為「已過期」。

---

## 7. 驗收標準

- [ ] 能從左側拖出 5 種元件，連線、刪除節點和邊
- [ ] 改參數後 Run，節點顏色、邊 RPS、指標表、Sankey 都會更新
- [ ] 把 Client RPS 調高到超過 DB 容量時，DB 變紅，並顯示為瓶頸和丟棄量
- [ ] 調高 Cache hitRatio，DB 負載下降
- [ ] 違反驗證規則時有明確錯誤，並標出問題節點
- [ ] 匯出 JSON 再匯入後，畫布與參數完全還原
- [ ] 內建範例「基本 Web App」：Client → LB → Service → Cache → DB
- [ ] `engine` 模組通過第 4.6 節的所有測試案例

---

## 8. 里程碑

| # | 內容 | 完成時可以展示 |
|---|---|---|
| M0 | 專案骨架：Gradle 多模組、Vite + Kumo + React Flow 能啟動 | 空畫布、`/actuator/health` |
| M1 | `engine`：模型、驗證、Erlang C、穩態計算與測試 | JUnit 全部通過 |
| M2 | API ＋ OpenAPI ＋ 前端型別產生 | 用 curl 打 `/simulate` 得到結果 |
| M3 | 畫布：拖拉、連線、屬性面板 | 能組出架構 |
| M4 | 串接：Run、節點變色、指標表、Sankey、錯誤提示 | 完整 demo |
| M5 | 匯入／匯出、內建範例、Auto-run | v1 完成 🎉 |

---

## 9. 決策紀錄

| 日期 | 決定 | 理由 |
|---|---|---|
| 2026-11-12 | 建置工具用 **Gradle（Kotlin DSL）** | 多模組設定簡潔、增量建置快、順便學 Gradle |
| 2026-11-12 | v1 支援 Service **依序與平行呼叫** | 平行呼叫在穩態模型是近似值，前端標示；v2 由 DES 給出正確值 |
| 2026-11-12 | 初始化 git repo（推到 GitHub 之後再決定） | — |
| 2026-11-12 | **先做出 v1，再決定 v2 要加什麼** | 實際用過才知道需要什麼；ROADMAP 的 v2／v3 只是方向，不是承諾 |
