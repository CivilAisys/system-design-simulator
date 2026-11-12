package io.github.civilaisys.sds.engine;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** v1 的穩態計算：每個節點視為 M/M/c，依拓撲排序由上游往下游計算流量。 */
public final class SteadyStateSimulator implements Simulator {

    @Override
    public SimulationResult simulate(Topology topology) {
        Map<String, List<Edge>> outgoing = new HashMap<>();
        Map<String, ClassRates> arrivals = new HashMap<>();
        for (Node node : topology.nodes()) {
            outgoing.put(node.id(), new ArrayList<>());
            arrivals.put(node.id(), ClassRates.ZERO);
        }
        for (Edge edge : topology.edges()) {
            outgoing.get(edge.source()).add(edge);
        }

        Map<String, NodeResult> nodeResults = new HashMap<>();
        Map<String, EdgeResult> edgeResults = new HashMap<>();
        for (Node node : topologicalOrder(topology)) {
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

            List<Edge> edges = outgoing.get(node.id());
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

    /** Kahn's algorithm，同層依輸入順序，讓結果可重現。 */
    private static List<Node> topologicalOrder(Topology topology) {
        Map<String, Node> byId = new LinkedHashMap<>();
        Map<String, Integer> inDegree = new HashMap<>();
        for (Node node : topology.nodes()) {
            byId.put(node.id(), node);
            inDegree.put(node.id(), 0);
        }
        Map<String, List<String>> targets = new HashMap<>();
        for (Edge edge : topology.edges()) {
            if (!byId.containsKey(edge.source()) || !byId.containsKey(edge.target())) {
                throw new IllegalArgumentException("Edge " + edge.id() + " references an unknown node");
            }
            targets.computeIfAbsent(edge.source(), id -> new ArrayList<>()).add(edge.target());
            inDegree.merge(edge.target(), 1, Integer::sum);
        }

        var ready = new ArrayDeque<String>();
        byId.keySet().stream().filter(id -> inDegree.get(id) == 0).forEach(ready::add);
        List<Node> order = new ArrayList<>();
        while (!ready.isEmpty()) {
            String id = ready.poll();
            order.add(byId.get(id));
            for (String target : targets.getOrDefault(id, List.of())) {
                if (inDegree.merge(target, -1, Integer::sum) == 0) {
                    ready.add(target);
                }
            }
        }
        if (order.size() != byId.size()) {
            throw new IllegalArgumentException("Topology contains a cycle");
        }
        return order;
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
