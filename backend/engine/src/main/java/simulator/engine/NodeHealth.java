package simulator.engine;

/**
 * 節點的健康狀況，對應 JSON 的 {@code state} 欄位（spec 3.5）。v1 只有 HEALTHY，v2 故障注入時加入 DOWN、DEGRADED。
 * 跟依使用率分級的 {@link Status} 無關。
 */
public enum NodeHealth {
    HEALTHY
}
