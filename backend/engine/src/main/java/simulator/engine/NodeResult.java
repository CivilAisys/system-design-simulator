package simulator.engine;

/**
 * 單一節點的計算結果。到達量、處理量、丟棄量永遠是數字；
 * 伺服器類欄位為 null 時代表「不適用」（Client）或「無定義」（過載時的延遲）。
 * {@code successRps} 和 {@code endToEndMs} 只有 Client 有，其他節點為 null。
 */
public record NodeResult(
        ClassRates arrivalRps,
        double throughputRps,
        double droppedRps,
        Double successRps,
        ClassLatencies endToEndMs,
        Double capacityRps,
        Double utilization,
        Double avgQueueMs,
        Double avgLatencyMs,
        Status status) {

    static NodeResult client(ClassRates sent, double successRps, ClassLatencies endToEndMs) {
        return new NodeResult(sent, sent.total(), 0, successRps, endToEndMs, null, null, null, null, null);
    }
}
