package simulator.engine;

/**
 * {@code avgEndToEndMs} 是各 Client 依請求數加權的端到端延遲（spec 4.3）。
 * {@code bottleneckNodeId} 是 ρ 最高的節點；沒有可處理請求的節點時為 null。
 */
public record Summary(double offeredRps, ClassLatencies avgEndToEndMs, String bottleneckNodeId) {
}
