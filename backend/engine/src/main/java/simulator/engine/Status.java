package simulator.engine;

/**
 * 節點狀態：前四個依使用率 ρ 分級；Rate Limiter 和 External API 沒有 ρ，
 * 只看有沒有超過上限：限流中／未觸發、超過配額／配額內（spec 4.4）。
 */
public enum Status {
    OK,
    WARN,
    CRITICAL,
    OVERLOADED,
    LIMITING,
    NOT_LIMITING,
    OVER_QUOTA,
    WITHIN_QUOTA;

    // 分級門檻（spec 4.4），計算說明也用同一組
    static final double WARN_AT = 0.7;
    static final double CRITICAL_AT = 0.9;
    static final double OVERLOADED_AT = 1.0;

    public static Status of(double utilization) {
        if (utilization >= OVERLOADED_AT) {
            return OVERLOADED;
        }
        if (utilization >= CRITICAL_AT) {
            return CRITICAL;
        }
        if (utilization >= WARN_AT) {
            return WARN;
        }
        return OK;
    }
}
