package simulator.engine;

/**
 * {@code successRps} 是各 Client 完整成功的請求數總和，{@code dropRate = 1 − successRps / offeredRps}
 * （spec 4.3.1，包含丟棄和拒絕）；沒有流量時沒有東西被丟，記為 0。
 * {@code rejectedRps} 是各節點（Rate Limiter、External API）拒絕量的總和。
 * {@code avgEndToEndMs} 是各 Client 依請求數加權的端到端延遲（spec 4.3）。
 * {@code bottleneckNodeId} 是 ρ 最高的節點；沒有可處理請求的節點時為 null。
 * {@code bandwidth} 是各 Client 的使用者端頻寬總和，{@code cdnOffloadBytesPerSec} 是其中由 CDN 命中送出、
 * 不必從 origin 送出的部分（spec 4.7）。
 */
public record Summary(double offeredRps, double successRps, double rejectedRps, double dropRate,
        ClassLatencies avgEndToEndMs, String bottleneckNodeId, Bandwidth bandwidth, double cdnOffloadBytesPerSec) {
}
