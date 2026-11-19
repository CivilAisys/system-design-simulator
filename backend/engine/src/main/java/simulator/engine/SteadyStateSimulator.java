package simulator.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 階段一的穩態計算：先驗證拓撲（有錯誤就不計算），每個節點視為 M/M/c，依拓撲排序由上游往下游計算流量，
 * 再由下游往上游計算端到端延遲與成功率。
 */
public final class SteadyStateSimulator implements Simulator {

    private static final double RATIO_TOLERANCE = 1e-9;
    private static final double SECONDS_PER_DAY = 86_400;
    // 磁碟容量用十進位的 GB
    private static final double BYTES_PER_GB = 1e9;

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
        Map<String, Double> readBytesPerSec = new HashMap<>();
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
                case CachingNode cache -> process(cache.capacityParams(), cache.hotShare(), arrival, node.id(),
                        nodeResults);
                case StorageNode storage -> process(storage.capacityParams(), arrival, node.id(), nodeResults);
                case RateLimiterNode limiter -> admit(node.id(), limiter.limitRps(), 0, Status.LIMITING,
                        Status.NOT_LIMITING, arrival, nodeResults);
                case ReadReplicaNode replica -> replicate(replica, graph.primaryOf(replica.id()), arrival, nodeResults);
                case MessageQueueNode queue -> process(queue.capacityParams(), arrival, node.id(), nodeResults);
                case ExternalApiNode api -> admit(node.id(), api.quotaRps(), api.latencyMs(), Status.OVER_QUOTA,
                        Status.WITHIN_QUOTA, arrival, nodeResults);
            };
            double bytesPerRead = node instanceof ClientNode client
                    ? client.readResponseBytes()
                    : arrival.read() > 0 ? readBytesPerSec.getOrDefault(node.id(), 0.0) / arrival.read() : 0;
            if (node instanceof CdnNode cdn) {
                cdnOffload += processed.read() * cdn.hitRatio() * bytesPerRead;
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
                readBytesPerSec.merge(edge.target(), rps.read() * bytesPerRead, Double::sum);
                arrivals.merge(edge.target(), rps, ClassRates::plus);
                if (graph.feedsConsumer(edge)) {
                    queuedByConsumer.computeIfAbsent(edge.target(), id -> new ArrayList<>()).add(edge);
                }
            }
        }

        var endToEnd = new EndToEndLatencies(topology, graph, order, nodeResults);
        var success = new SuccessRates(graph, order, nodeResults);
        queuedByConsumer.forEach((id, queued) -> keepInQueue(id, queued, success, nodeResults, edgeResults));
        sentByClient.forEach((id, sent) -> nodeResults.put(id,
                NodeResult.client(sent, success.client(id, sent), endToEnd.client(id, sent))));

        return new SimulationResult(true, List.of(), inNodeOrder(topology, nodeResults),
                inEdgeOrder(topology, edgeResults), summarize(topology, graph, nodeResults, endToEnd, bandwidth,
                        Math.min(cdnOffload, bandwidth.egressBytesPerSec())),
                estimateStorage(topology, graph, nodeResults),
                Explanations.of(topology, graph, nodeResults, edgeResults, success, endToEnd));
    }

    private static ClassRates process(CapacityParams params, ClassRates arrival, String nodeId,
            Map<String, NodeResult> nodeResults) {
        return process(params, null, arrival, nodeId, nodeResults);
    }

    private static ClassRates process(CapacityParams params, Double hotShare, ClassRates arrival, String nodeId,
            Map<String, NodeResult> nodeResults) {
        var outcome = MmcQueue.solve(params, hotShare, arrival);
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
     * 沒有完整處理成功的訊息留在 queue 裡，不算丟棄（spec 4.2.4），記成 Message Queue 送來那條邊的 backlog 成長率：
     * <ul>
     *   <li>consumer 處理不完：超過容量的部分依到達量的比例分給各條邊，Message Queue 送來的那份從節點的丟棄量扣掉，
     *       同步送來的那份照常丟棄。處理量不變（容量），往下游送的流量也不變。</li>
     *   <li>consumer 處理了、但下游失敗：處理量 × (1 − 下游的成功率)，以訊息數計算（fan-out 不放大）。
     *       下游節點的丟棄照常顯示。</li>
     * </ul>
     */
    private static void keepInQueue(String nodeId, List<Edge> queued, SuccessRates success,
            Map<String, NodeResult> nodeResults, Map<String, EdgeResult> edgeResults) {
        NodeResult result = nodeResults.get(nodeId);
        double arrival = result.arrivalRps().total();
        double excessShare = arrival > 0 ? result.droppedRps() / arrival : 0;
        double failedRead = success.failedDownstreamShare(nodeId, true);
        double failedWrite = success.failedDownstreamShare(nodeId, false);
        double excess = 0;
        double backlog = 0;
        for (Edge edge : queued) {
            EdgeResult edgeResult = edgeResults.get(edge.id());
            ClassRates rps = edgeResult.rps();
            double edgeExcess = rps.total() * excessShare;
            double edgeBacklog = edgeExcess + rps.read() * failedRead + rps.write() * failedWrite;
            edgeResults.put(edge.id(), edgeResult.withBacklog(edgeBacklog));
            excess += edgeExcess;
            backlog += edgeBacklog;
        }
        if (backlog > 0) {
            nodeResults.put(nodeId, result.withDropped(result.droppedRps() - excess)
                    .withWarning(NodeWarning.BACKLOG));
        }
    }

    /**
     * Read Replica（spec 4.2.3）：write 到達率是 primary 處理完的寫入，再加上 Service 送來的 read。
     * 過載時丟棄量依比例分給 read 和複製寫入，丟到複製寫入就加上 REPLICATION_LAG 警告。
     */
    private static ClassRates replicate(ReadReplicaNode replica, DatabaseNode primary, ClassRates arrival,
            Map<String, NodeResult> nodeResults) {
        // 未連線的 replica 沒有 primary（spec 4.5），沒有複製寫入
        double replicated = 0;
        if (primary != null) {
            NodeResult primaryResult = nodeResults.get(primary.id());
            replicated = processedWrites(primaryResult.arrivalRps(), primaryResult.throughputRps());
        }
        MmcQueue.Outcome outcome = MmcQueue.solve(replica.capacityParams(), arrival);
        NodeResult result = outcome.result();
        boolean lagging = replicated > 0 && result.droppedRps() > 0;
        nodeResults.put(replica.id(), lagging ? result.withWarning(NodeWarning.REPLICATION_LAG) : result);
        return outcome.processed();
    }

    /**
     * 儲存量估算（spec 4.8）：每日增量 = 處理完的 write × bytesPerWrite × 86,400，總量 = 每日增量 × retentionDays，
     * 含副本 = 總量 × (1 + Read Replica 數)，每台 = 總量 ÷ instances（資料平均分布在處理流量的機器上）。
     */
    private static Map<String, StorageEstimate> estimateStorage(Topology topology, TopologyGraph graph,
            Map<String, NodeResult> nodeResults) {
        Map<String, Integer> replicas = new HashMap<>();
        Set<String> lagging = new HashSet<>();
        for (Node node : topology.nodes()) {
            // 未連線的 replica 沒有 primary，不算進任何 Database 的副本
            DatabaseNode primaryNode = node instanceof ReadReplicaNode ? graph.primaryOf(node.id()) : null;
            if (primaryNode != null) {
                String primary = primaryNode.id();
                replicas.merge(primary, 1, Integer::sum);
                if (nodeResults.get(node.id()).warnings().contains(NodeWarning.REPLICATION_LAG)) {
                    lagging.add(primary);
                }
            }
        }
        Map<String, StorageEstimate> estimates = new LinkedHashMap<>();
        for (Node node : topology.nodes()) {
            if (!(node instanceof StorageNode storage)) {
                continue;
            }
            NodeResult result = nodeResults.get(node.id());
            StorageSizing sizing = storage.sizing();
            double daily = processedWrites(result.arrivalRps(), result.throughputRps()) * sizing.bytesPerWrite()
                    * SECONDS_PER_DAY;
            double total = daily * sizing.retentionDays();
            int replicaCount = replicas.getOrDefault(node.id(), 0);
            // 資料平均分布在處理流量的機器上
            int instances = storage.capacityParams().instances();
            double dailyPerInstance = daily / instances;
            Double daysUntilFull = sizing.diskGbPerInstance() == null ? null
                    : finiteOrNull(sizing.diskGbPerInstance() * BYTES_PER_GB / dailyPerInstance);
            boolean fillsDisk = daysUntilFull != null && daysUntilFull < sizing.retentionDays();
            estimates.put(node.id(), new StorageEstimate(daily, total, replicaCount, total * (1 + replicaCount),
                    lagging.contains(node.id()), total / instances, daysUntilFull, fillsDisk, sizing.retentionDays(), sizing.diskGbPerInstance()));
        }
        return estimates;
    }

    /** 沒有寫入（除以 0）或寫入量極小時天數不是有限值，JSON 放不下，當成不會滿。 */
    private static Double finiteOrNull(double days) {
        return Double.isFinite(days) ? days : null;
    }

    /** 處理完的 write：丟棄依 read／write 比例發生（spec 4.2）。 */
    private static double processedWrites(ClassRates arrival, double throughput) {
        double total = arrival.total();
        return total > 0 ? arrival.write() * throughput / total : 0;
    }

    private static Summary summarize(Topology topology, TopologyGraph graph, Map<String, NodeResult> nodeResults,
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
            // 未連線的節點不在拓撲裡，不當瓶頸（spec 4.4）
            if (utilization != null && utilization > highest && !graph.isUnconnected(node.id())) {
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
