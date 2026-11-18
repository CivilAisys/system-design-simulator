package simulator.engine;

/**
 * 快取，計算方式見 {@link CachingNode}。{@code hotShare} 是最熱的那台分到的流量比例（spec 4.2.2），
 * null 時所有機器共用一條佇列。{@code replicas} 是每個主有幾個從（例如 Redis Cluster 的 3 主 3 從），
 * 只是標記，不影響計算：從節點預設不分擔讀取，只做備援。
 */
public record CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio,
        Double hotShare, int replicas) implements CachingNode {

    public static final int DEFAULT_REPLICAS = 0;

    /** 沒有從節點。 */
    public CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio,
            Double hotShare) {
        this(id, name, health, capacityParams, hitRatio, hotShare, DEFAULT_REPLICAS);
    }

    /** 沒有熱點、沒有從節點。 */
    public CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio) {
        this(id, name, health, capacityParams, hitRatio, null);
    }
}
