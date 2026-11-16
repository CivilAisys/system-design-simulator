package simulator.engine;

/** Object Storage（例如 S3），計算方式和 Database 相同，見 {@link StorageNode}。 */
public record ObjectStorageNode(String id, String name, NodeHealth health, CapacityParams capacityParams)
        implements StorageNode {
}
