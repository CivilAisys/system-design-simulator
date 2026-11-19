package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.LoadSweep;
import simulator.engine.TopologyFormatException;

/** 負載掃描的請求（spec 4.10）：拓撲和上限倍率。 */
@Schema(name = "SweepRequest")
public record SweepRequestDto(
        @Schema(requiredMode = REQUIRED) TopologyDto topology,
        @Schema(requiredMode = REQUIRED, description = "所有 Client 的 rps 最多放大幾倍，> 0 且 ≤ 10；前端只送 2、5、10", example = "2")
        Double maxMultiplier) {

    /** 上限倍率，超出範圍時丟 {@link TopologyFormatException}，由 controller 回 400。 */
    double checkedMaxMultiplier() {
        double value = Required.of(maxMultiplier, "maxMultiplier");
        if (!(value > 0 && value <= LoadSweep.MAX_MULTIPLIER)) {
            throw new TopologyFormatException("maxMultiplier must be > 0 and ≤ " + (int) LoadSweep.MAX_MULTIPLIER);
        }
        return value;
    }
}
