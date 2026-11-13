package simulator.engine;

/** 端到端延遲為 null 的原因（spec 4.3）。 */
public enum UndefinedReason {
    /** 路徑上有節點過載，系統不在穩態。 */
    OVERLOADED,
    /** 沒有這個 class 的請求，沒有平均可言。 */
    NO_TRAFFIC
}
