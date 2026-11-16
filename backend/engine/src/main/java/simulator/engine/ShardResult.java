package simulator.engine;

/** 一個 shard 的計算結果，欄位意義同 {@link NodeResult}。過載時 {@code avgLatencyMs} 為 null。 */
public record ShardResult(ClassRates arrivalRps, double throughputRps, double droppedRps, double utilization,
        Double avgLatencyMs, Status status) {
}
