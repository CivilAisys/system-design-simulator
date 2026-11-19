package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import simulator.api.SimulationResponse.ValidationErrorDto;
import simulator.engine.BusiestNode;
import simulator.engine.SweepPoint;
import simulator.engine.SweepResult;
import simulator.engine.SweepThreshold;

/** 負載掃描的結果（spec 4.10）。拓撲有驗證錯誤時 {@code valid} 為 false，{@code points} 為空、門檻為 null。 */
@Schema(name = "SweepResult")
public record SweepResponse(
        @Schema(requiredMode = REQUIRED) boolean valid,
        @Schema(requiredMode = REQUIRED) List<ValidationErrorDto> errors,
        @Schema(requiredMode = REQUIRED, description = "目前所有 Client 的 rps 加總（倍率 1）；驗證失敗時為 0") double currentRps,
        @Schema(requiredMode = REQUIRED, description = "依倍率排序：從 0 到上限均分 40 點，加上門檻那幾點；放大後超出參數範圍的點略過")
        List<SweepPointDto> points,
        @Schema(requiredMode = REQUIRED) SweepThresholdsDto thresholds) {

    static SweepResponse from(SweepResult result) {
        return new SweepResponse(result.valid(), result.errors().stream().map(ValidationErrorDto::from).toList(),
                result.currentRps(), result.points().stream().map(SweepPointDto::from).toList(),
                new SweepThresholdsDto(SweepThresholdDto.from(result.warn()), SweepThresholdDto.from(result.overload())));
    }

    @Schema(name = "SweepThresholds")
    public record SweepThresholdsDto(
            @Schema(requiredMode = REQUIRED, nullable = true, description = "第一個節點 ρ 到 0.7 的位置；範圍內沒有到時為 null")
            SweepThresholdDto warn,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "第一個節點過載（ρ 到 1）的位置；範圍內沒有到時為 null")
            SweepThresholdDto overload) {
    }

    @Schema(name = "SweepPoint")
    public record SweepPointDto(
            @Schema(requiredMode = REQUIRED) double multiplier,
            @Schema(requiredMode = REQUIRED) double totalRps,
            @Schema(requiredMode = REQUIRED, description = "所有 Client 依請求數加權的端到端延遲") SweepLatencyDto endToEndMs,
            @Schema(requiredMode = REQUIRED, description = "完整成功的請求 ÷ 送出的請求，0–1；沒有流量時為 1")
            double successRate,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "ρ 最高的節點；沒有候選節點時為 null")
            BusiestNodeDto busiest) {

        static SweepPointDto from(SweepPoint point) {
            return new SweepPointDto(point.multiplier(), point.totalRps(),
                    new SweepLatencyDto(point.readMs(), point.writeMs()), point.successRate(),
                    BusiestNodeDto.from(point.busiest()));
        }
    }

    @Schema(name = "SweepLatency", description = "null：任一 Client 的路徑上有節點過載（沒有定義），或沒有這個 class 的請求")
    public record SweepLatencyDto(
            @Schema(requiredMode = REQUIRED, nullable = true) Double read,
            @Schema(requiredMode = REQUIRED, nullable = true) Double write) {
    }

    @Schema(name = "BusiestNode")
    public record BusiestNodeDto(
            @Schema(requiredMode = REQUIRED) String nodeId,
            @Schema(requiredMode = REQUIRED) double utilization) {

        static BusiestNodeDto from(BusiestNode node) {
            return node == null ? null : new BusiestNodeDto(node.nodeId(), node.utilization());
        }
    }

    @Schema(name = "SweepThreshold")
    public record SweepThresholdDto(
            @Schema(requiredMode = REQUIRED) double multiplier,
            @Schema(requiredMode = REQUIRED) double totalRps,
            @Schema(requiredMode = REQUIRED, description = "第一個到達門檻的節點") String nodeId) {

        static SweepThresholdDto from(SweepThreshold threshold) {
            return threshold == null ? null
                    : new SweepThresholdDto(threshold.multiplier(), threshold.totalRps(), threshold.nodeId());
        }
    }
}
