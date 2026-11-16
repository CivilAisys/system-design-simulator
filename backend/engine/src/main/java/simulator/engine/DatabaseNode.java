package simulator.engine;

/** 資料庫，計算方式見 {@link StorageNode}。可以分片。 */
public record DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams,
        ShardLayout shards, StorageSizing sizing) implements StorageNode {

    public static final StorageSizing DEFAULT_SIZING = new StorageSizing(1_000, 365, null);

    /** 儲存量估算用預設值。 */
    public DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams,
            ShardLayout shards) {
        this(id, name, health, capacityParams, shards, DEFAULT_SIZING);
    }

    /** 沒有分片。 */
    public DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams) {
        this(id, name, health, capacityParams, ShardLayout.SINGLE);
    }
}
