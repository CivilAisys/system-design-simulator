package simulator.engine;

/** 快取：read 只有沒命中的 {@code 1 - hitRatio} 往下送，write 全部往下送（spec 3.3）。 */
public record CacheNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio)
        implements Node {
}
