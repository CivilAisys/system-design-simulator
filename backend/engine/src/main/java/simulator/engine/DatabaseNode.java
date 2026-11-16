package simulator.engine;

/** 資料庫，計算方式見 {@link StorageNode}。可以分片。 */
public record DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams,
        ShardLayout shards) implements StorageNode {

    /** 沒有分片。 */
    public DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams) {
        this(id, name, health, capacityParams, ShardLayout.SINGLE);
    }
}
