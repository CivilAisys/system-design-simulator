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
import simulator.engine.ExplanationStep;
import simulator.engine.ExplanationTerm;
import simulator.engine.ExplanationView;
import simulator.engine.HotSpot;
import simulator.engine.InstanceResult;
import simulator.engine.NodeResult;
import simulator.engine.NodeWarning;
import simulator.engine.RequestClass;
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
                nodes(result),
                mapValues(result.edges(), EdgeResultDto::from),
                result.summary() == null ? null : SummaryDto.from(result.summary()),
                mapValues(result.storage(), StorageEstimateDto::from));
    }

    private static Map<String, NodeResultDto> nodes(SimulationResult result) {
        Map<String, NodeResultDto> mapped = new LinkedHashMap<>();
        result.nodes().forEach((id, node) -> mapped.put(id, NodeResultDto.from(node, result.explanations().get(id))));
        return mapped;
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
                    description = "只有設定了 hotShare 的 Cache 有：最熱的那台和其他台的結果（spec 4.2.2）")
            HotSpotDto hotSpot,
            @Schema(requiredMode = REQUIRED, description = "沒有警告時為空陣列；REPLICATION_LAG：Read Replica 丟掉了複製寫入（spec 4.2.3）；BACKLOG：consumer 處理不完 Message Queue 的訊息（spec 4.2.4）")
            List<NodeWarning> warnings,
            @Schema(requiredMode = REQUIRED, description = "計算步驟（spec 4.9），依計算順序；未連線的節點為空陣列")
            List<ExplanationStepDto> explanation) {

        static NodeResultDto from(NodeResult node, List<ExplanationStep> explanation) {
            return new NodeResultDto(ClassRatesDto.from(node.arrivalRps()), node.throughputRps(),
                    node.droppedRps(), node.rejectedRps(), node.successRps(), ClassLatenciesDto.from(node.endToEndMs()),
                    node.capacityRps(), node.utilization(), node.avgQueueMs(), node.avgLatencyMs(), node.status(),
                    HotSpotDto.from(node.hotSpot()),
                    node.warnings(), explanation.stream().map(ExplanationStepDto::from).toList());
        }
    }

    @Schema(name = "ExplanationStep", description = "計算說明的一步（spec 4.9）。formula 裡大括號中的符號是代入值，對應 terms 裡同名的項目")
    public record ExplanationStepDto(
            @Schema(requiredMode = REQUIRED, description = "分組標題，例如「進來多少」「最熱那台」；同一組的步驟相鄰") String group,
            @Schema(requiredMode = REQUIRED) String label,
            @Schema(requiredMode = REQUIRED, description = "例如 {λ} ÷ ({c} × {μ})") String formula,
            @Schema(requiredMode = REQUIRED, description = "代入值，依在 formula 裡出現的順序；只有 plain 用到的接在後面") List<ExplanationTermDto> terms,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "這一步的結果；沒有定義時為 null（例如過載時的延遲）")
            Double value,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "rps、ms、%（0–1 的比例，顯示成百分比）、bytes、days，沒有單位時為 null")
            String unit,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "白話的一句，例如「每秒能處理 {=} = {c} × {μ}」："
                    + "{符號} 代入 terms 裡的值、{=} 代入這一步的結果、{@符號} 是那個代入值來自的節點名稱；"
                    + "view 為 FORMULA 時為 null")
            String plain,
            @Schema(requiredMode = REQUIRED, description = "BOTH：兩種模式都顯示；PLAIN：只在白話模式；FORMULA：只在看公式時")
            ExplanationView view,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "read、write 各算一次的步驟是 READ 或 WRITE，"
                    + "兩者相同時前端合成一行；其他為 null")
            RequestClass requestClass) {

        static ExplanationStepDto from(ExplanationStep step) {
            return new ExplanationStepDto(step.group(), step.label(), step.formula(),
                    step.terms().stream().map(ExplanationTermDto::from).toList(), step.value(), step.unit(), step.plain(),
                    step.view(), step.requestClass());
        }
    }

    @Schema(name = "ExplanationTerm", description = "計算說明裡的一個代入值")
    public record ExplanationTermDto(
            @Schema(requiredMode = REQUIRED, description = "formula 裡大括號中的符號") String symbol,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "沒有定義時為 null（例如下游過載時的端到端延遲）")
            Double value,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "同 ExplanationStep.unit") String unit,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "這個值來自另一個節點時是那個節點的 id，前端可以點過去")
            String nodeId) {

        static ExplanationTermDto from(ExplanationTerm term) {
            return new ExplanationTermDto(term.symbol(), term.value(), term.unit(), term.nodeId());
        }
    }

    @Schema(name = "HotSpot")
    public record HotSpotDto(
            @Schema(requiredMode = REQUIRED, description = "最熱的那台") InstanceResultDto hottest,
            @Schema(requiredMode = REQUIRED, description = "其他台合起來（共用一條佇列）") InstanceResultDto others) {

        static HotSpotDto from(HotSpot hotSpot) {
            return hotSpot == null ? null
                    : new HotSpotDto(InstanceResultDto.from(hotSpot.hottest()), InstanceResultDto.from(hotSpot.others()));
        }
    }

    @Schema(name = "InstanceResult", description = "節點裡一部分機器的結果，欄位意義同 NodeResult；多台時是合起來的流量，ρ 是每台相同的使用率")
    public record InstanceResultDto(
            @Schema(requiredMode = REQUIRED) ClassRatesDto arrivalRps,
            @Schema(requiredMode = REQUIRED) double throughputRps,
            @Schema(requiredMode = REQUIRED) double droppedRps,
            @Schema(requiredMode = REQUIRED) double utilization,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "過載時為 null") Double avgLatencyMs,
            @Schema(requiredMode = REQUIRED) Status status) {

        static InstanceResultDto from(InstanceResult instance) {
            return new InstanceResultDto(ClassRatesDto.from(instance.arrivalRps()), instance.throughputRps(),
                    instance.droppedRps(), instance.utilization(), instance.avgLatencyMs(), instance.status());
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
            @Schema(requiredMode = REQUIRED, description = "有 Read Replica 複製跟不上（REPLICATION_LAG），實際副本量會比 totalWithReplicasBytes 少")
            boolean replicasLagging,
            @Schema(requiredMode = REQUIRED, description = "totalBytes ÷ instances（資料平均分布）") double perInstanceBytes,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "每台機器的磁碟幾天後會滿；OBJECT_STORAGE、沒有設定 diskGbPerInstance、沒有寫入或寫入量小到天數超出範圍時為 null")
            Double daysUntilFull,
            @Schema(requiredMode = REQUIRED, description = "磁碟在保留期內就會滿（daysUntilFull < retentionDays）")
            boolean fillsDisk,
            @Schema(requiredMode = REQUIRED, description = "計算時用的 retentionDays") double retentionDays,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "計算時用的 diskGbPerInstance，沒有設定時和 OBJECT_STORAGE 為 null")
            Double diskGbPerInstance,
            @Schema(requiredMode = REQUIRED, description = "計算步驟（spec 4.9），格式同 NodeResult.explanation；未連線的節點為空陣列")
            List<ExplanationStepDto> explanation) {

        static StorageEstimateDto from(StorageEstimate estimate) {
            return new StorageEstimateDto(estimate.dailyBytes(), estimate.totalBytes(), estimate.replicas(),
                    estimate.totalWithReplicasBytes(), estimate.replicasLagging(), estimate.perInstanceBytes(), estimate.daysUntilFull(),
                    estimate.fillsDisk(), estimate.retentionDays(), estimate.diskGbPerInstance(),
                    estimate.explanation().stream().map(ExplanationStepDto::from).toList());
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
