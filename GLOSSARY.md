# System Design Simulator

在畫布上組出系統架構，模擬流量通過各元件的情況，找出瓶頸。階段一只做穩態分析。

## Language

### 架構

**Topology（拓撲）**:
使用者組出的整個架構，由 Node 和 Edge 構成，也是自動存檔的單位。
_Avoid_: graph、diagram、架構圖

**Node（節點）**:
拓撲中的一個元件：Client、Load Balancer、Service、Cache、CDN、Database、Object Storage、Read Replica、Rate Limiter、External API 或 Message Queue。
_Avoid_: component、box

**Edge（邊）**:
兩個 Node 之間有方向的連線，代表請求從 source 送往 target。
_Avoid_: link、connection

**Client**:
流量的來源，代表一群使用者，本身不處理請求。
_Avoid_: user、traffic generator

**Load Balancer（LB）**:
依 Edge 的權重把請求分給下游的 Node。

**Service**:
處理請求的應用伺服器，每個請求會呼叫它的每個下游。
_Avoid_: server、app、backend

**Cache**:
擋在下游前面的快取，read 命中時不往下送，write 一律往下送。

**CDN**:
放在 Client 和後端（origin）之間的快取，行為和 Cache 相同，只有預設值和名稱不同。

**Read Replica**:
primary Database 的唯讀副本：分擔 read，但要套用 primary 的所有寫入，所以無法擴展寫入。
_Avoid_: slave、secondary

**Replication（複製）**:
primary 把處理完的寫入非同步地套用到 Read Replica。不算進 Client 的延遲和成功率；replica 跟不上時 replication lag 會持續增加。

**Message Queue（MQ）**:
非同步的佇列：Client 的請求進到 queue（ack）就算成功，下游的 consumer 之後再處理。能削峰、降低使用者延遲，但下游的總負載不變。
_Avoid_: broker（broker 是 MQ 本身那台機器）

**Consumer group**:
Message Queue 的一條下游邊。每個 group 都收到全部訊息，group 內的 consumer 數量用下游節點的 instances 表示。

**Backlog（積壓）**:
沒有處理成功、留在 queue 裡的訊息：consumer 處理不完的，加上 consumer 處理了但下游失敗的。穩態下用「每秒增加幾筆」表示，不算丟棄。
_Avoid_: lag（lag 留給 replication）

**Rate Limiter**:
限制每秒放行的請求數（全域上限，不分 Client），超過的部分拒絕，不往下送。

**External API**:
第三方服務（金流、簡訊、地圖 API 等），固定延遲、不排隊，超過對方配額（quota）的請求被拒絕。
_Avoid_: third-party service、外部服務

**Database（DB）**:
資料儲存，是請求的終點，沒有下游。

**Object Storage**:
存放圖片、影片等大型檔案的儲存服務（例如 S3），行為和 Database 相同，只有預設值和名稱不同。
_Avoid_: blob storage、S3（具體產品名）

**Shard（分片）**:
依 key 切出來的一份資料。模型裡沒有分片參數：`instances` 是處理流量的節點數，資料怎麼切照圖補充說明（spec 4.2.2）。Redis Cluster 一個主節點就是一個 shard。
_Avoid_: partition、分區

**Redis Cluster**:
元件面板上的 preset，就是 instances = 3 的 Cache，JSON 裡 type 仍是 CACHE。

**Hot spot（熱點）**:
Cache 的 `hotShare`：最熱的那台分到較多流量，它的 ρ 決定整個節點的 ρ 和狀態。熱門 key 是原因，最熱的那台是結果。
_Avoid_: hot shard（模型裡沒有 shard）

### 流量

**Request class（請求類別）**:
請求的種類，階段一只有 read 和 write。
_Avoid_: request type、operation

**Arrival rate（到達率，λ）**:
每秒送進一個 Node 的請求數。
_Avoid_: input rps、load

**Throughput（處理量）**:
一個 Node 每秒實際處理完的請求數，過載時等於容量。

**Dropped（丟棄量）**:
到達但超出容量、沒被處理的請求數。Rate Limiter、External API 擋下的是拒絕量，不是丟棄量。
_Avoid_: lost、failed

