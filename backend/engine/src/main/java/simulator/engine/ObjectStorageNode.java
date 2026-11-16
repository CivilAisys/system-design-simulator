package simulator.engine;

/** Object Storage（例如 S3），計算方式和 Database 相同，見 {@link StorageNode}。 */
public record ObjectStorageNode(String id, String name, NodeHealth health, CapacityParams capacityParams,
        StorageSizing sizing) implements StorageNode {

    // 圖片、影片等大型檔案
    public static final StorageSizing DEFAULT_SIZING = new StorageSizing(1_000_000, 365, null);

    /** 儲存量估算用預設值。 */
    public ObjectStorageNode(String id, String name, NodeHealth health, CapacityParams capacityParams) {
        this(id, name, health, capacityParams, DEFAULT_SIZING);
    }
}
