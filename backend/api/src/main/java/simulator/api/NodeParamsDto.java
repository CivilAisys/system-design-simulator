package simulator.api;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.CallMode;

/** 各類型節點的參數放在同一個物件，只填該類型用得到的欄位。 */
@Schema(name = "NodeParams")
public record NodeParamsDto(
        @Schema(description = "CLIENT") Double rps,
        @Schema(description = "CLIENT") Double readRatio,
        @Schema(description = "LOAD_BALANCER, SERVICE, CACHE, DATABASE") Integer instances,
        @Schema(description = "LOAD_BALANCER, SERVICE, CACHE, DATABASE") Integer concurrency,
        @Schema(description = "LOAD_BALANCER, SERVICE, CACHE, DATABASE") Double serviceTimeMs,
        @Schema(description = "SERVICE") CallMode callMode,
        @Schema(description = "CACHE") Double hitRatio) {
}
