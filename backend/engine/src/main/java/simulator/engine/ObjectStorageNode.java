package simulator.engine;

/**
 * Object Storage（例如 S3），計算方式和 Database 相同，見 {@link StorageNode}。
 * 容量由供應商負責，沒有磁碟容量，所以不估算磁碟幾天後會滿：給了 diskGbPerInstance 也忽略（spec 3.3）。
 */
public record ObjectStorageNode(String id, String name, NodeHealth health, CapacityParams capacityParams,
        StorageSizing sizing) implements StorageNode {

    public ObjectStorageNode {
        sizing = new StorageSizing(sizing.bytesPerWrite(), sizing.retentionDays(), null);
    }

    // 圖片、影片等大型檔案
    public static final StorageSizing DEFAULT_SIZING = new StorageSizing(1_000_000, 365, null);

    /** 儲存量估算用預設值。 */
    public ObjectStorageNode(String id, String name, NodeHealth health, CapacityParams capacityParams) {
        this(id, name, health, capacityParams, DEFAULT_SIZING);
    }
}
