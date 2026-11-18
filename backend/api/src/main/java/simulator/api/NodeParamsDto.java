package simulator.api;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.CallMode;

/** 各類型節點的參數放在同一個物件，只填該類型用得到的欄位。 */
@Schema(name = "NodeParams")
public record NodeParamsDto(
        @Schema(description = "CLIENT") Double rps,
        @Schema(description = "CLIENT") Double readRatio,
        @Schema(description = "CLIENT：每個 read 回應的大小（bytes），只用來估算頻寬，省略時為 10000")
        Double readResponseBytes,
        @Schema(description = "CLIENT：每個 write 上傳的大小（bytes），只用來估算頻寬，省略時為 1000")
        Double writeRequestBytes,
        @Schema(description = CAPACITY_TYPES) Integer instances,
        @Schema(description = CAPACITY_TYPES) Integer concurrency,
        @Schema(description = CAPACITY_TYPES) Double serviceTimeMs,
        @Schema(description = "SERVICE") CallMode callMode,
        @Schema(description = "CACHE, CDN") Double hitRatio,
        @Schema(description = "RATE_LIMITER") Double limitRps,
        @Schema(description = "EXTERNAL_API：固定的回應時間") Double latencyMs,
        @Schema(description = "EXTERNAL_API：對方給的配額") Double quotaRps,
        // 不標 defaultValue：產生的前端型別會把有預設值的欄位當成必填，每種 type 的 params 都得帶上它（spec 3.6）
        @Schema(description = "CACHE：最熱的那台分到的流量比例（1/instances ～ 1），省略時所有機器共用一條佇列")
        Double hotShare,
        @Schema(description = "CACHE：每個主有幾個從（0 ～ 5），只是標記、不影響計算，省略時為 0") Integer replicas,
        @Schema(description = "DATABASE, OBJECT_STORAGE：每次 write 平均新增的資料量（bytes），只用來估算儲存量，省略時 DATABASE 為 1000、OBJECT_STORAGE 為 1000000")
        Double bytesPerWrite,
        @Schema(description = "DATABASE, OBJECT_STORAGE：資料保留天數，只用來估算儲存量，省略時為 365")
        Double retentionDays,
        @Schema(description = "DATABASE, OBJECT_STORAGE：每台機器的磁碟容量（GB），省略時不估算磁碟幾天後會滿")
        Double diskGbPerInstance) {

    // 有 M/M/c 處理能力參數的 type
    static final String CAPACITY_TYPES =
            "LOAD_BALANCER, SERVICE, CACHE, CDN, DATABASE, OBJECT_STORAGE, READ_REPLICA, MESSAGE_QUEUE";
}
