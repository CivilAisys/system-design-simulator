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
        graph.checkClientWeights();
        return graph;
    }

    List<Edge> outgoing(String nodeId) {
        return outgoing.get(nodeId);
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
        outgoing.get(source.id()).add(edge);
        inDegree.merge(target.id(), 1, Integer::sum);
    }

    /** Client 依 weight 比例分流，權重總和為 0 時無法分配。 */
    private void checkClientWeights() {
        for (Node node : nodes.values()) {
            List<Edge> edges = outgoing.get(node.id());
            if (node instanceof ClientNode && !edges.isEmpty()
                    && edges.stream().mapToDouble(Edge::weight).sum() <= 0) {
                throw new IllegalArgumentException("Client " + node.id() + " edge weights must sum to more than 0");
            }
        }
    }
}
