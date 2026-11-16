package simulator.engine;

/**
 * 從 source 送往 target 的有向連線。
 * {@code weight} 只用在 Client／LB 的邊，{@code callsPerRequest}、{@code requestClass} 只用在 Service 的邊，
 * 其他邊上計算時忽略。
 */
public record Edge(String id, String source, String target, double weight, int callsPerRequest, double latencyMs,
        RequestClass requestClass) {

    /** {@code requestClass} 為 ALL：每個 class 的請求都會走這條邊。 */
    public Edge(String id, String source, String target, double weight, int callsPerRequest, double latencyMs) {
        this(id, source, target, weight, callsPerRequest, latencyMs, RequestClass.ALL);
    }
}
