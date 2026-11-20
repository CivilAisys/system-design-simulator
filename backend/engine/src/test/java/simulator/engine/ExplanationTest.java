package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** 計算說明（spec 4.9）：步驟的結果和同一次計算的結果相同，代入值指到正確的節點。 */
class ExplanationTest {

    private static final double EPS = 1e-6;
    private static final CapacityParams AMPLE = new CapacityParams(1, 10_000, 1);
    private static final List<Edge> EVERY_COMPONENT_EDGES = List.of(
            new Edge("e1", "client", "cdn", 1, 1, 30),
            new Edge("e2", "cdn", "rl", 3, 1, 30),
            new Edge("e3", "cdn", "s3", 1, 1, 30),
            new Edge("e4", "rl", "lb", 1, 1, 1),
            new Edge("e5", "lb", "api", 1, 1, 1),
            new Edge("e6", "api", "cache", 1, 1, 1),
            new Edge("e7", "cache", "db", 1, 1, 1),
            new Edge("e8", "api", "db", 1, 1, 1, RequestClass.WRITE),
            new Edge("e9", "db", "replica", 1, 1, 50),
            new Edge("e10", "api", "replica", 1, 1, 1, RequestClass.READ),
            new Edge("e11", "api", "pay", 1, 1, 30),
            new Edge("e12", "api", "mq", 1, 1, 1),
            new Edge("e13", "mq", "worker", 1, 1, 1),
            new Edge("e14", "worker", "db", 1, 1, 1));

    private final Simulator simulator = new SteadyStateSimulator();

    /** μ = 100，容量 = workers × 100 rps。 */
    private static CapacityParams workers(int workers) {
        return new CapacityParams(1, workers, 10);
    }

