# System Design Simulator

在畫布上組出系統架構，模擬流量通過各元件的情況，找出瓶頸。v1 只做穩態分析。

## Language

### 架構

**Topology（拓撲）**:
使用者組出的整個架構，由 Node 和 Edge 構成，也是匯入／匯出的單位。
_Avoid_: graph、diagram、架構圖

**Node（節點）**:
拓撲中的一個元件：Client、Load Balancer、Service、Cache 或 Database。
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

**Database（DB）**:
資料儲存，是請求的終點，沒有下游。

### 流量

**Request class（請求類別）**:
請求的種類，v1 只有 read 和 write。
_Avoid_: request type、operation

**Arrival rate（到達率，λ）**:
每秒送進一個 Node 的請求數。
_Avoid_: input rps、load

**Throughput（處理量）**:
一個 Node 每秒實際處理完的請求數，過載時等於容量。

**Dropped（丟棄量）**:
到達但超出容量、沒被處理的請求數。
_Avoid_: lost、rejected、failed

**Fan-out**:
Service 對每個下游各發出 `callsPerRequest` 次呼叫，使下游的流量變成子呼叫，而不是使用者請求。

**Call mode（呼叫模式）**:
Service 呼叫多個下游的方式：依序（SEQUENTIAL）或平行（PARALLEL）。

**Offered rps**:
所有 Client 送出的請求總數。

**Success rps**:
從 Client 送出、最後整條呼叫路徑都成功完成的請求數。

**Drop rate（失敗率）**:
沒有成功完成的請求占 offered rps 的比例。

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
流量長時間固定、各 Node 的平均數字不再變化的狀態；v1 只計算這個狀態。

**Node latency（節點延遲，W）**:
一個請求在單一 Node 的平均停留時間，包含排隊和處理。

**End-to-end latency（端到端延遲）**:
一個請求從 Client 送出到整條呼叫路徑完成的平均時間；路徑上有任何 Node 過載時無定義。
_Avoid_: response time、total latency

**Status（狀態）**:
依使用率分級：OK、WARN、CRITICAL、OVERLOADED。Client 沒有狀態。

**Health（健康狀況）**:
Node 是否正常運作，對應 JSON 的 `state` 欄位。v1 只有 HEALTHY，v2 加入 DOWN、DEGRADED。跟 Status 無關。
_Avoid_: 狀態（留給 Status）

**Bottleneck（瓶頸）**:
使用率最高的 Node。

### 模擬

**Run**:
把目前的拓撲送去計算一次，取得 Simulation result。
_Avoid_: execute、calculate

**Simulator**:
接收一份拓撲、回傳 Simulation result 的模擬引擎。v1 是穩態計算，v2 預計加入動態模擬。
_Avoid_: engine、calculator

**Simulation result**:
一次 Run 的完整結果：驗證錯誤、每個 Node 和 Edge 的數字，以及 summary。
_Avoid_: output、report
