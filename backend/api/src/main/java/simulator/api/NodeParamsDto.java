package simulator.api;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.CallMode;

/** 各類型節點的參數放在同一個物件，只填該類型用得到的欄位。 */
@Schema(name = "NodeParams")
public record NodeParamsDto(
        @Schema(description = "CLIENT") Double rps,
        @Schema(description = "CLIENT") Double readRatio,
        @Schema(description = CAPACITY_TYPES) Integer instances,
        @Schema(description = CAPACITY_TYPES) Integer concurrency,
        @Schema(description = CAPACITY_TYPES) Double serviceTimeMs,
        @Schema(description = "SERVICE") CallMode callMode,
        @Schema(description = "CACHE, CDN") Double hitRatio,
        @Schema(description = "RATE_LIMITER") Double limitRps,
        @Schema(description = "EXTERNAL_API：固定的回應時間") Double latencyMs,
        @Schema(description = "EXTERNAL_API：對方給的配額") Double quotaRps,
        // 不標 defaultValue：產生的前端型別會把有預設值的欄位當成必填，每種 type 的 params 都得帶上它（spec 3.6）
        @Schema(description = "CACHE, DATABASE：shard 數，省略時為 1（不分片）") Integer shards,
        @Schema(description = "CACHE, DATABASE：最熱的 shard 分到的流量比例，省略時平均分配（1/shards）")
        Double hotShardShare) {

    // 有 M/M/c 處理能力參數的 type
    static final String CAPACITY_TYPES = "LOAD_BALANCER, SERVICE, CACHE, CDN, DATABASE, OBJECT_STORAGE, READ_REPLICA";
}
