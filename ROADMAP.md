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

## 版本規劃

### v1 — 穩態分析 MVP（詳見 [docs/v1-spec.md](docs/v1-spec.md)）
- 畫布：拖拉 5 種元件（Client / Load Balancer / Service / Cache / Database）並連線
- 屬性面板：調整 RPS、讀寫比、instances、concurrency、service time、cache hit ratio
- 穩態計算：每個節點的使用率 ρ、平均延遲、丟棄量；標出瓶頸
- 視覺化：節點依 ρ 變色、邊上顯示 RPS、指標表、Sankey 流量圖
- JSON 匯入／匯出，附 1 個內建範例

### v2 — 動態模擬（DES）
- Discrete-Event Simulation 引擎：時間推進、隨機到達與處理時間
- 指標：p50 / p95 / p99、時間序列（Timeseries 圖），透過 WebSocket 推送
- 故障注入：節點掛掉、降級、延遲變高
- 新元件：Message Queue ＋ Worker（非同步、backlog）
- 韌性行為：timeout、retry（可重現 retry storm）、rate limit

### v3 — 情境與練習
- 情境庫：把 `system-design-kb/04-problems` 的參考架構做成可載入的預設
- 更多元件：CDN、DB read replica、sharding、Rate Limiter
- 挑戰模式：給定流量與 SLO（例如 p99 < 200ms），讓使用者設計出能達標的架構
- 成本估算：各元件的粗估月費

### 之後再說（Ideas）
- 分享連結、雲端存檔
- 流量曲線（尖峰／日夜週期）
- 多區域部署與跨區延遲

---

## 影響 v1 架構的未來需求

v1 不實作以下功能，但設計時不能擋住它們：

| 未來功能 | v1 必須做到的事 |
|---|---|
| DES 動態模擬（v2） | 節點的「參數」與「計算行為」分離；穩態計算只是其中一種 `Simulator` 實作 |
| 故障注入（v2） | 節點 schema 預留 `state` 欄位（v1 只有 `HEALTHY`） |
| 即時推送（v2） | 引擎不依賴 HTTP 請求的生命週期；API 層只是轉接 |
| Queue／非同步（v2） | 流量模型要能區分 request class（v1 先做 read / write） |
| 情境庫、分享（v3） | 拓撲用單一 JSON schema 完整表達，前後端共用（OpenAPI 產生 TS 型別） |
