package simulator.engine;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * spec 4.3 的端到端延遲：由下游往上游算每個節點的 L(n, class)，再依請求數加權成 summary。
 * 一個 class 不會走到的下游（weight 0、read 全部命中）不算在路徑上，它過載也不影響這個 class。
 */
final class EndToEndLatencies {

    /** 計算中的 L(n, class)。{@code ms} 為 null 時，overloaded 不為空。 */
    private record Path(Double ms, boolean approximate, Set<String> overloaded) {
    }

    private final Topology topology;
    private final TopologyGraph graph;
    private final Map<String, NodeResult> nodeResults;
    private final UpstreamPass<Path> paths;

    /** {@code order} 是拓撲排序，{@code nodeResults} 要已經有所有伺服器類節點的 W。 */
    EndToEndLatencies(Topology topology, TopologyGraph graph, List<Node> order, Map<String, NodeResult> nodeResults) {
        this.topology = topology;
        this.graph = graph;
        this.nodeResults = nodeResults;
        this.paths = new UpstreamPass<>(order, this::path);
    }

    /** Client 的端到端延遲；沒有這個 class 的請求時為 NO_TRAFFIC。 */
    ClassLatencies client(String clientId, ClassRates sent) {
        return new ClassLatencies(
                sent.read() > 0 ? latency(paths.get(clientId, true)) : noTraffic(),
                sent.write() > 0 ? latency(paths.get(clientId, false)) : noTraffic());
    }

    /** summary：各 Client 依該 class 的請求數加權平均。{@code clients} 的 endToEndMs 要已經算好。 */
    ClassLatencies average(List<NodeResult> clients) {
        return new ClassLatencies(average(clients, true), average(clients, false));
    }

    private EndToEndLatency average(List<NodeResult> clients, boolean read) {
        double weighted = 0;
        double requests = 0;
        boolean approximate = false;
        Set<String> overloaded = new HashSet<>();
        boolean undefined = false;
        for (NodeResult client : clients) {
            double rps = read ? client.arrivalRps().read() : client.arrivalRps().write();
            // 沒有請求的 Client 權重為 0，不影響平均
            if (rps == 0) {
                continue;
            }
            EndToEndLatency latency = client.endToEndMs().of(read);
            if (latency.ms() == null) {
                undefined = true;
                overloaded.addAll(latency.overloadedNodeIds());
                continue;
            }
            weighted += rps * latency.ms();
            requests += rps;
            approximate |= latency.approximate();
        }
        if (undefined) {
            return undefined(overloaded);
        }
        return requests > 0 ? EndToEndLatency.of(weighted / requests, approximate) : noTraffic();
    }

    private Path path(Node node, boolean read, Map<String, Path> children) {
        Set<String> overloaded = new HashSet<>();
        double own = 0;
        // Client 本身沒有 W；其他節點過載時 W 為 null
        if (!(node instanceof ClientNode)) {
            Double w = nodeResults.get(node.id()).avgLatencyMs();
            if (w == null) {
                overloaded.add(node.id());
            } else {
                own = w;
            }
        }
        List<Edge> edges = graph.outgoing(node.id());
        boolean parallel = node instanceof ServiceNode service && service.callMode() == CallMode.PARALLEL;
        boolean approximate = false;
        int called = 0;
        double downstream = 0;
        for (Edge edge : edges) {
            double visits = graph.visits(edge, read);
            if (visits == 0) {
                continue;
            }
            called++;
            Path child = children.get(edge.target());
            overloaded.addAll(child.overloaded());
            if (child.ms() == null) {
                continue;
            }
            approximate |= child.approximate();
            double cost = visits * (edge.latencyMs() * 2 + child.ms());
            downstream = parallel ? Math.max(downstream, cost) : downstream + cost;
        }
        if (!overloaded.isEmpty()) {
            return new Path(null, false, overloaded);
        }
        // 只呼叫一個下游時，最大值就是它本身，不是近似
        return new Path(own + downstream, approximate || (parallel && called > 1), Set.of());
    }

    private EndToEndLatency latency(Path path) {
        return path.ms() != null ? EndToEndLatency.of(path.ms(), path.approximate()) : undefined(path.overloaded());
    }

    private EndToEndLatency undefined(Set<String> overloaded) {
        return EndToEndLatency.undefined(UndefinedReason.OVERLOADED, inInputOrder(overloaded));
    }

    private static EndToEndLatency noTraffic() {
        return EndToEndLatency.undefined(UndefinedReason.NO_TRAFFIC, List.of());
    }

    private List<String> inInputOrder(Collection<String> ids) {
        return topology.nodes().stream().map(Node::id).filter(ids::contains).toList();
    }
}
