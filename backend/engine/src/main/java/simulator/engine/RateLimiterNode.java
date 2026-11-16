package simulator.engine;

/**
 * 全域限流：所有上游加總後最多放行 {@code limitRps}，超過的部分是拒絕量，不往下送，必須剛好一個下游（spec 3.3）。
 * 沒有 M/M/c，節點延遲記為 0（假設 limiter 本身不會成為瓶頸）。
 */
public record RateLimiterNode(String id, String name, NodeHealth health, double limitRps) implements Node {
}
