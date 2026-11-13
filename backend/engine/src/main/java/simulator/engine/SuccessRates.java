package simulator.engine;

import java.util.HashMap;
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
    private final Map<String, Double> readSuccess = new HashMap<>();
    private final Map<String, Double> writeSuccess = new HashMap<>();

    /** {@code order} 是拓撲排序，{@code nodeResults} 要已經有所有伺服器類節點的處理量。 */
    SuccessRates(TopologyGraph graph, List<Node> order, Map<String, NodeResult> nodeResults) {
        this.graph = graph;
        this.nodeResults = nodeResults;
        for (Node node : order.reversed()) {
            readSuccess.put(node.id(), success(node, true));
            writeSuccess.put(node.id(), success(node, false));
        }
    }

    /** Client 送出的請求中，每秒有幾個完整成功。 */
    double client(String clientId, ClassRates sent) {
        return sent.read() * readSuccess.get(clientId) + sent.write() * writeSuccess.get(clientId);
    }

    private double success(Node node, boolean read) {
        Map<String, Double> children = read ? readSuccess : writeSuccess;
        List<Edge> edges = graph.outgoing(node.id());
        double downstream = switch (node) {
            // 依比例分流：成功率是各下游的加權平均。沒有下游時請求沒有地方送，不算成功
            case ClientNode client -> weightedSum(edges, children, read);
            case LoadBalancerNode lb -> weightedSum(edges, children, read);
            // 任何一個子呼叫失敗，整個請求就失敗
            case ServiceNode service -> edges.stream()
                    .mapToDouble(edge -> Math.pow(children.get(edge.target()), graph.visits(edge, read)))
                    .reduce(1, (a, b) -> a * b);
            // 只有沒命中的部分（write 是全部）要靠下游成功
            case CacheNode cache -> {
                Edge edge = edges.getFirst();
                double miss = graph.visits(edge, read);
                yield (1 - miss) + miss * children.get(edge.target());
            }
            case DatabaseNode database -> 1;
        };
        return pass(node) * downstream;
    }

    private double weightedSum(List<Edge> edges, Map<String, Double> children, boolean read) {
        return edges.stream().mapToDouble(edge -> graph.visits(edge, read) * children.get(edge.target())).sum();
    }

    /** 通過率 = 實際處理量 / 到達量；Client 和沒有流量的節點為 1。 */
    private double pass(Node node) {
        if (node instanceof ClientNode) {
            return 1;
        }
        NodeResult result = nodeResults.get(node.id());
        double arrival = result.arrivalRps().total();
        return arrival > 0 ? result.throughputRps() / arrival : 1;
    }
}
