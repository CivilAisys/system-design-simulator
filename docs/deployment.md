# 部署架構

> 狀態：規劃中。這份文件描述預計的對外部署方式，Dockerfile、建 image 的 workflow 和部署用的 compose 檔都還沒有加進 repo。

目標：用家裡的一台 Windows 主機對外提供服務，在 `main` 打版本 tag 後自動更新，主機不對外開任何 port。

## 整體架構

```
            ┌──────────────── 開發與發布 ────────────────┐
你 ──push / tag──▶ GitHub repo
                   │
                   ▼
            GitHub Actions ──建 image──▶ GHCR（image 倉庫）
            └────────────────────────────────────────────┘
                                               │ 定期檢查有沒有新版
            ┌──────────── Windows 主機（家裡）───┼────────┐
            │  Docker                          │        │
            │   ├─ Watchtower ◀────────────────┘        │
            │   │    （發現新版 → 換掉 app 容器、送通知）  │
            │   ├─ app 容器（Spring Boot + 前端，:8080）  │
            │   └─（以後）Caddy、其他服務                │
            │                                         │
            │  cloudflared（Windows 服務）              │
            │    主動連到 Cloudflare，不開任何 port      │
            └────────────────▲────────────────────────┘
                             │ Tunnel
            ┌────────────────┴──── Cloudflare ─────────┐
            │  網域 DNS、HTTPS 憑證、快取、擋攻擊          │
            └────────────────▲─────────────────────────┘
                             │
                        使用者瀏覽器
                 https://sim.你的網域.com
```

## 兩條流程

**使用者連線**

瀏覽器 → Cloudflare（HTTPS、快取）→ Tunnel → Windows 上的 `cloudflared` → app 容器（頁面和 API 都由它回應）

前台打包進 Spring Boot 的靜態資源，頁面和 `/api` 是同一個網址，後端不用開 CORS，也不需要 nginx。

**發布新版**

1. 照 `AGENTS.md` 的發布流程：`develop` 發 PR 到 `main`，在 `main` 打 `vX.Y.Z` tag。
2. GitHub Actions 建好 image，推到 GHCR，標上版本號和 `latest`。
3. Windows 上的 Watchtower 定期（例如每 5 分鐘）檢查 `latest`，發現新版就換掉容器，並送通知。

## 要申請或設定的東西

| 項目 | 在哪裡 | 做什麼 | 費用 |
|---|---|---|---|
| Cloudflare 帳號＋網域 | Cloudflare | 註冊帳號，在 Registrar 買網域（DNS 會自動設好） | 網域每年約 10 美元起，其餘免費 |
| Cloudflare Tunnel | Cloudflare Zero Trust 後台 | 建一個 tunnel，設定 `sim.你的網域.com` 指到 `localhost:8080` | 免費 |
| GHCR 存取 | GitHub | image 設成 Public（主機不用登入），或發一組只能讀取的 token（`read:packages`） | 免費 |
| 通知管道（選用） | Discord 或 Telegram | 建 webhook 或 bot，讓 Watchtower 送更新通知 | 免費 |
| Windows 主機 | 自己的電腦 | 裝 Docker Desktop 和 cloudflared；關閉睡眠；設定自動登入；調整 Windows Update 的重開機時間 | — |

GitHub Actions 推 image 用內建的 `GITHUB_TOKEN`，不需要另外申請。

## repo 裡要加的東西

1. `Dockerfile`：前台打包進 Spring Boot，做成單一 image。
2. `.dockerignore`：避免本機檔案（`.env`、`.claude` 等）被打包進去。
3. GitHub Actions workflow：收到 `v*` tag 時建 image，推到 GHCR。
4. `deploy/docker-compose.yml`：app 加 Watchtower（含通知設定），並建立共用的 Docker 網路，方便以後加服務。
5. 版號顯示：部署後能確認現在跑的是哪一版。
6. Windows 主機的設定步驟。

## 安全

- 秘密不寫進 Dockerfile 或 image；需要時在主機上用環境變數在執行時傳入。
- Cloudflare Tunnel 的 token 是目前唯一的秘密，只放在主機上；外洩時到 Cloudflare 後台換掉。
- actuator 只對外開 `health`。
- 主機不對外開 port，外人只看得到 Cloudflare 的 IP。
- repo 是 public，不使用 self-hosted GitHub runner：外人的 fork PR 可能讓自己的程式碼跑在主機上。

## 以後要擴充時

| 需求 | 做法 |
|---|---|
| 加其他服務，用不同子網域 | 在 Tunnel 多加一筆網域對應，服務掛在同一個 Docker 網路 |
| 用路徑分流、內網存取、負載平衡 | 加 Caddy 容器當 reverse proxy，Tunnel 改指到 Caddy |
| 打 tag 後立刻部署 | 開 Watchtower 的 HTTP 更新端點，由 Actions 呼叫（要加 token 和存取限制） |
| 不想依賴家裡主機 | 同一個 image 直接搬到 Fly.io 或 VPS |
