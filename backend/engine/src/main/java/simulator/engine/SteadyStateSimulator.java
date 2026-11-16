package simulator.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 階段一的穩態計算：先驗證拓撲（有錯誤就不計算），每個節點視為 M/M/c，依拓撲排序由上游往下游計算流量，
 * 再由下游往上游計算端到端延遲與成功率。
 */
public final class SteadyStateSimulator implements Simulator {

    private static final double RATIO_TOLERANCE = 1e-9;

    @Override
    public SimulationResult simulate(Topology topology) {
        var graph = TopologyGraph.of(topology);
        List<ValidationError> errors = TopologyValidator.validate(topology, graph);
        if (!errors.isEmpty()) {
            return SimulationResult.invalid(errors);
        }
        Map<String, ClassRates> arrivals = new HashMap<>();
        topology.nodes().forEach(node -> arrivals.put(node.id(), ClassRates.ZERO));

        Map<String, NodeResult> nodeResults = new HashMap<>();
        Map<String, EdgeResult> edgeResults = new HashMap<>();
        // Client 的結果要等端到端延遲與成功率算完才能建立
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
                case CachingNode cache -> process(cache.capacityParams(), cache.shards(), arrival, node.id(),
                        nodeResults);
                case StorageNode storage -> process(storage.capacityParams(), storage.shards(), arrival, node.id(),
                        nodeResults);
                case RateLimiterNode limiter -> admit(node.id(), limiter.limitRps(), 0, Status.LIMITING,
                        Status.NOT_LIMITING, arrival, nodeResults);
                case ExternalApiNode api -> admit(node.id(), api.quotaRps(), api.latencyMs(), Status.OVER_QUOTA,
                        Status.WITHIN_QUOTA, arrival, nodeResults);
            };

            for (Edge edge : graph.outgoing(node.id())) {
                var rps = new ClassRates(processed.read() * graph.visits(edge, true),
                        processed.write() * graph.visits(edge, false));
                edgeResults.put(edge.id(), new EdgeResult(rps));
                arrivals.merge(edge.target(), rps, ClassRates::plus);
            }
        }

        var endToEnd = new EndToEndLatencies(topology, graph, order, nodeResults);
        var success = new SuccessRates(graph, order, nodeResults);
        sentByClient.forEach((id, sent) -> nodeResults.put(id,
                NodeResult.client(sent, success.client(id, sent), endToEnd.client(id, sent))));

        return new SimulationResult(true, List.of(), inNodeOrder(topology, nodeResults),
                inEdgeOrder(topology, edgeResults), summarize(topology, nodeResults, endToEnd));
    }

    private static ClassRates process(CapacityParams params, ClassRates arrival, String nodeId,
            Map<String, NodeResult> nodeResults) {
        return process(params, ShardLayout.SINGLE, arrival, nodeId, nodeResults);
    }

    private static ClassRates process(CapacityParams params, ShardLayout shards, ClassRates arrival, String nodeId,
            Map<String, NodeResult> nodeResults) {
        var outcome = MmcQueue.solve(params, shards, arrival);
        nodeResults.put(nodeId, outcome.result());
        return outcome.processed();
    }

    /**
     * 放行 min(λ, limit)，read／write 依比例放行，其餘拒絕（spec 4.2.1）。Rate Limiter 和 External API 共用。
     * 沒有 M/M/c：沒有容量和 ρ，節點延遲固定是 {@code latencyMs}。
     */
    private static ClassRates admit(String nodeId, double limit, double latencyMs, Status over, Status within,
            ClassRates arrival, Map<String, NodeResult> nodeResults) {
        double lambda = arrival.total();
        boolean exceeded = lambda > limit;
        ClassRates passed = exceeded ? arrival.times(limit / lambda) : arrival;
        nodeResults.put(nodeId, new NodeResult(arrival, passed.total(), 0, lambda - passed.total(), null, null,
                null, null, 0.0, latencyMs, exceeded ? over : within, null));
        return passed;
    }

    private static Summary summarize(Topology topology, Map<String, NodeResult> nodeResults,
            EndToEndLatencies endToEnd) {
        double offered = 0;
        double succeeded = 0;
        double rejected = 0;
        List<NodeResult> clients = new ArrayList<>();
        String bottleneck = null;
        double highest = Double.NEGATIVE_INFINITY;
        for (Node node : topology.nodes()) {
            if (node instanceof ClientNode client) {
                NodeResult result = nodeResults.get(node.id());
                offered += client.rps();
                succeeded += result.successRps();
                clients.add(result);
            }
            rejected += nodeResults.get(node.id()).rejectedRps();
            Double utilization = nodeResults.get(node.id()).utilization();
            if (utilization != null && utilization > highest) {
                highest = utilization;
                bottleneck = node.id();
            }
        }
        // 沒有流量時沒有東西被丟
        double dropRate = offered > 0 ? cleanRatio(1 - succeeded / offered) : 0;
        return new Summary(offered, succeeded, rejected, dropRate, endToEnd.average(clients), bottleneck);
    }

    /**
     * 浮點誤差會讓健康的拓撲有極小的 drop rate（例如 7 條同權重的邊，比例加起來是 0.9999999999999998），
     * 前端會把它顯示成紅字的 0.0% 或 -0.0%。接近 0 的值歸零，並限制在 [0, 1]。
     */
    private static double cleanRatio(double ratio) {
        return Math.abs(ratio) < RATIO_TOLERANCE ? 0 : Math.clamp(ratio, 0, 1);
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
