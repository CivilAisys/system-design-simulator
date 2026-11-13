package simulator.engine;

/**
 * 節點的健康狀況，對應 JSON 的 {@code state} 欄位（spec 3.5）。階段一只有 HEALTHY，階段二故障注入時加入 DOWN、DEGRADED。
 * 跟依使用率分級的 {@link Status} 無關。
 */
public enum NodeHealth {
    HEALTHY
}
