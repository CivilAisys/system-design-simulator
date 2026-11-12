package simulator.engine;

/** {@code bottleneckNodeId} 是 ρ 最高的節點；沒有可處理請求的節點時為 null。 */
public record Summary(double offeredRps, String bottleneckNodeId) {
}
