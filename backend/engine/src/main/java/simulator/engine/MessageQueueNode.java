package simulator.engine;

/**
 * Message Queue 的 broker（spec 4.2.4）：M/M/c，Client 的請求進到 queue（ack）就算成功。
 * 每條下游邊是一個 consumer group，都收到全部訊息；下游的處理是非同步的，不算進 Client 的延遲和成功率。
 */
public record MessageQueueNode(String id, String name, NodeHealth health, CapacityParams capacityParams)
        implements Node {
}
