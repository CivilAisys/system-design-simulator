package simulator.engine;

/** 資料庫，計算方式見 {@link StorageNode}。 */
public record DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams)
        implements StorageNode {
}
