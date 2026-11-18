package simulator.engine;

import java.util.ArrayList;
import java.util.List;

/**
 * 單一節點的計算結果。到達量、處理量、丟棄量、拒絕量永遠是數字；
 * 伺服器類欄位為 null 時代表「不適用」（Client）或「無定義」（過載時的延遲）。
 * {@code successRps} 和 {@code endToEndMs} 只有 Client 有，其他節點為 null。
 * {@code hotSpot} 只有設定了 hotShare 的 Cache 有，其他節點為 null。
 * {@code warnings} 永遠是清單，沒有警告時為空。
 */
public record NodeResult(
        ClassRates arrivalRps,
        double throughputRps,
        double droppedRps,
        double rejectedRps,
        Double successRps,
        ClassLatencies endToEndMs,
        Double capacityRps,
        Double utilization,
        Double avgQueueMs,
        Double avgLatencyMs,
        Status status,
        HotSpot hotSpot,
        List<NodeWarning> warnings) {

    /** 換掉丟棄量（consumer 處理不完的訊息改記成 backlog）。 */
    NodeResult withDropped(double dropped) {
        return new NodeResult(arrivalRps, throughputRps, dropped, rejectedRps, successRps, endToEndMs, capacityRps,
                utilization, avgQueueMs, avgLatencyMs, status, hotSpot, warnings);
    }

    /** 加上一個警告。 */
    NodeResult withWarning(NodeWarning warning) {
        var all = new ArrayList<>(warnings);
        all.add(warning);
        return new NodeResult(arrivalRps, throughputRps, droppedRps, rejectedRps, successRps, endToEndMs, capacityRps,
                utilization, avgQueueMs, avgLatencyMs, status, hotSpot, List.copyOf(all));
    }

    static NodeResult client(ClassRates sent, double successRps, ClassLatencies endToEndMs) {
        return new NodeResult(sent, sent.total(), 0, 0, successRps, endToEndMs, null, null, null, null, null,
                null, List.of());
    }
}
