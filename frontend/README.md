# Frontend

React + Vite + TypeScript、Tailwind CSS v4、shadcn/ui、`@xyflow/react`。

## 開發

```sh
# 後端（另一個終端機）
cd ../backend && ./gradlew :api:bootRun

# 前端
npm install
npm run dev
```

Vite dev server 把 `/api` 和 `/actuator` proxy 到 `http://localhost:8080`，後端不開 CORS。

## API 型別

`npm run gen:api` 從 `../backend/api/openapi.json` 產生 `src/api/schema.d.ts`（不 commit），`dev` 和 `build` 會先自動執行，不需要先啟動後端。後端 API 變動時，先在後端執行 `./gradlew :api:generateOpenApi` 更新 `openapi.json`。
