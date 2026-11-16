package simulator.engine;

/** 節點的警告，不影響狀態分級。 */
public enum NodeWarning {
    /** Read Replica 過載，丟掉了一部分複製寫入：replication lag 會持續增加（spec 4.2.3）。 */
    REPLICATION_LAG
}
