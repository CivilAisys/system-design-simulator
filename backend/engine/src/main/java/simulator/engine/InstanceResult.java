package simulator.engine;

/**
 * 節點裡一部分機器的計算結果（spec 4.2.2），欄位意義同 {@link NodeResult}。過載時 {@code avgLatencyMs} 為 null。
 * 「其他台」共用一條佇列，所以是那幾台合起來的到達率、處理量和丟棄量，ρ 是每台相同的使用率。
 */
public record InstanceResult(ClassRates arrivalRps, double throughputRps, double droppedRps, double utilization,
        Double avgLatencyMs, Status status) {
}
