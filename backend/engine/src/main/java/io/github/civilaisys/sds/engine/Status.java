package io.github.civilaisys.sds.engine;

/** 依使用率 ρ 分級的節點狀態。 */
public enum Status {
    OK,
    WARN,
    CRITICAL,
    OVERLOADED;

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
