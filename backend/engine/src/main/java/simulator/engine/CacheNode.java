package simulator.engine;

/** 快取，計算方式見 {@link CachingNode}。可以分片，每個 shard 的 hitRatio 相同。 */
public record CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio,
        ShardLayout shards) implements CachingNode {

    /** 沒有分片。 */
    public CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio) {
        this(id, name, health, capacityParams, hitRatio, ShardLayout.SINGLE);
    }
}
