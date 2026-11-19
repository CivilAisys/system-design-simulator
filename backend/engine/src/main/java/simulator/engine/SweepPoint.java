package simulator.engine;

/**
 * 負載掃描的一點：所有 Client 的 rps 乘上 {@code multiplier}。
 *
 * @param readMs 各 Client 依 read 請求數加權的端到端延遲；任一 Client 沒有定義（路徑上過載）或沒有 read 時為 null
 * @param writeMs 同上，write
 * @param successRate 所有 Client 完整成功的請求 ÷ 送出的請求；沒有流量時為 1
 * @param busiest ρ 最高的節點；沒有候選節點時為 null
 */
public record SweepPoint(double multiplier, double totalRps, Double readMs, Double writeMs, double successRate,
        BusiestNode busiest) {
}
