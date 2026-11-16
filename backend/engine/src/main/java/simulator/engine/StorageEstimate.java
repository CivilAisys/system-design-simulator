package simulator.engine;

/**
 * 一個儲存節點的儲存量估算（spec 4.8），單位 bytes。用成功處理的 write 計算，過載時被丟棄的 write 不算。
 * {@code totalWithReplicasBytes} 包含 {@code replicas} 個 Read Replica 的副本；{@code perShardBytes} 假設資料平均分布。
 * {@code daysUntilFull} 是每個 shard 的磁碟幾天後會滿，沒有設定磁碟容量或沒有寫入時為 null；
 * {@code fillsDisk} 表示磁碟在保留期內就會滿（每個 shard 的用量超過磁碟容量）。
 */
public record StorageEstimate(double dailyBytes, double totalBytes, int replicas, double totalWithReplicasBytes,
        double perShardBytes, Double daysUntilFull, boolean fillsDisk) {
}
