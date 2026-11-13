package simulator.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * v1 的穩態計算：每個節點視為 M/M/c，依拓撲排序由上游往下游計算流量，
 * 再由下游往上游計算端到端延遲。
 */
public final class SteadyStateSimulator implements Simulator {

    @Override
    public SimulationResult simulate(Topology topology) {
        var graph = TopologyGraph.of(topology);
        Map<String, ClassRates> arrivals = new HashMap<>();
        topology.nodes().forEach(node -> arrivals.put(node.id(), ClassRates.ZERO));

        Map<String, NodeResult> nodeResults = new HashMap<>();
        Map<String, EdgeResult> edgeResults = new HashMap<>();
        // Client 的結果要等端到端延遲算完才能建立
        Map<String, ClassRates> sentByClient = new HashMap<>();
        List<Node> order = graph.topologicalOrder();
        for (Node node : order) {
            ClassRates arrival = arrivals.get(node.id());
            ClassRates processed = switch (node) {
                case ClientNode client -> {
                    double read = client.rps() * client.readRatio();
                    var sent = new ClassRates(read, client.rps() - read);
                    sentByClient.put(node.id(), sent);
                    yield sent;
                }
                case LoadBalancerNode lb -> process(lb.capacityParams(), arrival, node.id(), nodeResults);
                case ServiceNode service -> process(service.capacityParams(), arrival, node.id(), nodeResults);
                case CacheNode cache -> process(cache.capacityParams(), arrival, node.id(), nodeResults);
                case DatabaseNode database -> process(database.capacityParams(), arrival, node.id(), nodeResults);
            };

            List<Edge> edges = graph.outgoing(node.id());
            double totalWeight = edges.stream().mapToDouble(Edge::weight).sum();
            for (Edge edge : edges) {
                ClassRates rps = switch (node) {
                    case ClientNode client -> processed.times(edge.weight() / totalWeight);
                    case LoadBalancerNode lb -> processed.times(edge.weight() / totalWeight);
                    case ServiceNode service -> processed.times(edge.callsPerRequest());
                    case CacheNode cache -> new ClassRates(processed.read() * (1 - cache.hitRatio()), processed.write());
                    case DatabaseNode database -> ClassRates.ZERO;
                };
                edgeResults.put(edge.id(), new EdgeResult(rps));
                arrivals.merge(edge.target(), rps, ClassRates::plus);
            }
        }

        Map<String, ClassLatencies> endToEnd = endToEndLatencies(order, graph, nodeResults);
        sentByClient.forEach((id, sent) -> nodeResults.put(id, NodeResult.client(sent, endToEnd.get(id))));

        return new SimulationResult(true, List.of(), inNodeOrder(topology, nodeResults),
                inEdgeOrder(topology, edgeResults), summarize(topology, nodeResults));
    }

    private static ClassRates process(CapacityParams params, ClassRates arrival, String nodeId,
            Map<String, NodeResult> nodeResults) {
        var outcome = MmcQueue.solve(params, arrival);
        nodeResults.put(nodeId, outcome.result());
        return outcome.processed();
    }

    /** spec 4.3 的 L(n, class)，由下游往上游算，所以每個節點的下游都已經算好。 */
    private static Map<String, ClassLatencies> endToEndLatencies(List<Node> order, TopologyGraph graph,
            Map<String, NodeResult> nodeResults) {
        Map<String, ClassLatencies> latencies = new HashMap<>();
        for (Node node : order.reversed()) {
            latencies.put(node.id(), new ClassLatencies(
                    latency(node, true, graph, nodeResults, latencies),
                    latency(node, false, graph, nodeResults, latencies)));
        }
        return latencies;
    }

    private static Double latency(Node node, boolean read, TopologyGraph graph, Map<String, NodeResult> nodeResults,
            Map<String, ClassLatencies> latencies) {
        // Client 本身沒有 W；其他節點過載時 W 為 null，整條路徑都沒有穩態延遲
        Double own = node instanceof ClientNode ? Double.valueOf(0) : nodeResults.get(node.id()).avgLatencyMs();
        if (own == null) {
            return null;
        }
        List<Edge> edges = graph.outgoing(node.id());
        double totalWeight = edges.stream().mapToDouble(Edge::weight).sum();
        boolean parallel = node instanceof ServiceNode service && service.callMode() == CallMode.PARALLEL;
        double downstream = 0;
        for (Edge edge : edges) {
            // 一個請求平均走這條邊幾次
            double visits = switch (node) {
                case ClientNode client -> edge.weight() / totalWeight;
                case LoadBalancerNode lb -> edge.weight() / totalWeight;
                case ServiceNode service -> edge.callsPerRequest();
                case CacheNode cache -> read ? 1 - cache.hitRatio() : 1;
                case DatabaseNode database -> 0;
            };
            // 不會走到的下游（weight 0、read 全部命中）過載也不影響這個 class
            if (visits == 0) {
                continue;
            }
            Double child = latencies.get(edge.target()).of(read);
            if (child == null) {
                return null;
            }
            double cost = visits * (edge.latencyMs() * 2 + child);
            downstream = parallel ? Math.max(downstream, cost) : downstream + cost;
        }
        return own + downstream;
    }

    private static Summary summarize(Topology topology, Map<String, NodeResult> nodeResults) {
        double offered = 0;
        List<NodeResult> clients = new ArrayList<>();
        String bottleneck = null;
        double highest = Double.NEGATIVE_INFINITY;
        for (Node node : topology.nodes()) {
            if (node instanceof ClientNode client) {
                offered += client.rps();
                clients.add(nodeResults.get(node.id()));
            }
            Double utilization = nodeResults.get(node.id()).utilization();
            if (utilization != null && utilization > highest) {
                highest = utilization;
                bottleneck = node.id();
            }
        }
        var avgEndToEnd = new ClassLatencies(averageEndToEnd(clients, true), averageEndToEnd(clients, false));
        return new Summary(offered, avgEndToEnd, bottleneck);
    }

    /** 各 Client 依該 class 的請求數加權；任一 Client 為 null 或沒有該 class 的流量時為 null（spec 4.3）。 */
    private static Double averageEndToEnd(List<NodeResult> clients, boolean read) {
        double weighted = 0;
        double requests = 0;
        for (NodeResult client : clients) {
            double rps = read ? client.arrivalRps().read() : client.arrivalRps().write();
            // 權重為 0 的 Client 不影響平均，和 latency() 略過不會走到的下游一致
            if (rps == 0) {
                continue;
            }
            Double latency = client.endToEndMs().of(read);
            if (latency == null) {
                return null;
            }
            weighted += rps * latency;
            requests += rps;
        }
        return requests > 0 ? weighted / requests : null;
    }

    private static Map<String, NodeResult> inNodeOrder(Topology topology, Map<String, NodeResult> results) {
        Map<String, NodeResult> ordered = new LinkedHashMap<>();
        topology.nodes().forEach(node -> ordered.put(node.id(), results.get(node.id())));
        return ordered;
    }

    private static Map<String, EdgeResult> inEdgeOrder(Topology topology, Map<String, EdgeResult> results) {
        Map<String, EdgeResult> ordered = new LinkedHashMap<>();
        topology.edges().forEach(edge -> ordered.put(edge.id(), results.get(edge.id())));
        return ordered;
    }
}
