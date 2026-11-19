package simulator.engine;

/** 負載掃描的門檻：倍率到 {@code multiplier}（總 rps {@code totalRps}）時，{@code nodeId} 第一個到達門檻。 */
public record SweepThreshold(double multiplier, double totalRps, String nodeId) {
}
