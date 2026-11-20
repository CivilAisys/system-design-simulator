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
 * 每一步有符號的公式和白話的一句（{@link ExplanationStep#plain()}）；白話只留 ρ 一個符號，參數用屬性面板上的中文名稱。
 */
final class Explanations {

    private static final String RPS = "rps";
    private static final String MS = "ms";
    // 0–1 的比例，前端顯示成百分比
    private static final String PERCENT = "%";
    private static final String BYTES = "bytes";
    private static final String DAYS = "days";
    // read、write 兩個 request class
    private static final boolean[] CLASSES = {true, false};
    // 1 − Σ visits 的浮點誤差（例如 7 條同權重的邊），小於它就當成沒有命中
    private static final double TOLERANCE = 1e-9;
    // 平均排隊時間低於它、也低於處理時間的 NEGLIGIBLE_QUEUE_SHARE 時，白話寫「幾乎不用排隊」。
    // 只看絕對值的話，處理時間很短的節點（Cache 的 0.01 ms）排隊比處理還久也會被說成不用排隊
    private static final double NEGLIGIBLE_QUEUE_MS = 0.1;
    private static final double NEGLIGIBLE_QUEUE_SHARE = 0.01;
    // 要排隊的機率低於它時，「幾乎不用排隊」後面寫機率；高於它時寫「平均等不到 0.1 ms」
    private static final double NEGLIGIBLE_WAITING = 0.001;

    private static final String SENT = "送出多少";
    private static final String ARRIVAL = "進來多少";
    private static final String CAPACITY = "能處理多少";
    private static final String LATENCY = "在這裡花多久";
    private static final String OVERLOAD = "過載：處理不完";
    private static final String WHOLE_NODE = "整個節點";
    private static final String HOTTEST = "最熱那台";
    private static final String DOWNSTREAM = "往下游送多少";
    private static final String LIMIT = "限流";
    private static final String QUOTA = "配額";
    private static final String REPLICATION = "從 primary 複製";
    private static final String BACKLOG = "留在 queue 的訊息";
    private static final String SUCCESS = "成功率";
    private static final String END_TO_END = "到完成要多久";
    private static final String STORAGE_DAILY = "每日增量";
    private static final String STORAGE_TOTAL = "總量";
    private static final String STORAGE_INSTANCE = "每台";
    private static final String STORAGE_DISK = "磁碟";

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

    /**
     * 儲存量估算的步驟（spec 4.8）。Object Storage 沒有副本、機器數和磁碟，只有增量和總量；
     * 沒有設定磁碟容量或沒有寫入（不會滿）時不列磁碟那幾步。{@code writes} 是處理完的 write。
     */
    static List<ExplanationStep> storage(StorageNode node, NodeResult result, double writes, List<Node> replicas,
            StorageEstimate estimate) {
        var steps = new ArrayList<ExplanationStep>();
        ClassRates arrival = result.arrivalRps();
        StorageSizing sizing = node.sizing();
        if (arrival.total() > 0) {
            steps.add(step(STORAGE_DAILY, "處理完的 write（丟棄依 read／write 比例）", "{λ_write} × {處理量} ÷ {λ}",
                    "每秒寫進來 {=}（被丟掉的不算）", writes, RPS, term("λ_write", arrival.write(), RPS, node.id()),
                    term("處理量", result.throughputRps(), RPS), term("λ", arrival.total(), RPS)));
        } else {
            steps.add(step(STORAGE_DAILY, "處理完的 write", "{λ_write}（沒有流量）", "每秒寫進來 {=}（沒有流量）", writes, RPS,
                    term("λ_write", arrival.write(), RPS, node.id())));
        }
        steps.add(step(STORAGE_DAILY, "每日增量", "{處理完的 write} × {bytesPerWrite} × 86,400",
                "每天增加 {=} = 每秒 {處理完的 write} 筆 × 每次寫入大小 {bytesPerWrite} × 一天 86,400 秒", estimate.dailyBytes(),
                BYTES, term("處理完的 write", writes, RPS, node.id()), term("bytesPerWrite", sizing.bytesPerWrite(), BYTES)));
        steps.add(step(STORAGE_TOTAL, "總量", "{每日增量} × {retentionDays}", "總共 {=} = 每天 {每日增量} × 保留天數 {retentionDays}",
                estimate.totalBytes(), BYTES, term("每日增量", estimate.dailyBytes(), BYTES),
                term("retentionDays", sizing.retentionDays(), null)));
        switch (node) {
            // 容量由供應商負責：沒有副本、機器數和磁碟
            case ObjectStorageNode objectStorage -> {
            }
            case DatabaseNode database -> database(database, replicas, estimate, steps);
        }
        return steps;
    }

    /** Database 另外有副本、每台和磁碟；沒有設定磁碟容量或沒有寫入（不會滿）時不列磁碟那幾步。 */
    private static void database(DatabaseNode database, List<Node> replicas, StorageEstimate estimate,
            List<ExplanationStep> steps) {
        StorageSizing sizing = database.sizing();
        String names = String.join("、", replicas.stream().map(Node::name).toList());
        String replicaNote = replicas.isEmpty() ? "（沒有 Read Replica）" : "（Read Replica：" + names + "）";
        if (estimate.replicasLagging()) {
            replicaNote += "，副本複製跟不上，實際副本量會比這少";
        }
        steps.add(step(STORAGE_TOTAL, "含副本" + replicaNote, "{總量} × (1 + {Read Replica 數})",
                "含副本 {=} = {總量} × (1 ＋ {Read Replica 數} 個 Read Replica)" + literal(replicaNote),
                estimate.totalWithReplicasBytes(), BYTES, term("總量", estimate.totalBytes(), BYTES),
                term("Read Replica 數", (double) estimate.replicas(), null)));
        int instances = database.capacityParams().instances();
        steps.add(step(STORAGE_INSTANCE, "每台（資料平均分布）", "{總量} ÷ {instances}",
                "每台 {=} = {總量} ÷ 機器數 {instances}（資料平均分布）", estimate.perInstanceBytes(), BYTES,
                term("總量", estimate.totalBytes(), BYTES), term("instances", (double) instances, null)));
        if (estimate.daysUntilFull() == null) {
            return;
        }
        double dailyPerInstance = estimate.dailyBytes() / instances;
        steps.add(step(STORAGE_DISK, "每台每日增量", "{每日增量} ÷ {instances}", "每台每天增加 {=} = 每天 {每日增量} ÷ 機器數 {instances}",
                dailyPerInstance, BYTES, term("每日增量", estimate.dailyBytes(), BYTES),
                term("instances", (double) instances, null)));
        // 保留期的天數寫在名稱裡，和 ρ 的狀態門檻一樣：看得出拿什麼比
        String days = number(sizing.retentionDays());
        String retention = "保留期 " + days + " 天";
        String comparison = estimate.fillsDisk() ? "< " + retention + "：保留期內就會滿" : "≥ " + retention + "：保留期內不會滿";
        String plainComparison = estimate.fillsDisk() ? "（比保留期 " + days + " 天短，保留期內就會滿）"
                : "（保留期 " + days + " 天內不會滿）";
        // 磁碟容量換成 bytes，和每台每日增量的單位一致
        steps.add(step(STORAGE_DISK, "磁碟幾天後會滿（" + comparison + "）", "{每台磁碟} ÷ {每台每日增量}",
                "磁碟{=}後會滿 = 每台磁碟 {每台磁碟} ÷ 每台每天 {每台每日增量}" + plainComparison, estimate.daysUntilFull(), DAYS,
                term("每台磁碟", sizing.diskGbPerInstance() * 1e9, BYTES), term("每台每日增量", dailyPerInstance, BYTES)));
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
                admit(LIMIT, "limitRps", "限流上限", limiter.limitRps(), result, steps);
                steps.add(step(LIMIT, "節點延遲 W", "假設 Rate Limiter 本身不會成為瓶頸，記為 0",
                        "Rate Limiter 本身不花時間（假設它不會成為瓶頸）", result.avgLatencyMs(), MS));
            }
            case ExternalApiNode api -> {
                admit(QUOTA, "quotaRps", "配額", api.quotaRps(), result, steps);
                steps.add(step(QUOTA, "節點延遲 W", "{latencyMs}（固定）", "固定花回應延遲 {latencyMs} ms", result.avgLatencyMs(), MS,
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
        steps.add(step(SENT, "read", "{rps} × {readRatio}", "每秒 {=} = 每秒請求數 {rps} × 讀取比例 {readRatio}",
                result.arrivalRps().read(), RPS, term("rps", client.rps(), RPS),
                term("readRatio", client.readRatio(), PERCENT)).forClass(true));
        steps.add(step(SENT, "write", "{rps} − {read}", "每秒 {=} = {rps} − {read}", result.arrivalRps().write(), RPS,
                term("rps", client.rps(), RPS), term("read", result.arrivalRps().read(), RPS)).forClass(false));
    }

    /** 各上游送來的量加總（spec 3.3、3.4）；每條邊的量是上游處理完的流量 × visits。 */
    private void arrival(Node node, NodeResult result, List<ExplanationStep> steps) {
        List<Edge> in = incoming.getOrDefault(node.id(), List.of());
        for (boolean read : CLASSES) {
            List<ExplanationTerm> terms = new ArrayList<>();
            List<String> parts = new ArrayList<>();
            List<String> plainParts = new ArrayList<>();
            for (int i = 0; i < in.size(); i++) {
                Edge edge = in.get(i);
                Node source = graph.node(edge.source());
                String x = "x" + subscript(i + 1);
                String v = "v" + subscript(i + 1);
                parts.add("{" + x + "} × {" + v + "}");
                // Service 的 visits 是每個請求呼叫幾次，其他是分到的比例
                plainParts.add("{@" + x + "} 處理完的 {" + x + "} × "
                        + (source instanceof ServiceNode ? "每個請求呼叫 {" + v + "} 次" : "{" + v + "}"));
                terms.add(term(x, processed(nodes.get(source.id()), read), RPS, source.id()));
                terms.add(term(v, graph.visits(edge, read), visitsUnit(source)));
            }
            steps.add(step(ARRIVAL, className(read) + " 到達量 λ_" + className(read) + "（上游處理完的 × visits）",
                    parts.isEmpty() ? "0" : String.join(" + ", parts),
                    plainParts.isEmpty() ? "每秒進來 {=}（沒有上游）" : "每秒進來 {=} = " + String.join(" ＋ ", plainParts),
                    result.arrivalRps().of(read), RPS, terms).forClass(read));
        }
        steps.add(step(ARRIVAL, "到達量 λ", "{λ_read} + {λ_write}", "合計每秒進來 {=} = read {λ_read} ＋ write {λ_write}",
                result.arrivalRps().total(), RPS, term("λ_read", result.arrivalRps().read(), RPS),
                term("λ_write", result.arrivalRps().write(), RPS)));
    }

    /**
     * 整個節點是一個 M/M/c（spec 4.2）。consumer 有 backlog 時，超過容量的部分有一部分留在 queue 裡，
     * 不全是丟棄（見 {@link #backlog}）。
     */
    private static void queue(CapacityParams params, NodeResult result, List<ExplanationStep> steps) {
        boolean backlog = result.warnings().contains(NodeWarning.BACKLOG);
        queue(CAPACITY, result.utilization() < 1 ? LATENCY : OVERLOAD, params, InstanceResult.of(result),
                result.avgQueueMs(), backlog ? "超過容量" : "超過容量、丟棄", backlog ? "每秒處理不完" : "每秒丟掉", steps);
    }

    /**
     * 一個 M/M/c 的步驟：c、μ、容量、ρ 放在 {@code capacityGroup}；{@code latencyGroup} 在 ρ < 1 時是 Erlang C 和延遲，
     * 過載時是處理量和超過容量的部分（λ − c × μ）。Erlang C 的三步只在看公式時顯示，白話合成一句「排隊」。
     */
    private static void queue(String capacityGroup, String latencyGroup, CapacityParams params, InstanceResult outcome,
            Double queueMs, String excessLabel, String excessPlain, List<ExplanationStep> steps) {
        double lambda = outcome.arrivalRps().total();
        double utilization = outcome.utilization();
        double c = params.workers();
        double mu = params.serviceRate();
        steps.add(step(capacityGroup, "worker 數 c", "{instances} × {concurrency}",
                "同時能處理 {=} 個 = 機器數 {instances} × 每台並行數 {concurrency}", c, null,
                term("instances", (double) params.instances(), null),
                term("concurrency", (double) params.concurrency(), null)));
        steps.add(step(capacityGroup, "每個 worker 的服務率 μ", "1000 ÷ {serviceTimeMs}",
                "每個每秒處理 {=} 個 = 1000 ÷ 處理時間 {serviceTimeMs} ms", mu, RPS,
                term("serviceTimeMs", params.serviceTimeMs(), MS)));
        steps.add(step(capacityGroup, "容量", "{c} × {μ}", "每秒能處理 {=} = {c} × {μ}", params.capacityRps(), RPS,
                term("c", c, null), term("μ", mu, RPS)));
        steps.add(step(capacityGroup, "使用率 ρ（" + threshold(outcome.status()) + "）", "{λ} ÷ ({c} × {μ})",
                "使用率 ρ {=} = 每秒進來 {λ} ÷ 每秒能處理 {容量}（" + plainThreshold(outcome.status()) + "）", utilization, null,
                term("λ", lambda, RPS), term("c", c, null), term("μ", mu, RPS),
                term("容量", params.capacityRps(), RPS)));
        if (utilization < 1) {
            double load = lambda / mu;
            double waiting = MmcQueue.erlangC(params.workers(), load);
            steps.add(step(latencyGroup, "負載 a", "{λ} ÷ {μ}", null, load, null, term("λ", lambda, RPS),
                    term("μ", mu, RPS)).formulaOnly());
            steps.add(step(latencyGroup, "等待機率 P_wait", "ErlangC({c}, {a})", null, waiting, PERCENT,
                    term("c", c, null), term("a", load, null)).formulaOnly());
            steps.add(step(latencyGroup, "平均排隊時間 Wq", "{P_wait} ÷ ({c} × {μ} − {λ}) × 1000", null, queueMs, MS,
                    term("P_wait", waiting, PERCENT), term("c", c, null), term("μ", mu, RPS),
                    term("λ", lambda, RPS)).formulaOnly());
            boolean negligible = queueMs < NEGLIGIBLE_QUEUE_MS && queueMs < params.serviceTimeMs() * NEGLIGIBLE_QUEUE_SHARE;
            String queuePlain = !negligible ? "排隊：平均要等 {Wq} ms（{P_wait} 的請求要排隊）"
                    : waiting < NEGLIGIBLE_WAITING ? "排隊：幾乎不用排隊（要排隊的機率 {P_wait}）"
                    : "排隊：幾乎不用排隊（{P_wait} 的請求要排隊，但平均等的時間不到處理時間的 1%）";
            List<ExplanationTerm> queueTerms = negligible ? List.of(term("P_wait", waiting, PERCENT))
                    : List.of(term("Wq", queueMs, MS), term("P_wait", waiting, PERCENT));
            steps.add(step(latencyGroup, "排隊", "", queuePlain, queueMs, MS, queueTerms).plainOnly());
            steps.add(step(latencyGroup, "節點延遲 W", "{Wq} + {1/μ}",
                    negligible ? "在這裡花 {=} ms = 處理 {1/μ}（幾乎不用排隊）" : "在這裡花 {=} ms = 排隊 {Wq} ＋ 處理 {1/μ}",
                    outcome.avgLatencyMs(), MS, term("Wq", queueMs, MS), term("1/μ", params.serviceTimeMs(), MS)));
        } else {
            steps.add(step(latencyGroup, "處理量", "{c} × {μ}", "每秒只處理得了 {=}（能處理的上限）", params.capacityRps(), RPS,
                    term("c", c, null), term("μ", mu, RPS)));
            steps.add(step(latencyGroup, excessLabel, "{λ} − {容量}", excessPlain + " {=} = 進來 {λ} − 能處理的 {容量}",
                    overCapacity(outcome.arrivalRps(), outcome.throughputRps()), RPS,
                    term("λ", lambda, RPS), term("容量", params.capacityRps(), RPS)));
            steps.add(step(latencyGroup, "節點延遲 W", "ρ ≥ 1 時佇列會無限成長，穩態下沒有定義",
                    "在這裡花多久：沒有定義（處理不完，排隊會一直變長）", null, MS));
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
        instance(HOTTEST, "{λ} × {hotShare}", "每秒進來 {=} = 整個節點進來 {λ} × 最熱那台的流量占比 {hotShare}",
                params.withInstances(1), lambda, share, hot, steps);
        instance(othersGroup, "{λ} × (1 − {hotShare})", "每秒進來 {=} = 整個節點進來 {λ} × (1 − 最熱那台的流量占比 {hotShare})",
                params.withInstances(params.instances() - 1), lambda, share, others, steps);
        steps.add(step(WHOLE_NODE, "容量（全部 " + params.instances() + " 台）", "{c} × {μ}",
                "全部 " + params.instances() + " 台每秒能處理 {=} = 同時能處理 {c} 個 × 每個每秒 {μ} 個", result.capacityRps(), RPS,
                term("c", (double) params.workers(), null), term("μ", params.serviceRate(), RPS)));
        steps.add(step(WHOLE_NODE, "使用率 ρ（取較高的一邊，" + threshold(result.status()) + "）",
                "max({ρ_最熱}, {ρ_其他})",
                "使用率 ρ {=}：最熱那台 {ρ_最熱}、其他 {ρ_其他}，取較高的一邊（" + plainThreshold(result.status()) + "）",
                result.utilization(), null,
                term("ρ_最熱", hot.utilization(), null), term("ρ_其他", others.utilization(), null)));
        steps.add(step(WHOLE_NODE, "處理量", "{最熱} + {其他}", "每秒處理 {=} = 最熱那台 {最熱} ＋ 其他 {其他}",
                result.throughputRps(), RPS,
                term("最熱", hot.throughputRps(), RPS), term("其他", others.throughputRps(), RPS)));
        if (result.droppedRps() > 0) {
            steps.add(step(WHOLE_NODE, "丟棄量", "{最熱} + {其他}", "每秒丟掉 {=} = 最熱那台 {最熱} ＋ 其他 {其他}",
                    result.droppedRps(), RPS,
                    term("最熱", hot.droppedRps(), RPS), term("其他", others.droppedRps(), RPS)));
        }
        weighted("平均排隊時間 Wq", "平均要排隊", "Wq", queueMs(params.withInstances(1), hot), hot,
                queueMs(params.withInstances(params.instances() - 1), others), others, lambda, result.avgQueueMs(),
                steps);
        weighted("節點延遲 W", "在這裡花", "W", hot.avgLatencyMs(), hot, others.avgLatencyMs(), others, lambda,
                result.avgLatencyMs(), steps);
    }

    /** 整個節點的延遲依流量加權平均（spec 4.2.2）；有流量的一邊過載時沒有定義。 */
    private static void weighted(String label, String plainLabel, String symbol, Double hotValue, InstanceResult hot,
            Double otherValue, InstanceResult others, double lambda, Double value, List<ExplanationStep> steps) {
        String hotSymbol = symbol + "_最熱";
        if (value == null) {
            steps.add(step(WHOLE_NODE, label, "有流量的一邊過載，穩態下沒有定義",
                    plainLabel + "多久：沒有定義（有流量的一邊處理不完）", null, MS));
        } else if (lambda <= 0) {
            steps.add(step(WHOLE_NODE, label, "{" + hotSymbol + "}（沒有流量時用最熱那台的值）",
                    plainLabel + " {=} ms（沒有流量，用最熱那台的值）", value, MS, term(hotSymbol, hotValue, MS)));
        } else {
            String otherSymbol = symbol + "_其他";
            steps.add(step(WHOLE_NODE, label + "（依流量加權平均）",
                    "({" + hotSymbol + "} × {λ_最熱} + {" + otherSymbol + "} × {λ_其他}) ÷ {λ}",
                    plainLabel + " {=} ms：最熱那台 {" + hotSymbol + "} ms、其他 {" + otherSymbol + "} ms，依流量加權平均", value,
                    MS, term(hotSymbol, hotValue, MS), term("λ_最熱", hot.arrivalRps().total(), RPS),
                    term(otherSymbol, otherValue, MS), term("λ_其他", others.arrivalRps().total(), RPS),
                    term("λ", lambda, RPS)));
        }
    }

    /** 一部分機器的平均排隊時間；過載時沒有定義。 */
    private static Double queueMs(CapacityParams params, InstanceResult instance) {
        return instance.utilization() < 1 ? MmcQueue.queueMs(params, instance.arrivalRps().total()) : null;
    }

    private static void instance(String group, String arrivalFormula, String arrivalPlain, CapacityParams params,
            double lambda, double share, InstanceResult instance, List<ExplanationStep> steps) {
        steps.add(step(group, "到達量 λ", arrivalFormula, arrivalPlain, instance.arrivalRps().total(), RPS,
                term("λ", lambda, RPS), term("hotShare", share, PERCENT)));
        queue(group, group, params, instance, queueMs(params, instance), "超過容量、丟棄", "每秒丟掉", steps);
    }

    /** Cache、CDN 只有沒命中的 read 往下送，write 全部往下送（spec 3.3）。 */
    private void miss(CachingNode cache, NodeResult result, List<ExplanationStep> steps) {
        double read = processed(result, true);
        if (read <= 0) {
            return;
        }
        steps.add(step(DOWNSTREAM, "沒命中、往下游送的 read", "{處理的 read} × (1 − {hitRatio})",
                "沒命中、往下游送的 read 每秒 {=} = 處理的 read {處理的 read} × (1 − 命中率 {hitRatio})",
                read * (1 - cache.hitRatio()), RPS,
                term("處理的 read", read, RPS), term("hitRatio", cache.hitRatio(), PERCENT)));
    }

    /** Rate Limiter、External API 放行 min(λ, 上限)，其餘拒絕（spec 4.2.1）。 */
    private static void admit(String group, String limitName, String limitPlain, double limit, NodeResult result,
            List<ExplanationStep> steps) {
        double lambda = result.arrivalRps().total();
        boolean over = lambda > limit;
        String comparison = over ? "λ > " + limitName : "λ ≤ " + limitName;
        steps.add(step(group, "放行量", "min({λ}, {" + limitName + "})",
                "每秒放行 {=} = 進來 {λ} 和" + limitPlain + " {" + limitName + "} 取小的", result.throughputRps(), RPS,
                term("λ", lambda, RPS), term(limitName, limit, RPS)));
        String status = plainAdmit(result.status());
        steps.add(step(group, "拒絕量（" + comparison + "：" + admitLabel(result.status()) + "）", "{λ} − {放行量}",
                over ? "每秒拒絕 {=} = 進來 {λ} − 放行 {放行量}（" + status + "）" : "每秒拒絕 {=}（" + status + "）",
                result.rejectedRps(), RPS, term("λ", lambda, RPS), term("放行量", result.throughputRps(), RPS)));
    }

    /**
     * Read Replica（spec 4.2.3）：primary 處理完的 write 全部複製過來；過載時丟棄量依比例落在複製寫入上。
     */
    private void replication(ReadReplicaNode replica, NodeResult result, List<ExplanationStep> steps) {
        for (Edge edge : incoming.getOrDefault(replica.id(), List.of())) {
            if (graph.isAsync(edge)) {
                double replicated = edges.get(edge.id()).rps().write();
                steps.add(step(REPLICATION, "複製寫入（primary 處理完的 write）", "{primary 的 write}",
                        "從 {@primary 的 write} 複製來的 write 每秒 {=}", replicated, RPS,
                        term("primary 的 write", replicated, RPS, edge.source())));
            }
        }
        if (!result.warnings().contains(NodeWarning.REPLICATION_LAG)) {
            return;
        }
        ClassRates arrival = result.arrivalRps();
        steps.add(step(REPLICATION, "丟掉的複製寫入（replication lag 會持續增加）", "{丟棄量} × {λ_write} ÷ {λ}",
                "每秒有 {=} 筆複製寫入跟不上（replication lag 會一直變大）",
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
                    "每秒留在 {@λ_q} 的訊息 {=}（處理不完的，加上下游失敗的）", edgeResult.backlogRps(), RPS,
                    term("λ_q", rps.total(), RPS, edge.source()), term("超過容量的比例", excessShare, PERCENT),
                    term("λ_q,read", rps.read(), RPS, edge.source()), term("read 下游失敗", failedRead, PERCENT),
                    term("λ_q,write", rps.write(), RPS, edge.source()), term("write 下游失敗", failedWrite, PERCENT)));
        }
        if (excess > 0) {
            steps.add(step(BACKLOG, "丟棄量（留在 queue 的不算）", "{超過容量} − {留在 queue}",
                    "每秒丟掉 {=} = 處理不完的 {超過容量} − 留在 queue 的 {留在 queue}", result.droppedRps(), RPS,
                    term("超過容量", excess, RPS), term("留在 queue", kept, RPS)));
        }
    }

    /** S(n, class) = pass(n) × 下游完整成功的機率（spec 4.3.1）。 */
    private void success(Node node, boolean read, List<ExplanationStep> steps) {
        String cls = className(read);
        List<ExplanationTerm> terms = new ArrayList<>();
        Parts parts;
        if (node instanceof ClientNode) {
            Parts sum = weightedSum(node, read, terms);
            parts = new Parts(sum.formula(), "完整成功的機率 {=} = " + sum.plain());
        } else {
            double pass = success.pass(node, read);
            NodeResult result = nodes.get(node.id());
            steps.add(step(SUCCESS, cls + " 通過率 pass", "{處理量} ÷ {λ}", "沒被丟掉的比例 {=} = 處理 {處理量} ÷ 進來 {λ}", pass,
                    PERCENT, term("處理量", result.throughputRps(), RPS),
                    term("λ", result.arrivalRps().total(), RPS)).forClass(read));
            terms.add(term("pass", pass, PERCENT));
            Parts downstream = switch (node) {
                case LoadBalancerNode lb -> weightedSum(node, read, terms).wrapped();
                case ServiceNode service -> product(node, read, terms);
                case CachingNode cache -> cached(node, read, terms).wrapped();
                case RateLimiterNode limiter -> product(node, read, terms);
                case StorageNode storage -> graph.outgoing(node.id()).isEmpty() ? Parts.note("（沒有下游）")
                        : Parts.note("（複製到 Read Replica 是非同步的，不影響成功率）");
                case ReadReplicaNode replica -> Parts.note("（沒有下游）");
                case MessageQueueNode queue -> Parts.note("（訊息進到 queue 就算成功，consumer 的處理是非同步的）");
                case ExternalApiNode api -> Parts.note("（沒有下游）");
                case ClientNode client -> throw new IllegalStateException("Client has no pass rate");
            };
            // 沒有要靠下游的部分（沒有下游、非同步）時只有 pass
            boolean alone = !downstream.formula().contains("{");
            String plain = alone
                    ? "從這裡往下都成功的機率 {=} = 沒被丟掉的比例 {pass}" + (downstream.plain().isEmpty() ? "（沒有下游）"
                            : downstream.plain())
                    : "從這裡往下都成功的機率 {=} = 沒被丟掉的 {pass}" + downstream.plain();
            parts = new Parts("{pass}" + downstream.formula(), plain);
        }
        steps.add(step(SUCCESS, cls + " 成功率 S（從這裡開始到完整成功）", parts.formula(), parts.plain(),
                success.of(node.id(), read), PERCENT, terms).forClass(read));
    }

    /** Client 每秒完整成功的請求數 = 各 class 送出量 × 成功率。 */
    private void successRps(Node client, NodeResult result, List<ExplanationStep> steps) {
        List<ExplanationTerm> terms = new ArrayList<>();
        List<String> parts = new ArrayList<>();
        List<String> plainParts = new ArrayList<>();
        for (boolean read : CLASSES) {
            double sent = result.arrivalRps().of(read);
            if (sent > 0) {
                String cls = className(read);
                parts.add("{" + cls + "} × {S_" + cls + "}");
                plainParts.add(cls + " {" + cls + "} × {S_" + cls + "}");
                terms.add(term(cls, sent, RPS));
                terms.add(term("S_" + cls, success.of(client.id(), read), PERCENT));
            }
        }
        if (!parts.isEmpty()) {
            steps.add(step(SUCCESS, "每秒完整成功", String.join(" + ", parts),
                    "每秒完整成功 {=} = " + String.join(" ＋ ", plainParts), result.successRps(), RPS, terms));
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
        List<String> plainCalls = new ArrayList<>();
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
            String call = "連線 {" + d + "} ＋ {@" + l + "} 之後 {" + l + "}";
            // 每個請求只走一次時不寫次數或比例
            plainCalls.add(visits == 1 ? call
                    : node instanceof ServiceNode ? "呼叫 {" + v + "} 次 × (" + call + ")" : "{" + v + "} × (" + call + ")");
            terms.add(term(v, visits, visitsUnit(node)));
            terms.add(term(d, edge.latencyMs(), MS));
            terms.add(term(l, endToEnd.ms(edge.target(), read), MS, edge.target()));
        }
        List<String> parts = new ArrayList<>();
        List<String> plainParts = new ArrayList<>();
        boolean client = node instanceof ClientNode;
        if (!client) {
            parts.add("{W}");
            plainParts.add("在這裡 {W}");
            terms.addFirst(term("W", nodes.get(node.id()).avgLatencyMs(), MS));
        }
        boolean parallel = node instanceof ServiceNode service && service.callMode() == CallMode.PARALLEL;
        if (parallel && calls.size() > 1) {
            parts.add("max(" + String.join(", ", calls) + ")");
            plainParts.add("取最慢的下游 max(" + String.join("、", plainCalls) + ")");
        } else {
            parts.addAll(calls);
            plainParts.addAll(plainCalls);
        }
        String asyncNote = skippedAsync ? "（非同步的下游不在路徑上）" : "";
        String formula = String.join(" + ", parts) + asyncNote;
        String label = cls + " 端到端延遲 L（從這裡開始）";
        Double value = endToEnd.ms(node.id(), read);
        String plain;
        if (value == null) {
            String reason = client ? "路徑上有節點處理不完"
                    : nodes.get(node.id()).avgLatencyMs() == null ? "這裡處理不完" : "下游有節點處理不完";
            plain = (client ? "使用者感受到的延遲" : "到完成要多久") + "：沒有定義（" + reason + "）";
        } else {
            plain = (client ? "使用者感受到的延遲 {=} ms = " : "從這裡到完成要 {=} ms = ")
                    + String.join(" ＋ ", plainParts) + asyncNote;
        }
        if (endToEnd.approximate(node.id(), read)) {
            label += "，平行呼叫取最大值會低估";
            plain += "（平行呼叫取最大值，會低估）";
        }
        steps.add(step(END_TO_END, label, formula, plain, value, MS, terms).forClass(read));
    }

    /** 公式和白話的同一段。 */
    private record Parts(String formula, String plain) {

        /** 沒有代入值的說明，公式和白話相同。 */
        static Parts note(String text) {
            return new Parts(text, text);
        }

        /** 接在 pass 後面相乘時加上括號。 */
        Parts wrapped() {
            return new Parts(" × (" + formula + ")", " × (" + plain + ")");
        }
    }

    /** 依比例分流（Client、LB）：Σ visits × S(下游)。 */
    private Parts weightedSum(Node node, boolean read, List<ExplanationTerm> terms) {
        List<String> parts = new ArrayList<>();
        List<String> plainParts = new ArrayList<>();
        int i = 0;
        for (Edge edge : graph.outgoing(node.id())) {
            double visits = graph.visits(edge, read);
            if (visits == 0) {
                continue;
            }
            i++;
            String p = "p" + subscript(i);
            String s = "S" + subscript(i);
            parts.add("{" + p + "} × {" + s + "}");
            plainParts.add("分到 {@" + s + "} 的 {" + p + "} × 成功 {" + s + "}");
            terms.add(term(p, visits, PERCENT));
            terms.add(term(s, success.of(edge.target(), read), PERCENT, edge.target()));
        }
        return new Parts(String.join(" + ", parts), String.join(" ＋ ", plainParts));
    }

    /** Service 的每個子呼叫都要成功：Π S(下游)^visits；Rate Limiter 只有一個下游，visits = 1。 */
    private Parts product(Node node, boolean read, List<ExplanationTerm> terms) {
        var formula = new StringBuilder();
        var plain = new StringBuilder();
        int i = 0;
        for (Edge edge : graph.outgoing(node.id())) {
            double visits = graph.visits(edge, read);
            if (visits == 0) {
                continue;
            }
            i++;
            String s = "S" + subscript(i);
            formula.append(" × {").append(s).append("}");
            plain.append(" × {@").append(s).append("} 成功 {").append(s).append("}");
            terms.add(term(s, success.of(edge.target(), read), PERCENT, edge.target()));
            if (node instanceof ServiceNode) {
                String k = "k" + subscript(i);
                formula.append("^{").append(k).append("}");
                // 呼叫一次時不寫「的 1 次方」
                if (visits != 1) {
                    plain.append(" 的 {").append(k).append("} 次方（呼叫 ").append("{").append(k).append("} 次都要成功）");
                }
                terms.add(term(k, visits, null));
            }
        }
        return new Parts(formula.toString(), plain.toString());
    }

    /** Cache、CDN：命中的部分直接成功，沒命中的部分要靠下游。 */
    private Parts cached(Node node, boolean read, List<ExplanationTerm> terms) {
        double hit = 1 - graph.outgoing(node.id()).stream().mapToDouble(edge -> graph.visits(edge, read)).sum();
        if (hit < TOLERANCE) {
            return weightedSum(node, read, terms);
        }
        terms.add(term("命中", hit, PERCENT));
        Parts sum = weightedSum(node, read, terms);
        return sum.formula().isEmpty() ? new Parts("{命中}", "命中 {命中}")
                : new Parts("{命中} + " + sum.formula(), "命中 {命中} ＋ 沒命中的" + sum.plain());
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

    /** 白話的狀態門檻。 */
    private static String plainThreshold(Status status) {
        return switch (status) {
            case OK -> "低於 " + number(Status.WARN_AT) + "，正常";
            case WARN -> number(Status.WARN_AT) + " 以上，偏忙";
            case CRITICAL -> number(Status.CRITICAL_AT) + " 以上，接近滿載";
            case OVERLOADED -> number(Status.OVERLOADED_AT) + " 以上，處理不完";
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

    /** 白話的放行狀態：和畫面上的狀態同一個詞，前面說明是否超過上限。 */
    private static String plainAdmit(Status status) {
        return switch (status) {
            case LIMITING -> "超過限流上限，限流中";
            case NOT_LIMITING -> "沒超過限流上限，未觸發";
            case OVER_QUOTA -> "超過配額";
            case WITHIN_QUOTA -> "沒超過配額";
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

    /** 放進白話模板的文字（例如節點名稱）：大括號換成全形，不會被當成代入位置。 */
    private static String literal(String text) {
        return text.replace('{', '｛').replace('}', '｝');
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

    private static ExplanationStep step(String group, String label, String formula, String plain, Double value,
            String unit, ExplanationTerm... terms) {
        return step(group, label, formula, plain, value, unit, List.of(terms));
    }

    private static ExplanationStep step(String group, String label, String formula, String plain, Double value,
            String unit, List<ExplanationTerm> terms) {
        return new ExplanationStep(group, label, formula, List.copyOf(terms), value, unit, plain, ExplanationView.BOTH,
                null);
    }

    private static ExplanationTerm term(String symbol, Double value, String unit) {
        return new ExplanationTerm(symbol, value, unit, null);
    }

    private static ExplanationTerm term(String symbol, Double value, String unit, String nodeId) {
        return new ExplanationTerm(symbol, value, unit, nodeId);
    }
}
