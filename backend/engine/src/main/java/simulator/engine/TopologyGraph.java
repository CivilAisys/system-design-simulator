package simulator.engine;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 拓撲的圖結構：只建一次，驗證和計算共用，提供出邊、拓撲排序和環。
 * 兩端有一端不存在的邊不放進圖裡，由 {@link TopologyValidator} 報 UNKNOWN_NODE。
 * id 重複是格式錯誤（錯誤沒辦法指到哪一個），丟 {@link TopologyFormatException}。
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
            if (graph.nodes.putIfAbsent(node.id(), node) != null) {
                throw new TopologyFormatException("Duplicate node id " + node.id());
            }
            graph.outgoing.put(node.id(), new ArrayList<>());
            graph.inDegree.put(node.id(), 0);
        }
        var edgeIds = new HashSet<String>();
        for (Edge edge : topology.edges()) {
            if (!edgeIds.add(edge.id())) {
                throw new TopologyFormatException("Duplicate edge id " + edge.id());
            }
            if (graph.contains(edge.source()) && graph.contains(edge.target())) {
                graph.outgoing.get(edge.source()).add(edge);
                graph.inDegree.merge(edge.target(), 1, Integer::sum);
            }
        }
        return graph;
    }

    boolean contains(String nodeId) {
        return nodes.containsKey(nodeId);
    }

    /** 不存在時為 null。 */
    Node node(String nodeId) {
        return nodes.get(nodeId);
    }

    List<Edge> outgoing(String nodeId) {
        return outgoing.get(nodeId);
    }

    /** Client／LB 依 weight 比例分流（spec 3.3）。 */
    static boolean splitsByWeight(Node node) {
        return node instanceof ClientNode || node instanceof LoadBalancerNode;
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

    /**
     * 在環上的節點：所在的強連通分量（Tarjan）大於一個節點，或有連到自己的邊。
     * 環的下游、夾在兩個環中間的節點都不算。用明確的堆疊代替遞迴，節點很多時也不會 StackOverflowError。
     */
    Set<String> nodesOnCycles() {
        Map<String, Integer> index = new HashMap<>();
        Map<String, Integer> low = new HashMap<>();
        Deque<String> component = new ArrayDeque<>();
        Set<String> onComponent = new HashSet<>();
        Set<String> onCycles = new HashSet<>();
        Deque<Visit> calls = new ArrayDeque<>();
        for (String root : nodes.keySet()) {
            if (index.containsKey(root)) {
                continue;
            }
            calls.push(visit(root, index, low, component, onComponent));
            while (!calls.isEmpty()) {
                String id = calls.peek().id();
                Iterator<Edge> edges = calls.peek().edges();
                if (edges.hasNext()) {
                    Edge edge = edges.next();
                    String target = edge.target();
                    if (target.equals(id)) {
                        onCycles.add(id);
                    }
                    if (!index.containsKey(target)) {
                        calls.push(visit(target, index, low, component, onComponent));
                    } else if (onComponent.contains(target)) {
                        low.merge(id, index.get(target), Math::min);
                    }
                    continue;
                }
                calls.pop();
                if (!calls.isEmpty()) {
                    low.merge(calls.peek().id(), low.get(id), Math::min);
                }
                if (low.get(id).equals(index.get(id))) {
                    List<String> members = new ArrayList<>();
                    String member;
                    do {
                        member = component.pop();
                        onComponent.remove(member);
                        members.add(member);
                    } while (!member.equals(id));
                    if (members.size() > 1) {
                        onCycles.addAll(members);
                    }
                }
            }
        }
        return onCycles;
    }

    /** Tarjan 遞迴中的一層：正在看哪個節點，以及它還沒看過的出邊。 */
    private record Visit(String id, Iterator<Edge> edges) {
    }

    private Visit visit(String id, Map<String, Integer> index, Map<String, Integer> low,
            Deque<String> component, Set<String> onComponent) {
        index.put(id, index.size());
        low.put(id, index.get(id));
        component.push(id);
        onComponent.add(id);
        return new Visit(id, outgoing.get(id).iterator());
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
        // 驗證過的拓撲沒有環
        if (order.size() != nodes.size()) {
            throw new IllegalStateException("Topology contains a cycle; validate it first");
        }
        return order;
    }
}
