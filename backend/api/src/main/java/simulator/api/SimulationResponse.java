package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import simulator.engine.ClassLatencies;
import simulator.engine.ClassRates;
import simulator.engine.EdgeResult;
import simulator.engine.EndToEndLatency;
import simulator.engine.NodeResult;
import simulator.engine.SimulationResult;
import simulator.engine.Status;
import simulator.engine.Summary;
import simulator.engine.UndefinedReason;
import simulator.engine.ValidationError;

/**
 * Simulation result 的 JSON 格式。所有欄位都會出現；
 * nullable 欄位為 null 時代表「不適用」或「無定義」，不能當成 0。
 */
@Schema(name = "SimulationResult")
public record SimulationResponse(
        @Schema(requiredMode = REQUIRED) boolean valid,
        @Schema(requiredMode = REQUIRED) List<ValidationErrorDto> errors,
        @Schema(requiredMode = REQUIRED) Map<String, NodeResultDto> nodes,
        @Schema(requiredMode = REQUIRED) Map<String, EdgeResultDto> edges,
        @Schema(requiredMode = REQUIRED) SummaryDto summary) {

    static SimulationResponse from(SimulationResult result) {
        return new SimulationResponse(
                result.valid(),
                result.errors().stream().map(ValidationErrorDto::from).toList(),
                mapValues(result.nodes(), NodeResultDto::from),
                mapValues(result.edges(), EdgeResultDto::from),
                SummaryDto.from(result.summary()));
    }

    private static <A, B> Map<String, B> mapValues(Map<String, A> source, Function<A, B> mapper) {
        Map<String, B> mapped = new LinkedHashMap<>();
        source.forEach((key, value) -> mapped.put(key, mapper.apply(value)));
        return mapped;
    }

    @Schema(name = "ValidationError")
    public record ValidationErrorDto(
            @Schema(requiredMode = REQUIRED) String code,
            @Schema(requiredMode = REQUIRED) String message,
            @Schema(requiredMode = REQUIRED, nullable = true) String nodeId,
            @Schema(requiredMode = REQUIRED, nullable = true) String edgeId) {

        static ValidationErrorDto from(ValidationError error) {
            return new ValidationErrorDto(error.code(), error.message(), error.nodeId(), error.edgeId());
        }
    }

    @Schema(name = "ClassRates")
    public record ClassRatesDto(
            @Schema(requiredMode = REQUIRED) double read,
            @Schema(requiredMode = REQUIRED) double write) {

        static ClassRatesDto from(ClassRates rates) {
            return new ClassRatesDto(rates.read(), rates.write());
        }
    }

    @Schema(name = "ClassLatencies")
    public record ClassLatenciesDto(
            @Schema(requiredMode = REQUIRED) EndToEndLatencyDto read,
            @Schema(requiredMode = REQUIRED) EndToEndLatencyDto write) {

        static ClassLatenciesDto from(ClassLatencies latencies) {
            return latencies == null
                    ? null
                    : new ClassLatenciesDto(EndToEndLatencyDto.from(latencies.read()),
                            EndToEndLatencyDto.from(latencies.write()));
        }
    }

    @Schema(name = "EndToEndLatency", description = "一個 request class 的端到端延遲（spec 4.3）")
    public record EndToEndLatencyDto(
            @Schema(requiredMode = REQUIRED, nullable = true, description = "無定義時為 null，原因見 undefinedReason")
            Double ms,
            @Schema(requiredMode = REQUIRED, description = "路徑上有平行呼叫多個下游，會低估真實延遲；ms 為 null 時一定是 false")
            boolean approximate,
            @Schema(requiredMode = REQUIRED, description = "這個 class 實際會走到、而且過載的節點")
            List<String> overloadedNodeIds,
            @Schema(requiredMode = REQUIRED, nullable = true) UndefinedReason undefinedReason) {

        static EndToEndLatencyDto from(EndToEndLatency latency) {
            return new EndToEndLatencyDto(latency.ms(), latency.approximate(), latency.overloadedNodeIds(),
                    latency.undefinedReason());
        }
    }

    @Schema(name = "NodeResult")
    public record NodeResultDto(
            @Schema(requiredMode = REQUIRED) ClassRatesDto arrivalRps,
            @Schema(requiredMode = REQUIRED) double throughputRps,
            @Schema(requiredMode = REQUIRED) double droppedRps,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "只有 Client 有：這個 Client 的請求每秒有幾個完整成功（spec 4.3.1）")
            Double successRps,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "只有 Client 有")
            ClassLatenciesDto endToEndMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Double capacityRps,
            @Schema(requiredMode = REQUIRED, nullable = true) Double utilization,
            @Schema(requiredMode = REQUIRED, nullable = true) Double avgQueueMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Double avgLatencyMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Status status) {

        static NodeResultDto from(NodeResult node) {
            return new NodeResultDto(ClassRatesDto.from(node.arrivalRps()), node.throughputRps(),
                    node.droppedRps(), node.successRps(), ClassLatenciesDto.from(node.endToEndMs()), node.capacityRps(),
                    node.utilization(), node.avgQueueMs(), node.avgLatencyMs(), node.status());
        }
    }

    @Schema(name = "EdgeResult")
    public record EdgeResultDto(@Schema(requiredMode = REQUIRED) ClassRatesDto rps) {

        static EdgeResultDto from(EdgeResult edge) {
            return new EdgeResultDto(ClassRatesDto.from(edge.rps()));
        }
    }

    @Schema(name = "Summary")
    public record SummaryDto(
            @Schema(requiredMode = REQUIRED) double offeredRps,
            @Schema(requiredMode = REQUIRED, description = "各 Client 完整成功的請求數總和") double successRps,
            @Schema(requiredMode = REQUIRED, description = "1 − successRps / offeredRps，限制在 [0, 1]，浮點誤差造成的極小值歸零；沒有流量時為 0") double dropRate,
            @Schema(requiredMode = REQUIRED) ClassLatenciesDto avgEndToEndMs,
            @Schema(requiredMode = REQUIRED, nullable = true) String bottleneckNodeId) {

        static SummaryDto from(Summary summary) {
            return new SummaryDto(summary.offeredRps(), summary.successRps(), summary.dropRate(),
                    ClassLatenciesDto.from(summary.avgEndToEndMs()), summary.bottleneckNodeId());
        }
    }
}
