package simulator.engine;

/**
 * Database 的唯讀副本（spec 4.2.3）：M/M/c，read 由 Service 的 READ 邊送來，write 是 primary 處理完的寫入（複製）。
 * 剛好一個 Database 上游（primary），沒有下游。
 */
public record ReadReplicaNode(String id, String name, NodeHealth health, CapacityParams capacityParams)
        implements Node {
}
