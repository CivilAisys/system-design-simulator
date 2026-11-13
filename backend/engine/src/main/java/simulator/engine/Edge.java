package simulator.engine;

/**
 * 從 source 送往 target 的有向連線。
 * {@code weight} 只用在 Client／LB 的邊，{@code callsPerRequest} 只用在 Service 的邊，其他邊上計算時忽略。
 */
public record Edge(String id, String source, String target, double weight, int callsPerRequest, double latencyMs) {
}
