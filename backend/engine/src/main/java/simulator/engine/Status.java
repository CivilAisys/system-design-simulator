package simulator.engine;

/** 節點狀態：前四個依使用率 ρ 分級；Rate Limiter 沒有 ρ，只分限流中／未觸發（spec 4.4）。 */
public enum Status {
    OK,
    WARN,
    CRITICAL,
    OVERLOADED,
    LIMITING,
    NOT_LIMITING;

    public static Status of(double utilization) {
        if (utilization >= 1.0) {
            return OVERLOADED;
        }
        if (utilization >= 0.9) {
            return CRITICAL;
        }
        if (utilization >= 0.7) {
            return WARN;
        }
        return OK;
    }
}
