package simulator.engine;

/**
 * 一個儲存節點的儲存量估算（spec 4.8），單位 bytes。用成功處理的 write 計算，過載時被丟棄的 write 不算。
 * {@code totalWithReplicasBytes} 包含 {@code replicas} 個 Read Replica 的完整副本；{@code replicasLagging} 表示其中有 replica
 * 複製跟不上（REPLICATION_LAG），實際副本量會比這少，數字照樣不改；{@code perInstanceBytes} 假設資料平均分布在 instances 台機器上。
 * {@code daysUntilFull} 是每台機器的磁碟幾天後會滿，沒有設定磁碟容量或沒有寫入時為 null；
 * {@code fillsDisk} 表示磁碟在保留期內就會滿（每台的用量超過磁碟容量）。
 * {@code retentionDays}、{@code diskGbPerInstance} 是計算時用的參數，畫面依它們顯示，不必回頭讀拓撲。
 */
public record StorageEstimate(double dailyBytes, double totalBytes, int replicas, double totalWithReplicasBytes,
        boolean replicasLagging, double perInstanceBytes, Double daysUntilFull, boolean fillsDisk, double retentionDays, Double diskGbPerInstance) {
}
