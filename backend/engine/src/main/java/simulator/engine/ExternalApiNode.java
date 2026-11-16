package simulator.engine;

/**
 * 第三方服務（金流、簡訊等），終點節點。沒有 M/M/c：節點延遲固定是 {@code latencyMs}，
 * 超過 {@code quotaRps} 的請求被對方拒絕（HTTP 429），記為拒絕量（spec 4.2.1）。
 */
public record ExternalApiNode(String id, String name, NodeHealth health, double latencyMs, double quotaRps)
        implements Node {
}
