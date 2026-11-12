package simulator.engine;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** v1 的穩態計算：每個節點視為 M/M/c，依拓撲排序由上游往下游計算流量。 */
public final class SteadyStateSimulator implements Simulator {

    @Override
    public SimulationResult simulate(Topology topology) {
        var graph = TopologyGraph.of(topology);
        Map<String, ClassRates> arrivals = new HashMap<>();
        topology.nodes().forEach(node -> arrivals.put(node.id(), ClassRates.ZERO));

        Map<String, NodeResult> nodeResults = new HashMap<>();
        Map<String, EdgeResult> edgeResults = new HashMap<>();
        for (Node node : graph.topologicalOrder()) {
            ClassRates arrival = arrivals.get(node.id());
            ClassRates processed = switch (node) {
                case ClientNode client -> {
                    double read = client.rps() * client.readRatio();
                    var sent = new ClassRates(read, client.rps() - read);
                    nodeResults.put(node.id(), NodeResult.client(sent));
                    yield sent;
                }
                case ServiceNode service -> process(service.capacity(), arrival, node.id(), nodeResults);
                case DatabaseNode database -> process(database.capacity(), arrival, node.id(), nodeResults);
            };

            List<Edge> edges = graph.outgoing(node.id());
            double totalWeight = edges.stream().mapToDouble(Edge::weight).sum();
            for (Edge edge : edges) {
                ClassRates rps = switch (node) {
                    case ClientNode client -> processed.times(edge.weight() / totalWeight);
                    case ServiceNode service -> processed.times(edge.callsPerRequest());
                    case DatabaseNode database -> ClassRates.ZERO;
                };
                edgeResults.put(edge.id(), new EdgeResult(rps));
                arrivals.merge(edge.target(), rps, ClassRates::plus);
            }
        }

        return new SimulationResult(true, List.of(), inNodeOrder(topology, nodeResults),
                inEdgeOrder(topology, edgeResults), summarize(topology, nodeResults));
    }

    private static ClassRates process(Capacity capacity, ClassRates arrival, String nodeId,
            Map<String, NodeResult> nodeResults) {
        var outcome = MmcQueue.solve(capacity, arrival);
        nodeResults.put(nodeId, outcome.result());
        return outcome.processed();
    }

    private static Summary summarize(Topology topology, Map<String, NodeResult> nodeResults) {
        double offered = 0;
        String bottleneck = null;
        double highest = Double.NEGATIVE_INFINITY;
        for (Node node : topology.nodes()) {
            if (node instanceof ClientNode client) {
                offered += client.rps();
            }
            Double utilization = nodeResults.get(node.id()).utilization();
            if (utilization != null && utilization > highest) {
                highest = utilization;
                bottleneck = node.id();
            }
        }
        return new Summary(offered, bottleneck);
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
