package simulator.engine;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 拓撲的圖結構：只建一次，提供出邊與拓撲排序。
 * 假設 id 不重複、邊的兩端都存在（{@link TopologyValidator} 先檢查過）。
 */
final class TopologyGraph {

    private final Map<String, Node> nodes = new LinkedHashMap<>();
    private final Map<String, List<Edge>> outgoing = new HashMap<>();
    private final Map<String, Integer> inDegree = new HashMap<>();

    private TopologyGraph() {
    }

    static TopologyGraph of(Topology topology) {
        var graph = new TopologyGraph();
        for (Node node : topology.nodes()) {
            graph.nodes.put(node.id(), node);
            graph.outgoing.put(node.id(), new ArrayList<>());
            graph.inDegree.put(node.id(), 0);
        }
        for (Edge edge : topology.edges()) {
            graph.outgoing.get(edge.source()).add(edge);
            graph.inDegree.merge(edge.target(), 1, Integer::sum);
        }
        return graph;
    }

    List<Edge> outgoing(String nodeId) {
        return outgoing.get(nodeId);
    }

    /**
     * 上游的一個請求平均往這條邊送幾次（spec 3.3、3.4）：Client／LB 依 weight 比例分流，
     * Service 呼叫 callsPerRequest 次，Cache 的 read 只有沒命中的部分往下送。流量和端到端延遲共用這條規則。
     */
    double visits(Edge edge, boolean read) {
        Node source = nodes.get(edge.source());
        return switch (source) {
            case ClientNode client -> edge.weight() / totalWeight(source.id());
            case LoadBalancerNode lb -> edge.weight() / totalWeight(source.id());
            case ServiceNode service -> edge.callsPerRequest();
            case CacheNode cache -> read ? 1 - cache.hitRatio() : 1;
            case DatabaseNode database -> 0;
        };
    }

    private double totalWeight(String nodeId) {
        return outgoing.get(nodeId).stream().mapToDouble(Edge::weight).sum();
    }

    boolean hasIncoming(String nodeId) {
        return inDegree.get(nodeId) > 0;
    }

    /** 驗證過的拓撲沒有環。 */
    List<Node> topologicalOrder() {
        List<Node> order = kahn();
        if (order.size() != nodes.size()) {
            throw new IllegalStateException("Topology contains a cycle; validate it first");
        }
        return order;
    }

    /**
     * 在環上（或夾在兩個環之間）的節點。Kahn's algorithm 排不完的節點包含環和環的下游，
     * 再反過來一層層拿掉沒有出邊留在剩餘集合裡的節點，剩下的就是環。
     */
    Set<String> nodesOnCycles() {
        Set<String> remaining = new LinkedHashSet<>(nodes.keySet());
        kahn().forEach(node -> remaining.remove(node.id()));
        boolean removed = true;
        while (removed) {
            removed = remaining.removeIf(id -> outgoing.get(id).stream().noneMatch(e -> remaining.contains(e.target())));
        }
        return remaining;
    }

    /** Kahn's algorithm，同層依輸入順序，讓結果可重現。有環時環上和環下游的節點不會出現。 */
    private List<Node> kahn() {
        Map<String, Integer> remaining = new HashMap<>(inDegree);
        var ready = new ArrayDeque<String>();
        nodes.keySet().stream().filter(id -> remaining.get(id) == 0).forEach(ready::add);
        List<Node> order = new ArrayList<>();
        while (!ready.isEmpty()) {
            String id = ready.poll();
            order.add(nodes.get(id));
            for (Edge edge : outgoing.get(id)) {
                if (remaining.merge(edge.target(), -1, Integer::sum) == 0) {
                    ready.add(edge.target());
                }
            }
        }
        return order;
    }
}
