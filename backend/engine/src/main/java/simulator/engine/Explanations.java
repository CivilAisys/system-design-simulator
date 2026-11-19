package simulator.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 計算說明（spec 4.9）：替每個節點列出計算步驟，讓每個數字都能解釋。
 * 步驟的結果直接取自同一次計算的 {@link NodeResult}、{@link SuccessRates}、{@link EndToEndLatencies}，
 * 中間值（c、μ、Erlang C 等）用同一組函式重算。每個節點只說明自己這一層：上下游的數字當作代入值，
 * 用 {@link ExplanationTerm#nodeId()} 指到那個節點。未連線的節點（spec 4.5）沒有步驟。
 */
final class Explanations {

    private static final String RPS = "rps";
    private static final String MS = "ms";
    // 0–1 的比例，前端顯示成百分比
    private static final String PERCENT = "%";
    // read、write 兩個 request class
    private static final boolean[] CLASSES = {true, false};
    // 1 − Σ visits 的浮點誤差（例如 7 條同權重的邊），小於它就當成沒有命中
    private static final double TOLERANCE = 1e-9;

    private static final String SENT = "送出";
    private static final String ARRIVAL = "到達量";
    private static final String CAPACITY = "容量與使用率";
    private static final String LATENCY = "節點延遲";
    private static final String OVERLOAD = "過載";
    private static final String WHOLE_NODE = "整個節點";
    private static final String HOTTEST = "最熱那台";
    private static final String DOWNSTREAM = "往下游";
    private static final String LIMIT = "限流";
    private static final String QUOTA = "配額";
    private static final String REPLICATION = "複製";
    private static final String BACKLOG = "Message Queue 積壓";
    private static final String SUCCESS = "成功率";
    private static final String END_TO_END = "端到端延遲";

    private final TopologyGraph graph;
    private final Map<String, NodeResult> nodes;
    private final Map<String, EdgeResult> edges;
    private final SuccessRates success;
    private final EndToEndLatencies endToEnd;
    // 連進每個節點的邊，依輸入順序
    private final Map<String, List<Edge>> incoming = new HashMap<>();

    private Explanations(Topology topology, TopologyGraph graph, Map<String, NodeResult> nodes,
            Map<String, EdgeResult> edges, SuccessRates success, EndToEndLatencies endToEnd) {
        this.graph = graph;
        this.nodes = nodes;
        this.edges = edges;
        this.success = success;
        this.endToEnd = endToEnd;
        for (Edge edge : topology.edges()) {
            if (graph.contains(edge.source()) && graph.contains(edge.target())) {
                incoming.computeIfAbsent(edge.target(), id -> new ArrayList<>()).add(edge);
            }
        }
    }

    /** 每個節點的步驟，以節點 id 為 key，順序與輸入相同。{@code nodes} 要是最後的結果（含 Client 和 backlog）。 */
    static Map<String, List<ExplanationStep>> of(Topology topology, TopologyGraph graph, Map<String, NodeResult> nodes,
            Map<String, EdgeResult> edges, SuccessRates success, EndToEndLatencies endToEnd) {
        var explanations = new Explanations(topology, graph, nodes, edges, success, endToEnd);
        Map<String, List<ExplanationStep>> all = new LinkedHashMap<>();
        for (Node node : topology.nodes()) {
            all.put(node.id(), graph.isUnconnected(node.id()) ? List.of() : explanations.explain(node));
        }
        return all;
    }

    private List<ExplanationStep> explain(Node node) {
        var steps = new ArrayList<ExplanationStep>();
        NodeResult result = nodes.get(node.id());
        if (node instanceof ClientNode client) {
            sent(client, result, steps);
        } else {
            arrival(node, result, steps);
        }
        switch (node) {
            case ClientNode client -> {
            }
            case LoadBalancerNode lb -> queue(lb.capacityParams(), result, steps);
            case ServiceNode service -> queue(service.capacityParams(), result, steps);
            case CachingNode cache -> {
                if (cache.hotShare() == null) {
                    queue(cache.capacityParams(), result, steps);
                } else {
                    hotSpot(cache, result, steps);
                }
                miss(cache, result, steps);
            }
            case StorageNode storage -> queue(storage.capacityParams(), result, steps);
            case ReadReplicaNode replica -> {
                queue(replica.capacityParams(), result, steps);
                replication(replica, result, steps);
            }
            case MessageQueueNode queue -> queue(queue.capacityParams(), result, steps);
            case RateLimiterNode limiter -> {
                admit(LIMIT, "limitRps", limiter.limitRps(), result, steps);
                steps.add(step(LIMIT, "節點延遲 W", "假設 Rate Limiter 本身不會成為瓶頸，記為 0", result.avgLatencyMs(), MS));
            }
            case ExternalApiNode api -> {
                admit(QUOTA, "quotaRps", api.quotaRps(), result, steps);
                steps.add(step(QUOTA, "節點延遲 W", "{latencyMs}（固定）", result.avgLatencyMs(), MS,
                        term("latencyMs", api.latencyMs(), MS)));
            }
        }
        if (result.warnings().contains(NodeWarning.BACKLOG)) {
            backlog(node, result, steps);
        }
        for (boolean read : CLASSES) {
            if (result.arrivalRps().of(read) > 0) {
                success(node, read, steps);
            }
        }
        if (node instanceof ClientNode) {
            successRps(node, result, steps);
        }
        for (boolean read : CLASSES) {
            if (result.arrivalRps().of(read) > 0) {
                latency(node, read, steps);
            }
        }
        return steps;
    }

    /** Client 送出的 read／write（spec 3.1）。 */
    private static void sent(ClientNode client, NodeResult result, List<ExplanationStep> steps) {
        steps.add(step(SENT, "read", "{rps} × {readRatio}", result.arrivalRps().read(), RPS,
                term("rps", client.rps(), RPS), term("readRatio", client.readRatio(), PERCENT)));
        steps.add(step(SENT, "write", "{rps} − {read}", result.arrivalRps().write(), RPS,
                term("rps", client.rps(), RPS), term("read", result.arrivalRps().read(), RPS)));
    }

    /** 各上游送來的量加總（spec 3.3、3.4）；每條邊的量是上游處理完的流量 × visits。 */
    private void arrival(Node node, NodeResult result, List<ExplanationStep> steps) {
        List<Edge> in = incoming.getOrDefault(node.id(), List.of());
        for (boolean read : CLASSES) {
            List<ExplanationTerm> terms = new ArrayList<>();
            List<String> parts = new ArrayList<>();
            for (int i = 0; i < in.size(); i++) {
                Edge edge = in.get(i);
                Node source = graph.node(edge.source());
                String x = "x" + subscript(i + 1);
                String v = "v" + subscript(i + 1);
                parts.add("{" + x + "} × {" + v + "}");
                terms.add(term(x, processed(nodes.get(source.id()), read), RPS, source.id()));
                terms.add(term(v, graph.visits(edge, read), visitsUnit(source)));
            }
            steps.add(step(ARRIVAL, className(read) + " 到達量 λ_" + className(read) + "（上游處理完的 × visits）",
                    parts.isEmpty() ? "0" : String.join(" + ", parts), result.arrivalRps().of(read), RPS, terms));
        }
        steps.add(step(ARRIVAL, "到達量 λ", "{λ_read} + {λ_write}", result.arrivalRps().total(), RPS,
                term("λ_read", result.arrivalRps().read(), RPS), term("λ_write", result.arrivalRps().write(), RPS)));
    }

    /**
     * 整個節點是一個 M/M/c（spec 4.2）。consumer 有 backlog 時，超過容量的部分有一部分留在 queue 裡，
     * 不全是丟棄（見 {@link #backlog}）。
     */
    private static void queue(CapacityParams params, NodeResult result, List<ExplanationStep> steps) {
        String excessLabel = result.warnings().contains(NodeWarning.BACKLOG) ? "超過容量" : "超過容量、丟棄";
        queue(CAPACITY, result.utilization() < 1 ? LATENCY : OVERLOAD, params, InstanceResult.of(result),
                result.avgQueueMs(), excessLabel, steps);
    }

    /**
     * 一個 M/M/c 的步驟：c、μ、容量、ρ 放在 {@code capacityGroup}；{@code latencyGroup} 在 ρ < 1 時是 Erlang C 和延遲，
     * 過載時是處理量和超過容量的部分（λ − c × μ）。
     */
    private static void queue(String capacityGroup, String latencyGroup, CapacityParams params, InstanceResult outcome,
            Double queueMs, String excessLabel, List<ExplanationStep> steps) {
        double lambda = outcome.arrivalRps().total();
        double utilization = outcome.utilization();
        double c = params.workers();
        double mu = params.serviceRate();
        steps.add(step(capacityGroup, "worker 數 c", "{instances} × {concurrency}", c, null,
                term("instances", (double) params.instances(), null),
                term("concurrency", (double) params.concurrency(), null)));
        steps.add(step(capacityGroup, "每個 worker 的服務率 μ", "1000 ÷ {serviceTimeMs}", mu, RPS,
                term("serviceTimeMs", params.serviceTimeMs(), MS)));
        steps.add(step(capacityGroup, "容量", "{c} × {μ}", params.capacityRps(), RPS,
                term("c", c, null), term("μ", mu, RPS)));
        steps.add(step(capacityGroup, "使用率 ρ（" + threshold(outcome.status()) + "）", "{λ} ÷ ({c} × {μ})", utilization, null,
                term("λ", lambda, RPS), term("c", c, null), term("μ", mu, RPS)));
        if (utilization < 1) {
            double load = lambda / mu;
            double waiting = MmcQueue.erlangC(params.workers(), load);
            steps.add(step(latencyGroup, "負載 a", "{λ} ÷ {μ}", load, null, term("λ", lambda, RPS), term("μ", mu, RPS)));
            steps.add(step(latencyGroup, "等待機率 P_wait", "ErlangC({c}, {a})", waiting, PERCENT,
                    term("c", c, null), term("a", load, null)));
            steps.add(step(latencyGroup, "平均排隊時間 Wq", "{P_wait} ÷ ({c} × {μ} − {λ}) × 1000", queueMs, MS,
                    term("P_wait", waiting, PERCENT), term("c", c, null), term("μ", mu, RPS),
                    term("λ", lambda, RPS)));
            steps.add(step(latencyGroup, "節點延遲 W", "{Wq} + {1/μ}", outcome.avgLatencyMs(), MS,
                    term("Wq", queueMs, MS), term("1/μ", params.serviceTimeMs(), MS)));
        } else {
            steps.add(step(latencyGroup, "處理量", "{c} × {μ}", params.capacityRps(), RPS,
                    term("c", c, null), term("μ", mu, RPS)));
            steps.add(step(latencyGroup, excessLabel, "{λ} − {容量}", overCapacity(outcome.arrivalRps(),
                    outcome.throughputRps()), RPS,
                    term("λ", lambda, RPS), term("容量", params.capacityRps(), RPS)));
            steps.add(step(latencyGroup, "節點延遲 W", "ρ ≥ 1 時佇列會無限成長，穩態下沒有定義", null, MS));
        }
    }

    /** 有熱點的 Cache（spec 4.2.2）：最熱的那台和其他台各是一個 M/M/c，節點取 ρ 較高的一邊。 */
    private static void hotSpot(CachingNode cache, NodeResult result, List<ExplanationStep> steps) {
        CapacityParams params = cache.capacityParams();
        double lambda = result.arrivalRps().total();
        double share = cache.hotShare();
        InstanceResult hot = result.hotSpot().hottest();
        InstanceResult others = result.hotSpot().others();
        String othersGroup = "其他 " + (params.instances() - 1) + " 台";
        instance(HOTTEST, "{λ} × {hotShare}", params.withInstances(1), lambda, share, hot, steps);
        instance(othersGroup, "{λ} × (1 − {hotShare})", params.withInstances(params.instances() - 1), lambda, share,
                others, steps);
        steps.add(step(WHOLE_NODE, "容量（全部 " + params.instances() + " 台）", "{c} × {μ}", result.capacityRps(), RPS,
                term("c", (double) params.workers(), null), term("μ", params.serviceRate(), RPS)));
        steps.add(step(WHOLE_NODE, "使用率 ρ（取較高的一邊，" + threshold(result.status()) + "）",
                "max({ρ_最熱}, {ρ_其他})", result.utilization(), null,
                term("ρ_最熱", hot.utilization(), null), term("ρ_其他", others.utilization(), null)));
        steps.add(step(WHOLE_NODE, "處理量", "{最熱} + {其他}", result.throughputRps(), RPS,
                term("最熱", hot.throughputRps(), RPS), term("其他", others.throughputRps(), RPS)));
        if (result.droppedRps() > 0) {
            steps.add(step(WHOLE_NODE, "丟棄量", "{最熱} + {其他}", result.droppedRps(), RPS,
                    term("最熱", hot.droppedRps(), RPS), term("其他", others.droppedRps(), RPS)));
        }
        weighted("平均排隊時間 Wq", "Wq", queueMs(params.withInstances(1), hot), hot,
                queueMs(params.withInstances(params.instances() - 1), others), others, lambda, result.avgQueueMs(),
                steps);
        weighted("節點延遲 W", "W", hot.avgLatencyMs(), hot, others.avgLatencyMs(), others, lambda,
                result.avgLatencyMs(), steps);
    }

    /** 整個節點的延遲依流量加權平均（spec 4.2.2）；有流量的一邊過載時沒有定義。 */
    private static void weighted(String label, String symbol, Double hotValue, InstanceResult hot, Double otherValue,
            InstanceResult others, double lambda, Double value, List<ExplanationStep> steps) {
        String hotSymbol = symbol + "_最熱";
        if (value == null) {
            steps.add(step(WHOLE_NODE, label, "有流量的一邊過載，穩態下沒有定義", null, MS));
        } else if (lambda <= 0) {
            steps.add(step(WHOLE_NODE, label, "{" + hotSymbol + "}（沒有流量時用最熱那台的值）", value, MS,
                    term(hotSymbol, hotValue, MS)));
        } else {
            String otherSymbol = symbol + "_其他";
            steps.add(step(WHOLE_NODE, label + "（依流量加權平均）",
                    "({" + hotSymbol + "} × {λ_最熱} + {" + otherSymbol + "} × {λ_其他}) ÷ {λ}", value, MS,
                    term(hotSymbol, hotValue, MS), term("λ_最熱", hot.arrivalRps().total(), RPS),
                    term(otherSymbol, otherValue, MS), term("λ_其他", others.arrivalRps().total(), RPS),
                    term("λ", lambda, RPS)));
        }
    }

    /** 一部分機器的平均排隊時間；過載時沒有定義。 */
    private static Double queueMs(CapacityParams params, InstanceResult instance) {
        return instance.utilization() < 1 ? MmcQueue.queueMs(params, instance.arrivalRps().total()) : null;
    }

    private static void instance(String group, String arrivalFormula, CapacityParams params, double lambda,
            double share, InstanceResult instance, List<ExplanationStep> steps) {
        steps.add(step(group, "到達量 λ", arrivalFormula, instance.arrivalRps().total(), RPS,
                term("λ", lambda, RPS), term("hotShare", share, PERCENT)));
        queue(group, group, params, instance, queueMs(params, instance), "超過容量、丟棄", steps);
    }

    /** Cache、CDN 只有沒命中的 read 往下送，write 全部往下送（spec 3.3）。 */
    private void miss(CachingNode cache, NodeResult result, List<ExplanationStep> steps) {
        double read = processed(result, true);
        if (read <= 0) {
            return;
        }
        steps.add(step(DOWNSTREAM, "沒命中、往下游送的 read", "{處理的 read} × (1 − {hitRatio})",
                read * (1 - cache.hitRatio()), RPS,
                term("處理的 read", read, RPS), term("hitRatio", cache.hitRatio(), PERCENT)));
    }

    /** Rate Limiter、External API 放行 min(λ, 上限)，其餘拒絕（spec 4.2.1）。 */
    private static void admit(String group, String limitName, double limit, NodeResult result,
            List<ExplanationStep> steps) {
        double lambda = result.arrivalRps().total();
        String comparison = lambda > limit ? "λ > " + limitName : "λ ≤ " + limitName;
        steps.add(step(group, "放行量", "min({λ}, {" + limitName + "})", result.throughputRps(), RPS,
                term("λ", lambda, RPS), term(limitName, limit, RPS)));
        steps.add(step(group, "拒絕量（" + comparison + "：" + admitLabel(result.status()) + "）", "{λ} − {放行量}",
                result.rejectedRps(), RPS, term("λ", lambda, RPS), term("放行量", result.throughputRps(), RPS)));
    }

    /**
     * Read Replica（spec 4.2.3）：primary 處理完的 write 全部複製過來；過載時丟棄量依比例落在複製寫入上。
     */
    private void replication(ReadReplicaNode replica, NodeResult result, List<ExplanationStep> steps) {
        for (Edge edge : incoming.getOrDefault(replica.id(), List.of())) {
            if (graph.isAsync(edge)) {
                double replicated = edges.get(edge.id()).rps().write();
                steps.add(step(REPLICATION, "複製寫入（primary 處理完的 write）", "{primary 的 write}", replicated, RPS,
                        term("primary 的 write", replicated, RPS, edge.source())));
            }
        }
        if (!result.warnings().contains(NodeWarning.REPLICATION_LAG)) {
            return;
        }
        ClassRates arrival = result.arrivalRps();
        steps.add(step(REPLICATION, "丟掉的複製寫入（replication lag 會持續增加）", "{丟棄量} × {λ_write} ÷ {λ}",
                result.droppedRps() * arrival.write() / arrival.total(), RPS,
                term("丟棄量", result.droppedRps(), RPS), term("λ_write", arrival.write(), RPS),
                term("λ", arrival.total(), RPS)));
    }

    /**
     * Message Queue 的 consumer（spec 4.2.4）：沒有完整處理成功的訊息留在 queue 裡，不算丟棄。
     * 每條 Message Queue 送來的邊：超過容量的部分依到達量的比例分配，再加上處理了、但下游失敗的部分。
     */
    private void backlog(Node node, NodeResult result, List<ExplanationStep> steps) {
        double lambda = result.arrivalRps().total();
        double excess = overCapacity(result.arrivalRps(), result.throughputRps());
        double excessShare = lambda > 0 ? excess / lambda : 0;
        double failedRead = success.failedDownstreamShare(node.id(), true);
        double failedWrite = success.failedDownstreamShare(node.id(), false);
        double kept = 0;
        for (Edge edge : incoming.getOrDefault(node.id(), List.of())) {
            if (!graph.feedsConsumer(edge)) {
                continue;
            }
            EdgeResult edgeResult = edges.get(edge.id());
            ClassRates rps = edgeResult.rps();
            kept += rps.total() * excessShare;
            steps.add(step(BACKLOG, "每秒留在 " + graph.node(edge.source()).name() + " 的訊息",
                    "{λ_q} × {超過容量的比例} + {λ_q,read} × {read 下游失敗} + {λ_q,write} × {write 下游失敗}",
                    edgeResult.backlogRps(), RPS,
                    term("λ_q", rps.total(), RPS, edge.source()), term("超過容量的比例", excessShare, PERCENT),
                    term("λ_q,read", rps.read(), RPS, edge.source()), term("read 下游失敗", failedRead, PERCENT),
                    term("λ_q,write", rps.write(), RPS, edge.source()), term("write 下游失敗", failedWrite, PERCENT)));
        }
        if (excess > 0) {
            steps.add(step(BACKLOG, "丟棄量（留在 queue 的不算）", "{超過容量} − {留在 queue}", result.droppedRps(), RPS,
                    term("超過容量", excess, RPS), term("留在 queue", kept, RPS)));
        }
    }

    /** S(n, class) = pass(n) × 下游完整成功的機率（spec 4.3.1）。 */
    private void success(Node node, boolean read, List<ExplanationStep> steps) {
        String cls = className(read);
        List<ExplanationTerm> terms = new ArrayList<>();
        String formula;
        if (node instanceof ClientNode) {
            formula = weightedSum(node, read, terms);
        } else {
            double pass = success.pass(node, read);
            NodeResult result = nodes.get(node.id());
            steps.add(step(SUCCESS, cls + " 通過率 pass", "{處理量} ÷ {λ}", pass, PERCENT,
                    term("處理量", result.throughputRps(), RPS), term("λ", result.arrivalRps().total(), RPS)));
            terms.add(term("pass", pass, PERCENT));
            formula = "{pass}" + switch (node) {
                case LoadBalancerNode lb -> " × (" + weightedSum(node, read, terms) + ")";
                case ServiceNode service -> product(node, read, terms);
                case CachingNode cache -> " × (" + cached(node, read, terms) + ")";
                case RateLimiterNode limiter -> product(node, read, terms);
                case StorageNode storage -> graph.outgoing(node.id()).isEmpty() ? "（沒有下游）"
                        : "（複製到 Read Replica 是非同步的，不影響成功率）";
                case ReadReplicaNode replica -> "（沒有下游）";
                case MessageQueueNode queue -> "（訊息進到 queue 就算成功，consumer 的處理是非同步的）";
                case ExternalApiNode api -> "（沒有下游）";
                case ClientNode client -> throw new IllegalStateException("Client has no pass rate");
            };
        }
        steps.add(step(SUCCESS, cls + " 成功率 S（從這裡開始到完整成功）", formula, success.of(node.id(), read), PERCENT,
                terms));
    }

    /** Client 每秒完整成功的請求數 = 各 class 送出量 × 成功率。 */
    private void successRps(Node client, NodeResult result, List<ExplanationStep> steps) {
        List<ExplanationTerm> terms = new ArrayList<>();
        List<String> parts = new ArrayList<>();
        for (boolean read : CLASSES) {
            double sent = result.arrivalRps().of(read);
            if (sent > 0) {
                String cls = className(read);
                parts.add("{" + cls + "} × {S_" + cls + "}");
                terms.add(term(cls, sent, RPS));
                terms.add(term("S_" + cls, success.of(client.id(), read), PERCENT));
            }
        }
        if (!parts.isEmpty()) {
            steps.add(step(SUCCESS, "每秒完整成功", String.join(" + ", parts), result.successRps(), RPS, terms));
        }
    }

    /**
     * L(n, class) = W(n) + 呼叫下游的時間（spec 4.3）：依序呼叫時加總，平行呼叫時取最大值，
     * 每個下游是 visits × (邊的延遲 + 下游的 L)。複製和 Message Queue 的 consumer 是非同步的，不在路徑上。
     */
    private void latency(Node node, boolean read, List<ExplanationStep> steps) {
        String cls = className(read);
        List<ExplanationTerm> terms = new ArrayList<>();
        List<String> calls = new ArrayList<>();
        boolean skippedAsync = false;
        int i = 0;
        for (Edge edge : graph.outgoing(node.id())) {
            double visits = graph.visits(edge, read);
            if (visits == 0) {
                continue;
            }
            if (graph.isAsync(edge)) {
                skippedAsync = true;
                continue;
            }
            i++;
            String v = "v" + subscript(i);
            String d = "d" + subscript(i);
            String l = "L" + subscript(i);
            calls.add("{" + v + "} × ({" + d + "} + {" + l + "})");
            terms.add(term(v, visits, visitsUnit(node)));
            terms.add(term(d, edge.latencyMs(), MS));
            terms.add(term(l, endToEnd.ms(edge.target(), read), MS, edge.target()));
        }
        List<String> parts = new ArrayList<>();
        if (!(node instanceof ClientNode)) {
            parts.add("{W}");
            terms.addFirst(term("W", nodes.get(node.id()).avgLatencyMs(), MS));
        }
        boolean parallel = node instanceof ServiceNode service && service.callMode() == CallMode.PARALLEL;
        if (parallel && calls.size() > 1) {
            parts.add("max(" + String.join(", ", calls) + ")");
        } else {
            parts.addAll(calls);
        }
        String formula = String.join(" + ", parts) + (skippedAsync ? "（非同步的下游不在路徑上）" : "");
        String label = cls + " 端到端延遲 L（從這裡開始）";
        if (endToEnd.approximate(node.id(), read)) {
            label += "，平行呼叫取最大值會低估";
        }
        steps.add(step(END_TO_END, label, formula, endToEnd.ms(node.id(), read), MS, terms));
    }

    /** 依比例分流（Client、LB）：Σ visits × S(下游)。 */
    private String weightedSum(Node node, boolean read, List<ExplanationTerm> terms) {
        List<String> parts = new ArrayList<>();
        int i = 0;
        for (Edge edge : graph.outgoing(node.id())) {
            double visits = graph.visits(edge, read);
            if (visits == 0) {
                continue;
            }
            i++;
            parts.add("{p" + subscript(i) + "} × {S" + subscript(i) + "}");
            terms.add(term("p" + subscript(i), visits, PERCENT));
            terms.add(term("S" + subscript(i), success.of(edge.target(), read), PERCENT, edge.target()));
        }
        return String.join(" + ", parts);
    }

    /** Service 的每個子呼叫都要成功：Π S(下游)^visits；Rate Limiter 只有一個下游，visits = 1。 */
    private String product(Node node, boolean read, List<ExplanationTerm> terms) {
        var formula = new StringBuilder();
        int i = 0;
        for (Edge edge : graph.outgoing(node.id())) {
            double visits = graph.visits(edge, read);
            if (visits == 0) {
                continue;
            }
            i++;
            String s = "S" + subscript(i);
            formula.append(" × {").append(s).append("}");
            terms.add(term(s, success.of(edge.target(), read), PERCENT, edge.target()));
            if (node instanceof ServiceNode) {
                String k = "k" + subscript(i);
                formula.append("^{").append(k).append("}");
                terms.add(term(k, visits, null));
            }
        }
        return formula.toString();
    }

    /** Cache、CDN：命中的部分直接成功，沒命中的部分要靠下游。 */
    private String cached(Node node, boolean read, List<ExplanationTerm> terms) {
        double hit = 1 - graph.outgoing(node.id()).stream().mapToDouble(edge -> graph.visits(edge, read)).sum();
        if (hit < TOLERANCE) {
            return weightedSum(node, read, terms);
        }
        terms.add(term("命中", hit, PERCENT));
        String sum = weightedSum(node, read, terms);
        return sum.isEmpty() ? "{命中}" : "{命中} + " + sum;
    }

    private static String visitsUnit(Node node) {
        // Service 的 visits 是呼叫次數，其他是分到的比例
        return node instanceof ServiceNode ? null : PERCENT;
    }

    /** 處理完的這個 class 的量：丟棄依 read／write 比例發生（spec 4.2）。 */
    private static double processed(NodeResult result, boolean read) {
        double total = result.arrivalRps().total();
        return total > 0 ? result.arrivalRps().of(read) * result.throughputRps() / total : 0;
    }

    /** 依 ρ 分級的門檻（spec 4.4）。 */
    private static String threshold(Status status) {
        String warn = number(Status.WARN_AT);
        String critical = number(Status.CRITICAL_AT);
        String overloaded = number(Status.OVERLOADED_AT);
        return switch (status) {
            case OK -> "ρ < " + warn + "：OK";
            case WARN -> warn + " ≤ ρ < " + critical + "：WARN";
            case CRITICAL -> critical + " ≤ ρ < " + overloaded + "：CRITICAL";
            case OVERLOADED -> "ρ ≥ " + overloaded + "：OVERLOADED";
            case LIMITING, NOT_LIMITING, OVER_QUOTA, WITHIN_QUOTA ->
                    throw new IllegalArgumentException("Not a utilization status: " + status);
        };
    }

    /** Rate Limiter、External API 的狀態，用畫面上的名稱。 */
    private static String admitLabel(Status status) {
        return switch (status) {
            case LIMITING -> "限流中";
            case NOT_LIMITING -> "未觸發";
            case OVER_QUOTA -> "超過配額";
            case WITHIN_QUOTA -> "配額內";
            case OK, WARN, CRITICAL, OVERLOADED -> throw new IllegalArgumentException("Not an admit status: " + status);
        };
    }

    /** 超過容量的量 λ − 處理量（Message Queue 的 consumer 只會是 Service，沒有拒絕量）。 */
    private static double overCapacity(ClassRates arrival, double throughput) {
        return arrival.total() - throughput;
    }

    /** 門檻寫成 0.7、1，不寫 1.0。 */
    private static String number(double value) {
        return value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
    }

    private static String className(boolean read) {
        return read ? "read" : "write";
    }

    private static String subscript(int n) {
        var digits = new StringBuilder();
        for (char ch : Integer.toString(n).toCharArray()) {
            digits.append((char) ('₀' + (ch - '0')));
        }
        return digits.toString();
    }

    private static ExplanationStep step(String group, String label, String formula, Double value, String unit,
            ExplanationTerm... terms) {
        return step(group, label, formula, value, unit, List.of(terms));
    }

    private static ExplanationStep step(String group, String label, String formula, Double value, String unit,
            List<ExplanationTerm> terms) {
        return new ExplanationStep(group, label, formula, List.copyOf(terms), value, unit);
    }

    private static ExplanationTerm term(String symbol, Double value, String unit) {
        return new ExplanationTerm(symbol, value, unit, null);
    }

    private static ExplanationTerm term(String symbol, Double value, String unit, String nodeId) {
        return new ExplanationTerm(symbol, value, unit, nodeId);
    }
}
