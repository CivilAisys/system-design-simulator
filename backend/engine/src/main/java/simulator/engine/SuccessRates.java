package simulator.engine;

import java.util.List;
import java.util.Map;

/**
 * spec 4.3.1 的成功率：由下游往上游算每個節點的 S(n, class)，一個請求從 n 開始、最後完整成功的機率。
 * fan-out 時下游的 RPS 是子呼叫而不是使用者請求，所以不能直接拿丟棄量加總。
 * 假設各節點的丟棄彼此獨立。
 */
final class SuccessRates {

    private final TopologyGraph graph;
    private final Map<String, NodeResult> nodeResults;
    private final UpstreamPass<Double> success;

    /** {@code order} 是拓撲排序，{@code nodeResults} 要已經有所有伺服器類節點的處理量。 */
    SuccessRates(TopologyGraph graph, List<Node> order, Map<String, NodeResult> nodeResults) {
        this.graph = graph;
        this.nodeResults = nodeResults;
        this.success = new UpstreamPass<>(order, this::success);
    }

    /** Client 送出的請求中，每秒有幾個完整成功。 */
    double client(String clientId, ClassRates sent) {
        return sent.read() * success.get(clientId, true) + sent.write() * success.get(clientId, false);
    }

    private double success(Node node, boolean read, Map<String, Double> children) {
        List<Edge> edges = graph.outgoing(node.id());
        double downstream = switch (node) {
            // 依比例分流：成功率是各下游的加權平均
            case ClientNode client -> weightedSum(edges, children, read);
            case LoadBalancerNode lb -> weightedSum(edges, children, read);
            // 任何一個子呼叫失敗，整個請求就失敗
            case ServiceNode service -> edges.stream()
                    .mapToDouble(edge -> Math.pow(children.get(edge.target()), graph.visits(edge, read)))
                    .reduce(1, (a, b) -> a * b);
            // 只有沒命中的部分（write 是全部）要靠下游成功
            case CachingNode cache -> {
                Edge edge = edges.getFirst();
                double miss = graph.visits(edge, read);
                yield (1 - miss) + miss * children.get(edge.target());
            }
            // 複製是非同步的，replica 跟不上不影響 primary 上的請求
            case StorageNode storage -> 1;
            // read 的丟棄由 pass(n) 扣掉；複製寫入的丟棄只產生警告
            case ReadReplicaNode replica -> 1;
            case ExternalApiNode api -> 1;
            // 放行的請求只送往唯一的下游；被拒絕的部分由 pass(n) 扣掉
            case RateLimiterNode limiter -> children.get(edges.getFirst().target());
        };
        return pass(node, read) * downstream;
    }

    private double weightedSum(List<Edge> edges, Map<String, Double> children, boolean read) {
        return edges.stream().mapToDouble(edge -> graph.visits(edge, read) * children.get(edge.target())).sum();
    }

    /**
     * 這個 class 的通過率 = 實際處理量 / 到達量；Client 和沒有流量的節點為 1。
     * 每個 shard 依 read／write 比例丟棄，但 Read Replica 各 shard 的比例不同（複製寫入跟著 primary 的 shard），
     * 所以分片的節點逐 shard 加總這個 class 的處理量。
     */
    private double pass(Node node, boolean read) {
        if (node instanceof ClientNode) {
            return 1;
        }
        NodeResult result = nodeResults.get(node.id());
        double arrival = result.arrivalRps().of(read);
        if (arrival <= 0) {
            return 1;
        }
        if (result.shards() == null) {
            return result.throughputRps() / result.arrivalRps().total();
        }
        double processed = result.shards().stream()
                .filter(shard -> shard.arrivalRps().total() > 0)
                .mapToDouble(shard -> shard.arrivalRps().of(read) * shard.throughputRps() / shard.arrivalRps().total())
                .sum();
        return processed / arrival;
    }
}
