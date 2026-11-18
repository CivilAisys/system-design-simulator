package simulator.engine;

/**
 * 快取，計算方式見 {@link CachingNode}。{@code hotShare} 是最熱的那台分到的流量比例（spec 4.2.2），
 * null 時所有機器共用一條佇列。
 */
public record CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio,
        Double hotShare) implements CachingNode {

    /** 沒有熱點。 */
    public CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio) {
        this(id, name, health, capacityParams, hitRatio, null);
    }
}
