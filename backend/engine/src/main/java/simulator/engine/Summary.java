package simulator.engine;

/**
 * {@code successRps} 是各 Client 完整成功的請求數總和，{@code dropRate = 1 − successRps / offeredRps}
 * （spec 4.3.1）；沒有流量時沒有東西被丟，記為 0。
 * {@code avgEndToEndMs} 是各 Client 依請求數加權的端到端延遲（spec 4.3）。
 * {@code bottleneckNodeId} 是 ρ 最高的節點；沒有可處理請求的節點時為 null。
 */
public record Summary(double offeredRps, double successRps, double dropRate, ClassLatencies avgEndToEndMs,
        String bottleneckNodeId) {
}
