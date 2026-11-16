package simulator.engine;

/**
 * 資料儲存的終點節點：M/M/c、不能有下游（spec 3.3）。
 * Database 和 Object Storage 只差在名稱和預設值，計算和驗證都看這個介面。
 */
public sealed interface StorageNode extends Node permits DatabaseNode, ObjectStorageNode {
    CapacityParams capacityParams();

    /** 只有 Database 能分片，Object Storage 的容量由供應商負責，沒有分片。 */
    default ShardLayout shards() {
        return ShardLayout.SINGLE;
    }
}
