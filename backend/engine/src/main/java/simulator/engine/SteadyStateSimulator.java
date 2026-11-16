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
        // consumer → Message Queue 送給它的邊
        Map<String, List<Edge>> queuedByConsumer = new HashMap<>();
        // 每個節點收到的 read 對應的回應大小總和（bytes/s），用來算 CDN 擋掉多少 origin 頻寬（spec 4.7）
        Map<String, Double> readBytes = new HashMap<>();
        var bandwidth = Bandwidth.ZERO;
        double cdnOffload = 0;
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
                case ReadReplicaNode replica -> replicate(replica, graph.primaryOf(replica.id()), arrival, nodeResults);
                case MessageQueueNode queue -> process(queue.capacityParams(), arrival, node.id(), nodeResults);
                case ExternalApiNode api -> admit(node.id(), api.quotaRps(), api.latencyMs(), Status.OVER_QUOTA,
                        Status.WITHIN_QUOTA, arrival, nodeResults);
            };
            double bytesPerRead = node instanceof ClientNode client
                    ? client.readResponseBytes()
                    : arrival.read() > 0 ? readBytes.getOrDefault(node.id(), 0.0) / arrival.read() : 0;
            if (node instanceof CdnNode cdn) {
                cdnOffload += processed.read() * cdn.hitRatio() * bytesPerRead;
            }
            List<Edge> queued = queuedByConsumer.getOrDefault(node.id(), List.of());
            if (!queued.isEmpty()) {
                keepInQueue(node.id(), queued, nodeResults, edgeResults);
            }

            for (Edge edge : graph.outgoing(node.id())) {
                var rps = new ClassRates(processed.read() * graph.visits(edge, true),
                        processed.write() * graph.visits(edge, false));
                if (node instanceof ClientNode client) {
                    var edgeBandwidth = new Bandwidth(rps.read() * client.readResponseBytes(),
                            rps.write() * client.writeRequestBytes());
                    bandwidth = bandwidth.plus(edgeBandwidth);
                    edgeResults.put(edge.id(), new EdgeResult(rps, 0, edgeBandwidth));
                } else {
                    edgeResults.put(edge.id(), new EdgeResult(rps));
                }
                readBytes.merge(edge.target(), rps.read() * bytesPerRead, Double::sum);
                arrivals.merge(edge.target(), rps, ClassRates::plus);
                if (graph.feedsConsumer(edge)) {
                    queuedByConsumer.computeIfAbsent(edge.target(), id -> new ArrayList<>()).add(edge);
                }
            }
        }

        var endToEnd = new EndToEndLatencies(topology, graph, order, nodeResults);
        var success = new SuccessRates(graph, order, nodeResults);
        sentByClient.forEach((id, sent) -> nodeResults.put(id,
                NodeResult.client(sent, success.client(id, sent), endToEnd.client(id, sent))));

        return new SimulationResult(true, List.of(), inNodeOrder(topology, nodeResults),
                inEdgeOrder(topology, edgeResults), summarize(topology, nodeResults, endToEnd, bandwidth,
                        Math.min(cdnOffload, bandwidth.egressBytesPerSec())));
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
                null, null, 0.0, latencyMs, exceeded ? over : within, null,
                List.of()));
        return passed;
    }

    /**
     * consumer 處理不完的訊息留在 queue 裡，不算丟棄（spec 4.2.4）：超過容量的部分依到達量的比例分給各條邊，
     * Message Queue 送來的那份記成那條邊的 backlog 成長率，從節點的丟棄量扣掉；同步送來的那份照常丟棄。
     * 處理量不變（容量），往下游送的流量也不變。
     */
    private static void keepInQueue(String nodeId, List<Edge> queued, Map<String, NodeResult> nodeResults,
            Map<String, EdgeResult> edgeResults) {
        NodeResult result = nodeResults.get(nodeId);
        double arrival = result.arrivalRps().total();
        if (result.droppedRps() <= 0 || arrival <= 0) {
            return;
        }
        double excessShare = result.droppedRps() / arrival;
        double backlog = 0;
        for (Edge edge : queued) {
            EdgeResult edgeResult = edgeResults.get(edge.id());
            double edgeBacklog = edgeResult.rps().total() * excessShare;
            edgeResults.put(edge.id(), edgeResult.withBacklog(edgeBacklog));
            backlog += edgeBacklog;
        }
        nodeResults.put(nodeId, result.withDropped(result.droppedRps() - backlog).withWarning(NodeWarning.BACKLOG));
    }

    /**
     * Read Replica（spec 4.2.3）：write 到達率是 primary 處理完的寫入，再加上 Service 送來的 read。
     * primary 分片時沿用它的配置：第 i 個 shard 收到 primary 第 i 個 shard 的複製寫入，加上分到第 i 個 shard 的 read。
     * 過載時丟棄量依比例分給 read 和複製寫入，丟到複製寫入就加上 REPLICATION_LAG 警告。
     */
    private static ClassRates replicate(ReadReplicaNode replica, DatabaseNode primary, ClassRates arrival,
            Map<String, NodeResult> nodeResults) {
        NodeResult primaryResult = nodeResults.get(primary.id());
        double replicated = processedWrites(primaryResult.arrivalRps(), primaryResult.throughputRps());
        // Service 直接送來的部分（通常只有 read）
        var direct = new ClassRates(arrival.read(), arrival.write() - replicated);
        ShardLayout layout = primary.shards();
        MmcQueue.Outcome outcome;
        boolean lagging;
        if (layout.count() == 1) {
            outcome = MmcQueue.solve(replica.capacityParams(), arrival);
            lagging = replicated > 0 && outcome.result().droppedRps() > 0;
        } else {
            ShardResult hot = primaryResult.shards().get(0);
            ShardResult other = primaryResult.shards().get(1);
            double hotWrites = processedWrites(hot.arrivalRps(), hot.throughputRps());
            double otherWrites = processedWrites(other.arrivalRps(), other.throughputRps());
            outcome = MmcQueue.solve(replica.capacityParams(), layout.count(),
                    direct.times(layout.hottestShare()).plus(new ClassRates(0, hotWrites)),
                    direct.times(layout.otherShare()).plus(new ClassRates(0, otherWrites)));
            List<ShardResult> shards = outcome.result().shards();
            lagging = (hotWrites > 0 && shards.get(0).droppedRps() > 0)
                    || (otherWrites > 0 && shards.get(1).droppedRps() > 0);
        }
        NodeResult result = outcome.result();
        nodeResults.put(replica.id(), lagging ? result.withWarning(NodeWarning.REPLICATION_LAG) : result);
        return outcome.processed();
    }

    /** 處理完的 write：丟棄依 read／write 比例發生（spec 4.2）。 */
    private static double processedWrites(ClassRates arrival, double throughput) {
        double total = arrival.total();
        return total > 0 ? arrival.write() * throughput / total : 0;
    }

    private static Summary summarize(Topology topology, Map<String, NodeResult> nodeResults,
            EndToEndLatencies endToEnd, Bandwidth bandwidth, double cdnOffload) {
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
        return new Summary(offered, succeeded, rejected, dropRate, endToEnd.average(clients), bottleneck,
                bandwidth, cdnOffload);
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
