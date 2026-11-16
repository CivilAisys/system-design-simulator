package simulator.engine;

/** 快取，計算方式見 {@link CachingNode}。 */
public record CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio)
        implements CachingNode {
}
