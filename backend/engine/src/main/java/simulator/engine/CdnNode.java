package simulator.engine;

/** CDN，計算方式和 Cache 相同，見 {@link CachingNode}。 */
public record CdnNode(String id, String name, NodeHealth health, CapacityParams capacityParams, double hitRatio)
        implements CachingNode {
}
