package simulator.engine;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 拓撲的圖結構：只建一次，建立時先驗證，再提供出邊與拓撲排序。
 * 不合法時丟 IllegalArgumentException（#8 會改成收集驗證錯誤）。
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
            graph.addNode(node);
        }
        var edgeIds = new HashSet<String>();
        for (Edge edge : topology.edges()) {
            if (!edgeIds.add(edge.id())) {
                throw new IllegalArgumentException("Duplicate edge id " + edge.id());
            }
            graph.addEdge(edge);
        }
        graph.checkSplitWeights();
        graph.checkCacheDownstream();
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

    /** Kahn's algorithm，同層依輸入順序，讓結果可重現。 */
    List<Node> topologicalOrder() {
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
        if (order.size() != nodes.size()) {
            throw new IllegalArgumentException("Topology contains a cycle");
        }
        return order;
    }

    private void addNode(Node node) {
        if (nodes.putIfAbsent(node.id(), node) != null) {
            throw new IllegalArgumentException("Duplicate node id " + node.id());
        }
        checkParams(node);
        outgoing.put(node.id(), new ArrayList<>());
        inDegree.put(node.id(), 0);
    }

    private void addEdge(Edge edge) {
        Node source = nodes.get(edge.source());
        Node target = nodes.get(edge.target());
        if (source == null || target == null) {
            throw new IllegalArgumentException("Edge " + edge.id() + " references an unknown node");
        }
        if (source instanceof DatabaseNode) {
            throw new IllegalArgumentException("Database " + source.id() + " cannot have downstream edges");
        }
        if (target instanceof ClientNode) {
            throw new IllegalArgumentException("Client " + target.id() + " cannot have upstream edges");
        }
        checkParams(edge, source);
        outgoing.get(source.id()).add(edge);
        inDegree.merge(target.id(), 1, Integer::sum);
    }

    /** 參數範圍（spec 3.2、4.5）。 */
    private static void checkParams(Node node) {
        String where = "Node " + node.id();
        switch (node) {
            case ClientNode client -> {
                requireAtLeast(client.rps(), 0, where, "rps");
                requireBetween(client.readRatio(), 0, 1, where, "readRatio");
            }
            case LoadBalancerNode lb -> checkCapacityParams(lb.capacityParams(), where);
            case ServiceNode service -> checkCapacityParams(service.capacityParams(), where);
            case CacheNode cache -> {
                checkCapacityParams(cache.capacityParams(), where);
                requireBetween(cache.hitRatio(), 0, 1, where, "hitRatio");
            }
            case DatabaseNode database -> checkCapacityParams(database.capacityParams(), where);
        }
    }

    private static void checkCapacityParams(CapacityParams params, String where) {
        requireAtLeast(params.instances(), 1, where, "instances");
        requireAtLeast(params.concurrency(), 1, where, "concurrency");
        if (!(params.serviceTimeMs() > 0) || Double.isInfinite(params.serviceTimeMs())) {
            throw invalid(where, "serviceTimeMs", "a finite number > 0", params.serviceTimeMs());
        }
    }

    /** 只檢查對這個起點有意義的欄位，其他欄位計算時忽略（spec 3.4）。 */
    private static void checkParams(Edge edge, Node source) {
        String where = "Edge " + edge.id();
        requireAtLeast(edge.latencyMs(), 0, where, "latencyMs");
        switch (source) {
            case ClientNode client -> requireAtLeast(edge.weight(), 0, where, "weight");
            case LoadBalancerNode lb -> requireAtLeast(edge.weight(), 0, where, "weight");
            case ServiceNode service -> requireAtLeast(edge.callsPerRequest(), 1, where, "callsPerRequest");
            case CacheNode cache -> {
            }
            case DatabaseNode database -> {
            }
        }
    }

    private static void requireAtLeast(double value, double min, String where, String param) {
        if (!(value >= min) || Double.isInfinite(value)) {
            throw invalid(where, param, "a finite number >= " + min, value);
        }
    }

    private static void requireBetween(double value, double min, double max, String where, String param) {
        if (!(value >= min && value <= max)) {
            throw invalid(where, param, "between " + min + " and " + max, value);
        }
    }

    private static IllegalArgumentException invalid(String where, String param, String expected, double actual) {
        return new IllegalArgumentException(where + " param " + param + " must be " + expected + " but was " + actual);
    }

    /** Client／LB 依 weight 比例分流，權重總和為 0 時無法分配。 */
    private void checkSplitWeights() {
        for (Node node : nodes.values()) {
            List<Edge> edges = outgoing.get(node.id());
            if ((node instanceof ClientNode || node instanceof LoadBalancerNode) && !edges.isEmpty()
                    && edges.stream().mapToDouble(Edge::weight).sum() <= 0) {
                throw new IllegalArgumentException("Node " + node.id() + " edge weights must sum to more than 0");
            }
        }
    }

    /** Cache 的 miss 和 write 只會送往同一個下游。 */
    private void checkCacheDownstream() {
        for (Node node : nodes.values()) {
            if (node instanceof CacheNode && outgoing.get(node.id()).size() != 1) {
                throw new IllegalArgumentException("Cache " + node.id() + " must have exactly one downstream edge");
            }
        }
    }
}