    /**
     * 每一種元件都有：Client → CDN ─→ Rate Limiter → LB → API，CDN ─→ Object Storage；
     * API → Cache（熱點）→ DB，API ─WRITE→ DB ─複製→ Replica，API ─READ→ Replica，API → External API，
     * API → MQ → Worker → DB；另外一個未連線的 Service。
     */
    private SimulationResult everyComponent() {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new CdnNode("cdn", "CDN", NodeHealth.HEALTHY, AMPLE, 0.5),
                        new RateLimiterNode("rl", "Limiter", NodeHealth.HEALTHY, 10_000),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, AMPLE),
                        new ServiceNode("api", "API", NodeHealth.HEALTHY, new CapacityParams(2, 4, 10),
                                CallMode.PARALLEL),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, new CapacityParams(3, 2, 5), 0.8, 0.5),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, workers(20)),
                        new ReadReplicaNode("replica", "Replica", NodeHealth.HEALTHY, workers(20)),
                        new ObjectStorageNode("s3", "Media", NodeHealth.HEALTHY, AMPLE),
                        new ExternalApiNode("pay", "Payments", NodeHealth.HEALTHY, 100, 10_000),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, AMPLE),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, workers(10), CallMode.SEQUENTIAL),
                        new ServiceNode("idle", "Idle", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL)),
                EVERY_COMPONENT_EDGES));
    }

    /** Client → Service → Database，Database 容量足夠不影響結果。 */
    private SimulationResult clientServiceDb(double rps, CapacityParams service) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, service, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, AMPLE)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "db", 1, 1, 1))));
    }

    private static ExplanationStep step(List<ExplanationStep> steps, String labelPrefix) {
        return steps.stream().filter(step -> step.label().startsWith(labelPrefix)).reduce((first, last) -> last)
                .orElseThrow(() -> new AssertionError("No step " + labelPrefix + " in " + steps));
    }

    private static List<ExplanationStep> inGroup(List<ExplanationStep> steps, String group) {
        return steps.stream().filter(step -> step.group().equals(group)).toList();
    }

    private static ExplanationTerm term(ExplanationStep step, String symbol) {
        return step.terms().stream().filter(term -> term.symbol().equals(symbol)).findFirst().orElseThrow();
    }

    @Test
    void everyStepValueMatchesTheResult() {
        SimulationResult result = everyComponent();
        assertThat(result.valid()).as("%s", result.errors()).isTrue();

        result.nodes().forEach((id, node) -> {
            List<ExplanationStep> steps = result.explanations().get(id);
            if (id.equals("idle")) {
                return;
            }
            assertThat(steps).as(id).isNotEmpty();
            if (id.equals("client")) {
                assertThat(step(steps, "每秒完整成功").value()).isCloseTo(node.successRps(), within(EPS));
                assertThat(step(steps, "read 端到端延遲 L").value()).isEqualTo(node.endToEndMs().read().ms());
                assertThat(step(steps, "write 端到端延遲 L").value()).isEqualTo(node.endToEndMs().write().ms());
                return;
            }
            // 有熱點的 Cache，兩邊各自也有「到達量 λ」
            List<ExplanationStep> arrival = inGroup(steps, "進來多少");
            assertThat(step(arrival, "到達量 λ").value()).as(id).isEqualTo(node.arrivalRps().total());
            assertThat(step(arrival, "read 到達量").value()).as(id).isEqualTo(node.arrivalRps().read());
            assertThat(step(arrival, "write 到達量").value()).as(id).isEqualTo(node.arrivalRps().write());
            assertThat(step(steps, "節點延遲 W").value()).as(id).isEqualTo(node.avgLatencyMs());
            if (node.capacityRps() == null) {
                assertThat(step(steps, "放行量").value()).as(id).isEqualTo(node.throughputRps());
                assertThat(step(steps, "拒絕量").value()).as(id).isEqualTo(node.rejectedRps());
                return;
            }
            assertThat(step(steps, "使用率 ρ").value()).as(id).isEqualTo(node.utilization());
            assertThat(step(steps, "容量").value()).as(id).isEqualTo(node.capacityRps());
            if (node.avgQueueMs() != null) {
                assertThat(step(steps, "平均排隊時間 Wq").value()).as(id).isEqualTo(node.avgQueueMs());
            }
            if (node.droppedRps() > 0) {
                assertThat(steps).as(id).anyMatch(step -> node.droppedRps() == step.value());
            }
            if (node.hotSpot() != null) {
                assertInstance(inGroup(steps, "最熱那台"), node.hotSpot().hottest());
                assertInstance(inGroup(steps, "其他 2 台"), node.hotSpot().others());
            }
        });
    }

    private static void assertInstance(List<ExplanationStep> group, InstanceResult instance) {
        assertThat(step(group, "到達量 λ").value()).isEqualTo(instance.arrivalRps().total());
        assertThat(step(group, "使用率 ρ").value()).isEqualTo(instance.utilization());
        assertThat(step(group, "節點延遲 W").value()).isEqualTo(instance.avgLatencyMs());
    }

    @Test
    void placeholdersMatchTheTerms() {
        // 每一種元件，加上過載、backlog、限流中和複製跟不上
        List<SimulationResult> results = List.of(everyComponent(), clientServiceDb(150, new CapacityParams(1, 1, 10)),
                backlog(), limiterAndLaggingReplica(), edgeCases());
        for (SimulationResult result : results) {
            result.explanations().forEach((id, steps) -> steps.forEach(step -> PlainText.assertConsistent(id, step)));
        }
    }

    @Test
    void termsPointAtTheRightNeighbours() {
        SimulationResult result = everyComponent();

        result.explanations().forEach((id, steps) -> steps.forEach(step -> step.terms().stream()
                .filter(term -> term.nodeId() != null)
                .forEach(term -> {
                    // 到達量和 backlog 指到上游，成功率和端到端延遲指到下游
                    boolean upstream = List.of("進來多少", "從 primary 複製", "留在 queue 的訊息").contains(step.group());
                    Set<String> neighbours = EVERY_COMPONENT_EDGES.stream()
                            .filter(edge -> (upstream ? edge.target() : edge.source()).equals(id))
                            .map(edge -> upstream ? edge.source() : edge.target())
                            .collect(Collectors.toSet());
                    assertThat(neighbours).as("%s: %s %s", id, step.label(), term.symbol()).contains(term.nodeId());
                })));
    }

    @Test
    void termsFollowTheEdgeOrder() {
        SimulationResult result = everyComponent();
        // DB 的上游依邊的輸入順序：Cache（e7）、API（e8）、Worker（e14）
        assertThat(step(result.explanations().get("db"), "write 到達量").terms())
                .extracting(ExplanationTerm::nodeId).containsExactly("cache", null, "api", null, "worker", null);
        // API 平行呼叫的下游依出邊順序
        assertThat(step(result.explanations().get("api"), "read 端到端延遲").terms())
                .extracting(ExplanationTerm::nodeId).filteredOn(nodeId -> nodeId != null)
                .containsExactly("cache", "replica", "pay", "mq");
    }

    @Test
    void mm1StepsAreLockedIn() {
        // spec 4.6：λ = 80、c = 1、μ = 100 → ρ = 0.8、Wq = 40 ms、W = 50 ms
        List<ExplanationStep> steps = clientServiceDb(80, new CapacityParams(1, 1, 10)).explanations().get("svc");

        assertThat(steps).extracting(ExplanationStep::group, ExplanationStep::label, ExplanationStep::formula)
                .containsExactly(
                        tuple("進來多少", "read 到達量 λ_read（上游處理完的 × visits）", "{x₁} × {v₁}"),
                        tuple("進來多少", "write 到達量 λ_write（上游處理完的 × visits）", "{x₁} × {v₁}"),
                        tuple("進來多少", "到達量 λ", "{λ_read} + {λ_write}"),
                        tuple("能處理多少", "worker 數 c", "{instances} × {concurrency}"),
                        tuple("能處理多少", "每個 worker 的服務率 μ", "1000 ÷ {serviceTimeMs}"),
                        tuple("能處理多少", "容量", "{c} × {μ}"),
                        tuple("能處理多少", "使用率 ρ（0.7 ≤ ρ < 0.9：WARN）", "{λ} ÷ ({c} × {μ})"),
                        tuple("在這裡花多久", "負載 a", "{λ} ÷ {μ}"),
                        tuple("在這裡花多久", "等待機率 P_wait", "ErlangC({c}, {a})"),
                        tuple("在這裡花多久", "平均排隊時間 Wq", "{P_wait} ÷ ({c} × {μ} − {λ}) × 1000"),
                        tuple("在這裡花多久", "排隊", ""),
                        tuple("在這裡花多久", "節點延遲 W", "{Wq} + {1/μ}"),
                        tuple("成功率", "read 通過率 pass", "{處理量} ÷ {λ}"),
                        tuple("成功率", "read 成功率 S（從這裡開始到完整成功）", "{pass} × {S₁}^{k₁}"),
                        tuple("成功率", "write 通過率 pass", "{處理量} ÷ {λ}"),
                        tuple("成功率", "write 成功率 S（從這裡開始到完整成功）", "{pass} × {S₁}^{k₁}"),
                        tuple("到完成要多久", "read 端到端延遲 L（從這裡開始）", "{W} + {v₁} × ({d₁} + {L₁})"),
                        tuple("到完成要多久", "write 端到端延遲 L（從這裡開始）", "{W} + {v₁} × ({d₁} + {L₁})"));
        // DB 的延遲是 1 ms 加上極小的排隊時間
        double db = 1 + 1e-6;
        List<Double> expected = List.of(72.0, 8.0, 80.0, 1.0, 100.0, 100.0, 0.8, 0.8, 0.8, 40.0, 40.0, 50.0, 1.0, 1.0,
                1.0, 1.0, 50 + 1 + db, 50 + 1 + db);
        assertThat(steps).extracting(ExplanationStep::value).hasSameSizeAs(expected);
        for (int i = 0; i < expected.size(); i++) {
            assertThat(steps.get(i).value()).as(steps.get(i).label()).isCloseTo(expected.get(i), within(1e-3));
        }
        assertThat(step(steps, "read 到達量").terms()).containsExactly(new ExplanationTerm("x₁", 72.0, "rps", "client"),
                new ExplanationTerm("v₁", 1.0, "%", null));
        // 容量只有白話用到，接在公式的代入值後面
        assertThat(step(steps, "使用率 ρ").terms()).containsExactly(new ExplanationTerm("λ", 80.0, "rps", null),
                new ExplanationTerm("c", 1.0, null, null), new ExplanationTerm("μ", 100.0, "rps", null),
                new ExplanationTerm("容量", 100.0, "rps", null));
        assertThat(step(steps, "read 端到端延遲").terms()).extracting(ExplanationTerm::symbol, ExplanationTerm::nodeId)
                .containsExactly(tuple("W", null), tuple("v₁", null), tuple("d₁", null), tuple("L₁", "db"));
    }

    @Test
    void overloadedNodeExplainsTheDropsAndHasNoLatency() {
        SimulationResult result = clientServiceDb(150, new CapacityParams(1, 1, 10));
        List<ExplanationStep> steps = result.explanations().get("svc");

        assertThat(step(steps, "使用率 ρ").label()).isEqualTo("使用率 ρ（ρ ≥ 1：OVERLOADED）");
        assertThat(step(steps, "處理量").value()).isCloseTo(100, within(EPS));
        assertThat(step(steps, "超過容量、丟棄").value()).isEqualTo(result.nodes().get("svc").droppedRps());
        assertThat(step(steps, "節點延遲 W").value()).isNull();
        assertThat(step(steps, "read 通過率").value()).isCloseTo(100.0 / 150, within(EPS));
        // 端到端延遲沒有定義，代入的 W 也是 null
        assertThat(step(steps, "read 端到端延遲").value()).isNull();
        assertThat(term(step(steps, "read 端到端延遲"), "W").value()).isNull();
    }

    @Test
    void fanOutSuccessUsesEachCallAsAnExponent() {
        // spec 4.6：DB-A 收到 2000 rps、容量 1800，pass = 0.9；S = 0.9² × 1 = 0.81
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, workers(18)),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, AMPLE)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "a", 1, 2, 1),
                        new Edge("e3", "svc", "b", 1, 1, 1))));
        ExplanationStep service = step(result.explanations().get("svc"), "read 成功率");
        List<ExplanationStep> client = result.explanations().get("client");

        assertThat(service.formula()).isEqualTo("{pass} × {S₁}^{k₁} × {S₂}^{k₂}");
        assertThat(service.value()).isCloseTo(0.81, within(EPS));
        assertThat(term(service, "S₁")).extracting(ExplanationTerm::nodeId).isEqualTo("a");
        assertThat(term(service, "S₁").value()).isCloseTo(0.9, within(EPS));
        assertThat(term(service, "k₁").value()).isEqualTo(2.0);
        assertThat(term(service, "S₂").nodeId()).isEqualTo("b");
        assertThat(term(service, "k₂").value()).isEqualTo(1.0);
        assertThat(step(client, "read 成功率").formula()).isEqualTo("{p₁} × {S₁}");
        assertThat(step(client, "每秒完整成功").value()).isCloseTo(810, within(EPS));
    }

    @Test
    void unconnectedNodeHasNoStepsButIdleNodeDoes() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 0, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, AMPLE, 0.8)),
                List.of(new Edge("e1", "client", "svc", 1, 1, 1))));

        assertThat(result.explanations().get("cache")).isEmpty();
        List<ExplanationStep> svc = result.explanations().get("svc");
        assertThat(step(svc, "到達量 λ").value()).isZero();
        assertThat(step(svc, "使用率 ρ").value()).isZero();
        // 沒有流量的 class 不算成功率和端到端延遲
        assertThat(svc).noneMatch(step -> step.group().equals("成功率") || step.group().equals("到完成要多久"));
    }

    @Test
    void hotSpotExplainsEachSideAndTheWholeNode() {
        SimulationResult result = everyComponent();
        NodeResult cache = result.nodes().get("cache");
        List<ExplanationStep> steps = result.explanations().get("cache");

        assertThat(steps).extracting(ExplanationStep::group).containsSubsequence("進來多少", "最熱那台", "其他 2 台",
                "整個節點", "往下游送多少");
        assertThat(step(inGroup(steps, "最熱那台"), "到達量 λ").value())
                .isEqualTo(cache.hotSpot().hottest().arrivalRps().total());
        assertThat(step(steps, "使用率 ρ（取較高的一邊").value()).isEqualTo(cache.utilization());
        assertThat(step(steps, "容量（全部 3 台）").value()).isEqualTo(cache.capacityRps());
        assertThat(step(steps, "處理量").value()).isEqualTo(cache.throughputRps());
    }

    /** Worker 容量 600，收到 1000：處理 600，backlog 每秒 +400，不算丟棄。 */
    private SimulationResult backlog() {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new ServiceNode("api", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, AMPLE),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, workers(6), CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, AMPLE)),
                List.of(
                        new Edge("e1", "client", "api", 1, 1, 1),
                        new Edge("enqueue", "api", "mq", 1, 1, 2),
                        new Edge("consume", "mq", "worker", 1, 1, 50),
                        new Edge("store", "worker", "db", 1, 1, 50))));
    }

    @Test
    void backlogStepsMatchTheEdgeAndTheDrops() {
        SimulationResult result = backlog();
        List<ExplanationStep> steps = result.explanations().get("worker");

        assertThat(step(steps, "每秒留在 Queue 的訊息").value())
                .isEqualTo(result.edges().get("consume").backlogRps());
        // 留在 queue 的不算丟棄，所以這一步不叫「丟棄」
        assertThat(step(steps, "超過容量").label()).isEqualTo("超過容量");
        assertThat(step(steps, "超過容量").value()).isCloseTo(400, within(EPS));
        assertThat(step(steps, "丟棄量（留在 queue 的不算）").value()).isEqualTo(result.nodes().get("worker").droppedRps());
        assertThat(step(result.explanations().get("mq"), "write 成功率").formula())
                .isEqualTo("{pass}（訊息進到 queue 就算成功，consumer 的處理是非同步的）");
    }

    /** Limiter 放行 500；Replica 容量 100，收到 450 read + 50 複製寫入 → 過載，丟到複製寫入。 */
    private SimulationResult limiterAndLaggingReplica() {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new RateLimiterNode("rl", "Limiter", NodeHealth.HEALTHY, 500),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "Primary", NodeHealth.HEALTHY, AMPLE),
                        new ReadReplicaNode("replica", "Replica", NodeHealth.HEALTHY, workers(1))),
                List.of(
                        new Edge("e1", "client", "rl", 1, 1, 1),
                        new Edge("e2", "rl", "svc", 1, 1, 1),
                        new Edge("write", "svc", "db", 1, 1, 2, RequestClass.WRITE),
                        new Edge("read", "svc", "replica", 1, 1, 2, RequestClass.READ),
                        new Edge("repl", "db", "replica", 1, 1, 50))));
    }

    @Test
    void rateLimiterAndReplicaLag() {
        SimulationResult result = limiterAndLaggingReplica();
        NodeResult replica = result.nodes().get("replica");

        assertThat(step(result.explanations().get("rl"), "拒絕量").label()).isEqualTo("拒絕量（λ > limitRps：限流中）");
        assertThat(step(result.explanations().get("rl"), "拒絕量").value()).isEqualTo(result.nodes().get("rl").rejectedRps());
        assertThat(step(result.explanations().get("replica"), "丟掉的複製寫入").value())
                .isCloseTo(replica.droppedRps() * replica.arrivalRps().write() / replica.arrivalRps().total(),
                        within(EPS));
        assertThat(step(result.explanations().get("replica"), "複製寫入").terms())
                .containsExactly(new ExplanationTerm("primary 的 write", result.edges().get("repl").rps().write(), "rps",
                        "db"));
        // 複製是非同步的，不在 primary 的路徑上
        assertThat(step(result.explanations().get("db"), "write 端到端延遲").formula())
                .isEqualTo("{W}（非同步的下游不在路徑上）");
    }

    /** 起始拓撲：Users 1000 rps（read 90%）─30 ms→ API（2 × 200，50 ms）─1 ms→ DB（1 × 100，10 ms）。 */
    private SimulationResult startingTopology() {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("api", "API", NodeHealth.HEALTHY, new CapacityParams(2, 200, 50),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 100, 10))),
                List.of(
                        new Edge("e1", "client", "api", 1, 1, 30),
                        new Edge("e2", "api", "db", 1, 1, 1))));
    }

    private static final Map<String, String> NAMES = Map.of("client", "Users", "api", "API", "db", "DB", "svc", "API",
            "rl", "Limiter", "replica", "Replica", "mq", "Queue", "worker", "Worker");

    /** 白話模式看得到的每一行，代入數字之後。 */
    private static List<String> plain(List<ExplanationStep> steps) {
        return steps.stream().filter(step -> step.view() != ExplanationView.FORMULA)
                .map(step -> PlainText.render(step, id -> NAMES.getOrDefault(id, id))).toList();
    }

    @Test
    void startingTopologyReadsLikePlainChinese() {
        SimulationResult result = startingTopology();

        assertThat(plain(result.explanations().get("api"))).containsExactly(
                "每秒進來 900 = Users 處理完的 900 × 100.0%",
                "每秒進來 100 = Users 處理完的 100 × 100.0%",
                "合計每秒進來 1,000 = read 900 ＋ write 100",
                "同時能處理 400 個 = 機器數 2 × 每台並行數 200",
                "每個每秒處理 20 個 = 1000 ÷ 處理時間 50.0 ms",
                "每秒能處理 8,000 = 400 × 20",
                "使用率 ρ 0.13 = 每秒進來 1,000 ÷ 每秒能處理 8,000（低於 0.7，正常）",
                "排隊：幾乎不用排隊（要排隊的機率 < 0.1%）",
                "在這裡花 50.0 ms = 處理 50.0（幾乎不用排隊）",
                "沒被丟掉的比例 100.0% = 處理 1,000 ÷ 進來 1,000",
                "從這裡往下都成功的機率 100.0% = 沒被丟掉的 100.0% × DB 成功 100.0%",
                "沒被丟掉的比例 100.0% = 處理 1,000 ÷ 進來 1,000",
                "從這裡往下都成功的機率 100.0% = 沒被丟掉的 100.0% × DB 成功 100.0%",
                "從這裡到完成要 61.0 ms = 在這裡 50.0 ＋ 連線 1.0 ＋ DB 之後 10.0",
                "從這裡到完成要 61.0 ms = 在這裡 50.0 ＋ 連線 1.0 ＋ DB 之後 10.0");
        assertThat(plain(result.explanations().get("client"))).containsExactly(
                "每秒 900 = 每秒請求數 1,000 × 讀取比例 90.0%",
                "每秒 100 = 1,000 − 900",
                "完整成功的機率 100.0% = 分到 API 的 100.0% × 成功 100.0%",
                "完整成功的機率 100.0% = 分到 API 的 100.0% × 成功 100.0%",
                "每秒完整成功 1,000 = read 900 × 100.0% ＋ write 100 × 100.0%",
                "使用者感受到的延遲 91.0 ms = 連線 30.0 ＋ API 之後 61.0",
                "使用者感受到的延遲 91.0 ms = 連線 30.0 ＋ API 之後 61.0");
        // DB 沒有下游
        assertThat(plain(result.explanations().get("db")))
                .contains("從這裡往下都成功的機率 100.0% = 沒被丟掉的比例 100.0%（沒有下游）");
    }

    @Test
    void readAndWriteStepsAreTaggedForMerging() {
        List<ExplanationStep> steps = startingTopology().explanations().get("api");

        assertThat(steps).filteredOn(step -> step.requestClass() == RequestClass.READ).extracting(ExplanationStep::label)
                .containsExactly("read 到達量 λ_read（上游處理完的 × visits）", "read 通過率 pass",
                        "read 成功率 S（從這裡開始到完整成功）", "read 端到端延遲 L（從這裡開始）");
        assertThat(steps).filteredOn(step -> step.requestClass() == RequestClass.WRITE).hasSize(4);
        assertThat(step(startingTopology().explanations().get("client"), "read").requestClass())
                .isEqualTo(RequestClass.READ);
        // 合計、容量、排隊不分 class
        assertThat(step(steps, "到達量 λ").requestClass()).isNull();
        assertThat(step(steps, "使用率 ρ").requestClass()).isNull();
    }

    @Test
    void queueingStepsCollapseIntoOnePlainLine() {
        // M/M/1 的 ρ = 0.8：Wq = 40 ms，80% 的請求要排隊
        List<ExplanationStep> steps = clientServiceDb(80, new CapacityParams(1, 1, 10)).explanations().get("svc");

        assertThat(steps).filteredOn(step -> step.view() == ExplanationView.FORMULA).extracting(ExplanationStep::label)
                .containsExactly("負載 a", "等待機率 P_wait", "平均排隊時間 Wq");
        assertThat(steps).filteredOn(step -> step.view() == ExplanationView.PLAIN).extracting(ExplanationStep::label)
                .containsExactly("排隊");
        assertThat(plain(steps)).contains("排隊：平均要等 40.0 ms（80.0% 的請求要排隊）",
                "在這裡花 50.0 ms = 排隊 40.0 ＋ 處理 10.0", "使用率 ρ 0.80 = 每秒進來 80 ÷ 每秒能處理 100（0.7 以上，偏忙）");
    }

    @Test
    void overloadedNodeSaysWhatCannotBeProcessed() {
        SimulationResult result = clientServiceDb(150, new CapacityParams(1, 1, 10));

        assertThat(plain(result.explanations().get("svc"))).contains(
                "使用率 ρ 1.50 = 每秒進來 150 ÷ 每秒能處理 100（1 以上，處理不完）",
                "每秒只處理得了 100（能處理的上限）",
                "每秒丟掉 50 = 進來 150 − 能處理的 100",
                "在這裡花多久：沒有定義（處理不完，排隊會一直變長）",
                "到完成要多久：沒有定義（這裡處理不完）");
        assertThat(plain(result.explanations().get("client")))
                .contains("使用者感受到的延遲：沒有定義（路徑上有節點處理不完）");
    }

    @Test
    void everyComponentHasPlainLines() {
        SimulationResult result = everyComponent();
        Map<String, List<ExplanationStep>> explanations = result.explanations();
        double hottest = result.nodes().get("cache").hotSpot().hottest().arrivalRps().total();
        double cacheIn = result.nodes().get("cache").arrivalRps().total();

        assertThat(plain(explanations.get("rl"))).contains("每秒拒絕 0（沒超過限流上限，未觸發）",
                "Rate Limiter 本身不花時間（假設它不會成為瓶頸）");
        assertThat(plain(explanations.get("pay"))).contains("固定花回應延遲 100.0 ms");
        assertThat(plain(explanations.get("cache"))).contains(String.format(
                "每秒進來 %,d = 整個節點進來 %,d × 最熱那台的流量占比 50.0%%", Math.round(hottest), Math.round(cacheIn)));
        assertThat(plain(explanations.get("cache"))).anyMatch(line -> line.startsWith("沒命中、往下游送的 read 每秒 "));
        assertThat(plain(explanations.get("replica"))).anyMatch(line -> line.startsWith("從 DB 複製來的 write 每秒 "));
        // API 平行呼叫下游
        assertThat(plain(explanations.get("api"))).anyMatch(line -> line.contains("取最慢的下游 max("));
    }

    /**
     * 其他分支：熱點 Cache 最熱那台過載、命中率 100% 的 Cache、External API 超過配額、平行呼叫同一個下游兩次、
     * 下游過載時的端到端延遲、
     * 處理時間很短又在排隊的 Cache（都接到同一個 DB）。
     */
    private SimulationResult edgeCases() {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("api", "API", NodeHealth.HEALTHY, AMPLE, CallMode.PARALLEL),
                        new CacheNode("hot", "Hot", NodeHealth.HEALTHY, new CapacityParams(3, 1, 5), 1, 0.9),
                        new CacheNode("fast", "Fast", NodeHealth.HEALTHY, new CapacityParams(1, 1, 0.05), 1),
                        new ExternalApiNode("pay", "Payments", NodeHealth.HEALTHY, 100, 500),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, AMPLE)),
                List.of(
                        new Edge("e1", "client", "api", 1, 1, 1),
                        new Edge("e2", "api", "hot", 1, 1, 1),
                        new Edge("e3", "api", "fast", 1, 1, 1),
                        new Edge("e4", "api", "pay", 1, 2, 1),
                        new Edge("e5", "hot", "db", 1, 1, 1),
                        new Edge("e6", "fast", "db", 1, 1, 1))));
    }

    @Test
    void edgeCasesHavePlainLines() {
        SimulationResult result = edgeCases();
        Map<String, List<ExplanationStep>> explanations = result.explanations();
        assertThat(result.valid()).as("%s", result.errors()).isTrue();

        assertThat(result.nodes().get("hot").hotSpot().hottest().utilization()).isGreaterThan(1);
        assertThat(plain(explanations.get("hot"))).contains("平均要排隊多久：沒有定義（有流量的一邊處理不完）",
                "在這裡花多久：沒有定義（有流量的一邊處理不完）");
        // 平行呼叫，Payments 每個請求呼叫 2 次，配額 500：收到 2000，拒絕 1500
        assertThat(plain(explanations.get("pay"))).contains("每秒拒絕 1,500 = 進來 2,000 − 放行 500（超過配額）");
        // Hot 過載，API 的端到端延遲沒有定義
        assertThat(plain(explanations.get("api"))).contains("到完成要多久：沒有定義（下游有節點處理不完）");
        // 處理時間 0.05 ms：Wq 雖然小於 0.1 ms，但超過處理時間的 1%，不能說幾乎不用排隊
        ExplanationStep fast = step(explanations.get("fast"), "節點延遲 W");
        assertThat(result.nodes().get("fast").avgQueueMs()).isLessThan(0.1).isGreaterThan(0.05 * 0.01);
        assertThat(fast.plain()).isEqualTo("在這裡花 {=} ms = 排隊 {Wq} ＋ 處理 {1/μ}");
    }

    @Test
    void readAndWriteStepsPairUpByOrderWithinAGroup() {
        // 同一組裡第 k 個 READ 對第 k 個 WRITE（spec 4.9）：去掉 read、write 之後名稱相同
        everyComponent().explanations().forEach((id, steps) -> {
            for (String group : steps.stream().map(ExplanationStep::group).distinct().toList()) {
                List<String> reads = classLabels(inGroup(steps, group), RequestClass.READ, "read");
                List<String> writes = classLabels(inGroup(steps, group), RequestClass.WRITE, "write");
                if (!reads.isEmpty() && !writes.isEmpty()) {
                    assertThat(writes).as("%s %s", id, group).isEqualTo(reads);
                }
            }
        });
    }

    private static List<String> classLabels(List<ExplanationStep> steps, RequestClass requestClass, String name) {
        return steps.stream().filter(step -> step.requestClass() == requestClass)
                .map(step -> step.label().replace(name, "")).toList();
    }

    @Test
    void backlogAndLimiterHavePlainLines() {
        assertThat(plain(backlog().explanations().get("worker"))).contains(
                "每秒處理不完 400 = 進來 1,000 − 能處理的 600",
                "每秒留在 Queue 的訊息 400（處理不完的，加上下游失敗的）");
        SimulationResult limited = limiterAndLaggingReplica();
        assertThat(plain(limited.explanations().get("rl")))
                .contains("每秒拒絕 500 = 進來 1,000 − 放行 500（超過限流上限，限流中）");
        assertThat(plain(limited.explanations().get("replica")))
                .anyMatch(line -> line.matches("每秒有 [0-9,]+ 筆複製寫入跟不上（replication lag 會一直變大）"));
    }
}
