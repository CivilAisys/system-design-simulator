package simulator.engine;

/**
 * 有快取行為的節點：read 只有沒命中的 {@code 1 - hitRatio} 往下送，write 全部往下送，必須剛好一個下游（spec 3.3）。
 * Cache 和 CDN 只差在名稱和預設值，計算和驗證都看這個介面。
 */
public sealed interface CachingNode extends Node permits CacheNode, CdnNode {
    CapacityParams capacityParams();

    double hitRatio();

    /** 只有 Cache 能設定熱點，CDN 沒有。 */
    default Double hotShare() {
        return null;
    }

    /** 每個主有幾個從，只是標記；只有 Cache 有。 */
    default int replicas() {
        return 0;
    }
}
