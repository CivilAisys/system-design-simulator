package simulator.engine;

/**
 * 單一節點的計算結果。流量類欄位永遠是數字；
 * 伺服器類欄位為 null 時代表「不適用」（Client）或「無定義」（過載時的延遲）。
 */
public record NodeResult(
        ClassRates arrivalRps,
        double throughputRps,
        double droppedRps,
        Double capacityRps,
        Double utilization,
        Double avgQueueMs,
        Double avgLatencyMs,
        Status status) {

    static NodeResult client(ClassRates sent) {
        return new NodeResult(sent, sent.total(), 0, null, null, null, null, null);
    }
}