**Rejected（拒絕量）**:
Rate Limiter 超過上限、或 External API 超過配額而擋下的請求數（相當於 HTTP 429）。和丟棄量是不同的指標，但兩者都算進丟棄率。
_Avoid_: dropped、throttled

**Fan-out**:
Service 對每個下游各發出 `callsPerRequest` 次呼叫，使下游的流量變成子呼叫，而不是使用者請求。

**Call mode（呼叫模式）**:
Service 呼叫多個下游的方式：依序（SEQUENTIAL）或平行（PARALLEL）。

**requestClass（邊的請求類別）**:
Service 的邊只給哪個 Request class 走：ALL、READ 或 WRITE。用來把 read 和 write 送到不同的下游。

**Offered rps**:
所有 Client 送出的請求總數。

**Success rps**:
從 Client 送出、最後整條呼叫路徑都成功完成的請求數。

**Drop rate（失敗率）**:
沒有成功完成的請求占 offered rps 的比例。

**Bandwidth（使用者端頻寬）**:
Client 和系統之間每秒傳輸的資料量。出口是 read 回應送給使用者（read rps × 回應大小），入口是 write 從使用者上傳（write rps × 上傳大小）。內部呼叫的流量不估算。
_Avoid_: throughput（那是請求數）

**Origin offload（CDN 擋掉的 origin 頻寬）**:
出口頻寬裡由 CDN 命中直接送出、不必從後端（origin）送出的部分。

**Storage estimate（儲存量估算）**:
Database、Object Storage 依成功處理的 write、每次 write 新增的資料量和保留天數，推算的每日增量、總量、含副本總量和每個 shard 的用量。

**Disk full（磁碟會滿）**:
保留期內每個 shard 的資料會超過磁碟容量。和 ρ 的瓶頸是不同的指標，分開顯示。
_Avoid_: bottleneck（那是 ρ 最高的節點）

### 負載與延遲

**Worker**:
同時處理一個請求的單位，總數 = instances × concurrency。
_Avoid_: thread、slot

**Capacity（容量）**:
一個 Node 每秒最多能處理的請求數。

**Utilization（使用率，ρ）**:
到達率除以容量，代表 Node 有多忙；1 以上就是過載。
_Avoid_: load、usage、CPU

**Overloaded（過載）**:
到達率達到或超過容量的狀態，超出的部分被丟棄，延遲無定義。

**Steady state（穩態）**:
流量長時間固定、各 Node 的平均數字不再變化的狀態；階段一只計算這個狀態。

**Node latency（節點延遲，W）**:
一個請求在單一 Node 的平均停留時間，包含排隊和處理。

**End-to-end latency（端到端延遲）**:
一個請求從 Client 送出到整條呼叫路徑完成的平均時間；路徑上有任何 Node 過載時無定義。
_Avoid_: response time、total latency

**Status（狀態）**:
依使用率分級：OK、WARN、CRITICAL、OVERLOADED。Client 沒有狀態。

**Health（健康狀況）**:
Node 是否正常運作，對應 JSON 的 `state` 欄位。階段一只有 HEALTHY，階段二加入 DOWN、DEGRADED。跟 Status 無關。
_Avoid_: 狀態（留給 Status）

**Bottleneck（瓶頸）**:
使用率最高的 Node。

### 模擬

**Run**:
把目前的拓撲送去計算一次，取得 Simulation result。
_Avoid_: execute、calculate

**Simulator**:
接收一份拓撲、回傳 Simulation result 的模擬引擎。階段一是穩態計算，階段二預計加入動態模擬。
_Avoid_: engine、calculator

**Simulation result**:
一次 Run 的完整結果：驗證錯誤、每個 Node 和 Edge 的數字，以及 summary。
_Avoid_: output、report

**Validation error（驗證錯誤）**:
拓撲違反 spec 4.5 的規則，例如有環、參數超出範圍。可以指到某個 Node 或 Edge，放在 Simulation result 裡回傳，不是 HTTP 錯誤。

**Format error（格式錯誤）**:
送來的 JSON 不是合法的拓撲格式，例如缺必填欄位、id 重複、欄位型別不對、版本不支援。指不到某個 Node 或 Edge，API 回 HTTP 400。
_Avoid_: 用「驗證錯誤」稱呼它
