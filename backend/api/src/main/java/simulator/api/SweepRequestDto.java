package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;

/** 負載掃描的請求（spec 4.10）：拓撲和上限倍率。 */
@Schema(name = "SweepRequest")
public record SweepRequestDto(
        @Schema(requiredMode = REQUIRED) TopologyDto topology,
        @Schema(requiredMode = REQUIRED, description = "所有 Client 的 rps 最多放大幾倍，> 0 且 ≤ 10；前端只送 2、5、10", example = "2")
        Double maxMultiplier) {
}
