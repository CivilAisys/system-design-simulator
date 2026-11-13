# System Design Simulator

在瀏覽器上拖拉元件（Client、Load Balancer、Service、Cache、Database）組出系統架構，調整參數後馬上看到每個節點的負載、延遲、丟棄量和瓶頸。目前是穩態分析（每個節點當成 M/M/c 排隊系統），計算方式見 [`docs/v1-spec.md`](docs/v1-spec.md)。

- `backend/`：Java 21、Spring Boot、Gradle 多模組
  - `engine`：純 Java 的模擬引擎
  - `api`：REST API，`POST /api/v1/simulate`
- `frontend/`：React、Vite、TypeScript、React Flow、shadcn/ui、ECharts

## 需要的工具

| 工具 | 版本 | 說明 |
|---|---|---|
| JDK | 21 | Gradle toolchain 指定 21；Gradle 本身用 wrapper，不必另外安裝 |
| Node.js | 26 | 見 `frontend/.nvmrc`，用 nvm 的話在 `frontend/` 執行 `nvm use` |

## 啟動

開兩個終端機：

```sh
# 後端：http://localhost:8080
cd backend
./gradlew :api:bootRun

# 前端：http://localhost:5173
cd frontend
npm install
npm run dev
```

瀏覽器開 http://localhost:5173。前端怎麼連到後端、API 型別怎麼產生，見 [`frontend/README.md`](frontend/README.md)。

## 測試

CI（`.github/workflows/ci.yml`）在每個 PR 執行下面這些指令（前端在 CI 先跑 `npm ci` 安裝）：

```sh
# 後端：engine 和 api 的測試，包含 openapi.json 的同步檢查
cd backend
./gradlew test

# 前端：lint、Vitest 單元測試、型別檢查和 build
cd frontend
npm run lint
npm test
npm run build
```

同步檢查失敗時的處理見 [`frontend/README.md`](frontend/README.md) 的「API 型別」。

## 文件

| 文件 | 內容 |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | 開發階段與方向 |
| [`docs/v1-spec.md`](docs/v1-spec.md) | 階段一規格：領域模型、計算公式、API、畫面與互動規則、決策紀錄（第 9 節） |
| [`GLOSSARY.md`](GLOSSARY.md) | 領域用語 |
| [`docs/adr/`](docs/adr/) | 架構決策紀錄（新的決策寫在這裡） |
| [`AGENTS.md`](AGENTS.md) | Git 流程、CI、給 agent 的說明 |
| [`frontend/README.md`](frontend/README.md) | 前端開發細節 |
