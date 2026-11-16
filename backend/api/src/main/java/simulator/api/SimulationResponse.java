package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import simulator.engine.Bandwidth;
import simulator.engine.ClassLatencies;
import simulator.engine.ClassRates;
import simulator.engine.EdgeResult;
import simulator.engine.EndToEndLatency;
import simulator.engine.NodeResult;
import simulator.engine.NodeWarning;
import simulator.engine.ShardResult;
import simulator.engine.SimulationResult;
import simulator.engine.Status;
import simulator.engine.StorageEstimate;
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
        @Schema(requiredMode = REQUIRED, nullable = true, description = "驗證失敗時為 null")
        SummaryDto summary,
        @Schema(requiredMode = REQUIRED, description = "Database、Object Storage 的儲存量估算（spec 4.8），以節點 id 為 key；驗證失敗時為 {}")
        Map<String, StorageEstimateDto> storage) {

    static SimulationResponse from(SimulationResult result) {
        return new SimulationResponse(
                result.valid(),
                result.errors().stream().map(ValidationErrorDto::from).toList(),
                mapValues(result.nodes(), NodeResultDto::from),
                mapValues(result.edges(), EdgeResultDto::from),
                result.summary() == null ? null : SummaryDto.from(result.summary()),
                mapValues(result.storage(), StorageEstimateDto::from));
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
            @Schema(requiredMode = REQUIRED, description = "超過容量、沒被處理的請求數") double droppedRps,
            @Schema(requiredMode = REQUIRED, description = "Rate Limiter 超過 limitRps、External API 超過 quotaRps 拒絕的請求數，其他節點為 0")
            double rejectedRps,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "只有 Client 有：這個 Client 的請求每秒有幾個完整成功（spec 4.3.1）")
            Double successRps,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "只有 Client 有")
            ClassLatenciesDto endToEndMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Double capacityRps,
            @Schema(requiredMode = REQUIRED, nullable = true) Double utilization,
            @Schema(requiredMode = REQUIRED, nullable = true) Double avgQueueMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Double avgLatencyMs,
            @Schema(requiredMode = REQUIRED, nullable = true) Status status,
            @Schema(requiredMode = REQUIRED, nullable = true,
                    description = "只有分片（shards > 1）的節點有：每個 shard 的結果，最熱的放第一個（spec 4.2.2）")
            List<ShardResultDto> shards,
            @Schema(requiredMode = REQUIRED, description = "沒有警告時為空陣列；REPLICATION_LAG：Read Replica 丟掉了複製寫入（spec 4.2.3）；BACKLOG：consumer 處理不完 Message Queue 的訊息（spec 4.2.4）")
            List<NodeWarning> warnings) {

        static NodeResultDto from(NodeResult node) {
            return new NodeResultDto(ClassRatesDto.from(node.arrivalRps()), node.throughputRps(),
                    node.droppedRps(), node.rejectedRps(), node.successRps(), ClassLatenciesDto.from(node.endToEndMs()),
                    node.capacityRps(), node.utilization(), node.avgQueueMs(), node.avgLatencyMs(), node.status(),
                    node.shards() == null ? null : node.shards().stream().map(ShardResultDto::from).toList(),
                    node.warnings());
        }
    }

    @Schema(name = "ShardResult", description = "一個 shard 的結果，欄位意義同 NodeResult")
    public record ShardResultDto(
            @Schema(requiredMode = REQUIRED) ClassRatesDto arrivalRps,
            @Schema(requiredMode = REQUIRED) double throughputRps,
            @Schema(requiredMode = REQUIRED) double droppedRps,
            @Schema(requiredMode = REQUIRED) double utilization,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "過載時為 null") Double avgLatencyMs,
            @Schema(requiredMode = REQUIRED) Status status) {

        static ShardResultDto from(ShardResult shard) {
            return new ShardResultDto(ClassRatesDto.from(shard.arrivalRps()), shard.throughputRps(),
                    shard.droppedRps(), shard.utilization(), shard.avgLatencyMs(), shard.status());
        }
    }

    @Schema(name = "EdgeResult")
    public record EdgeResultDto(
            @Schema(requiredMode = REQUIRED) ClassRatesDto rps,
            @Schema(requiredMode = REQUIRED, description = "Message Queue 的下游邊：consumer 處理不完，queue 每秒增加的訊息數；其他邊為 0")
            double backlogRps,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "只有 Client 的邊有：這條邊的使用者端頻寬（spec 4.7）")
            BandwidthDto bandwidth) {

        static EdgeResultDto from(EdgeResult edge) {
            return new EdgeResultDto(ClassRatesDto.from(edge.rps()), edge.backlogRps(),
                    edge.bandwidth() == null ? null : BandwidthDto.from(edge.bandwidth()));
        }
    }

    @Schema(name = "Bandwidth", description = "使用者端頻寬，單位 bytes/s（spec 4.7）")
    public record BandwidthDto(
            @Schema(requiredMode = REQUIRED, description = "read 回應送給使用者：read rps × readResponseBytes")
            double egressBytesPerSec,
            @Schema(requiredMode = REQUIRED, description = "write 從使用者上傳：write rps × writeRequestBytes")
            double ingressBytesPerSec) {

        static BandwidthDto from(Bandwidth bandwidth) {
            return new BandwidthDto(bandwidth.egressBytesPerSec(), bandwidth.ingressBytesPerSec());
        }
    }

    @Schema(name = "StorageEstimate", description = "一個儲存節點的儲存量估算，單位 bytes（spec 4.8）")
    public record StorageEstimateDto(
            @Schema(requiredMode = REQUIRED, description = "成功處理的 write × bytesPerWrite × 86400") double dailyBytes,
            @Schema(requiredMode = REQUIRED, description = "dailyBytes × retentionDays") double totalBytes,
            @Schema(requiredMode = REQUIRED, description = "連到這個 Database 的 Read Replica 數") int replicas,
            @Schema(requiredMode = REQUIRED, description = "totalBytes × (1 + replicas)") double totalWithReplicasBytes,
            @Schema(requiredMode = REQUIRED, description = "totalBytes ÷ shards（資料平均分布）") double perShardBytes,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "每個 shard 的磁碟幾天後會滿；沒有設定 diskGbPerShard 或沒有寫入時為 null")
            Double daysUntilFull,
            @Schema(requiredMode = REQUIRED, description = "磁碟在保留期內就會滿（daysUntilFull < retentionDays）")
            boolean fillsDisk) {

        static StorageEstimateDto from(StorageEstimate estimate) {
            return new StorageEstimateDto(estimate.dailyBytes(), estimate.totalBytes(), estimate.replicas(),
                    estimate.totalWithReplicasBytes(), estimate.perShardBytes(), estimate.daysUntilFull(),
                    estimate.fillsDisk());
        }
    }

    @Schema(name = "Summary")
    public record SummaryDto(
            @Schema(requiredMode = REQUIRED) double offeredRps,
            @Schema(requiredMode = REQUIRED, description = "各 Client 完整成功的請求數總和") double successRps,
            @Schema(requiredMode = REQUIRED, description = "各節點拒絕量的總和") double rejectedRps,
            @Schema(requiredMode = REQUIRED, description = "1 − successRps / offeredRps（丟棄和拒絕都算），限制在 [0, 1]，浮點誤差造成的極小值歸零；沒有流量時為 0") double dropRate,
            @Schema(requiredMode = REQUIRED) ClassLatenciesDto avgEndToEndMs,
            @Schema(requiredMode = REQUIRED, nullable = true) String bottleneckNodeId,
            @Schema(requiredMode = REQUIRED, description = "各 Client 的使用者端頻寬總和") BandwidthDto bandwidth,
            @Schema(requiredMode = REQUIRED, description = "egressBytesPerSec 裡由 CDN 命中送出、不必從 origin 送出的部分")
            double cdnOffloadBytesPerSec) {

        static SummaryDto from(Summary summary) {
            return new SummaryDto(summary.offeredRps(), summary.successRps(), summary.rejectedRps(), summary.dropRate(),
                    ClassLatenciesDto.from(summary.avgEndToEndMs()), summary.bottleneckNodeId(),
                    BandwidthDto.from(summary.bandwidth()), summary.cdnOffloadBytesPerSec());
        }
    }
}
