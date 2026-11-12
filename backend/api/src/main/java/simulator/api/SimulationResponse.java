package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import simulator.engine.ClassRates;
import simulator.engine.EdgeResult;
import simulator.engine.NodeResult;
import simulator.engine.SimulationResult;
import simulator.engine.Status;
import simulator.engine.Summary;
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

    @Schema(name = "NodeResult")
    public record NodeResultDto(
            @Schema(requiredMode = REQUIRED) ClassRatesDto arrivalRps,
            @Schema(requiredMode = REQUIRED) double throughputRps,
            @Schema(requiredMode = REQUIRED) double droppedRps,
            @Schema(requiredMode = REQUIRED, nullable = true) Double capacityRps,
            @Schema(requiredMode = REQUIRED, nullable = true) Double utilization,
            @Schema(requiredMode = REQUIRED, nullable = true) Double avgQueueMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Double avgLatencyMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Status status) {

        static NodeResultDto from(NodeResult node) {
            return new NodeResultDto(ClassRatesDto.from(node.arrivalRps()), node.throughputRps(),
                    node.droppedRps(), node.capacityRps(), node.utilization(), node.avgQueueMs(),
                    node.avgLatencyMs(), node.status());
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
            @Schema(requiredMode = REQUIRED, nullable = true) String bottleneckNodeId) {

        static SummaryDto from(Summary summary) {
            return new SummaryDto(summary.offeredRps(), summary.bottleneckNodeId());
        }
    }
}
