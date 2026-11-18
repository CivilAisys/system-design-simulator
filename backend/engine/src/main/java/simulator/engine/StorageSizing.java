package simulator.engine;

/**
 * 儲存量估算的參數（spec 4.8）：每次 write 平均新增 {@code bytesPerWrite} bytes，資料保留 {@code retentionDays} 天；
 * {@code diskGbPerInstance} 是每台機器的磁碟容量（GB），null 時不估算磁碟幾天後會滿。
 */
public record StorageSizing(double bytesPerWrite, double retentionDays, Double diskGbPerInstance) {
}
