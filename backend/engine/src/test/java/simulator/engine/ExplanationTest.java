package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** 計算說明（spec 4.9）：步驟的結果和同一次計算的結果相同，代入值指到正確的節點。 */
class ExplanationTest {

    private static final double EPS = 1e-6;
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([^}]+)}");
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
            assertThat(step(inGroup(steps, "到達量"), "到達量 λ").value()).as(id).isEqualTo(node.arrivalRps().total());
            assertThat(step(steps, "節點延遲 W").value()).as(id).isEqualTo(node.avgLatencyMs());
            if (node.utilization() != null) {
                assertThat(step(steps, "使用率 ρ").value()).as(id).isEqualTo(node.utilization());
            }
            if (node.rejectedRps() > 0 || node.capacityRps() == null) {
                assertThat(step(steps, "拒絕量").value()).as(id).isEqualTo(node.rejectedRps());
            }
        });
    }

    @Test
    void placeholdersMatchTheTermsInOrder() {
        everyComponent().explanations().forEach((id, steps) -> steps.forEach(step -> {
            List<String> symbols = new ArrayList<>();
            Matcher matcher = PLACEHOLDER.matcher(step.formula());
            while (matcher.find()) {
                symbols.add(matcher.group(1));
            }
            assertThat(symbols).as("%s: %s", id, step.label())
                    .containsExactlyElementsOf(step.terms().stream().map(ExplanationTerm::symbol).toList());
        }));
    }

    @Test
    void termsPointAtTheRightNeighbours() {
        SimulationResult result = everyComponent();

        result.explanations().forEach((id, steps) -> steps.forEach(step -> step.terms().stream()
                .filter(term -> term.nodeId() != null)
                .forEach(term -> {
                    // 到達量和 backlog 指到上游，成功率和端到端延遲指到下游
                    boolean upstream = step.group().equals("到達量") || step.group().equals("Message Queue 積壓");
                    Set<String> neighbours = EVERY_COMPONENT_EDGES.stream()
                            .filter(edge -> (upstream ? edge.target() : edge.source()).equals(id))
                            .map(edge -> upstream ? edge.source() : edge.target())
                            .collect(Collectors.toSet());
                    assertThat(neighbours).as("%s: %s %s", id, step.label(), term.symbol()).contains(term.nodeId());
                })));
    }

    @Test
    void mm1StepsAreLockedIn() {
        // spec 4.6：λ = 80、c = 1、μ = 100 → ρ = 0.8、Wq = 40 ms、W = 50 ms
        List<ExplanationStep> steps = clientServiceDb(80, new CapacityParams(1, 1, 10)).explanations().get("svc");

        assertThat(steps).extracting(ExplanationStep::group, ExplanationStep::label, ExplanationStep::formula)
                .containsExactly(
                        tuple("到達量", "read 到達量 λ_read", "{λ₁}"),
                        tuple("到達量", "write 到達量 λ_write", "{λ₁}"),
                        tuple("到達量", "到達量 λ", "{λ_read} + {λ_write}"),
                        tuple("容量與使用率", "worker 數 c", "{instances} × {concurrency}"),
                        tuple("容量與使用率", "每個 worker 的服務率 μ", "1000 ÷ {serviceTimeMs}"),
                        tuple("容量與使用率", "容量", "{c} × {μ}"),
                        tuple("容量與使用率", "使用率 ρ（0.7 ≤ ρ < 0.9：WARN）", "{λ} ÷ ({c} × {μ})"),
                        tuple("節點延遲", "負載 a", "{λ} ÷ {μ}"),
                        tuple("節點延遲", "等待機率 P_wait", "ErlangC({c}, {a})"),
                        tuple("節點延遲", "平均排隊時間 Wq", "{P_wait} ÷ ({c} × {μ} − {λ}) × 1000"),
                        tuple("節點延遲", "節點延遲 W", "{Wq} + {1/μ}"),
                        tuple("成功率", "read 通過率 pass", "{處理量} ÷ {λ}"),
                        tuple("成功率", "read 成功率 S（從這裡開始到完整成功）", "{pass} × {S₁}^{k₁}"),
                        tuple("成功率", "write 通過率 pass", "{處理量} ÷ {λ}"),
                        tuple("成功率", "write 成功率 S（從這裡開始到完整成功）", "{pass} × {S₁}^{k₁}"),
                        tuple("端到端延遲", "read 端到端延遲 L（從這裡開始）", "{W} + {v₁} × ({d₁} + {L₁})"),
                        tuple("端到端延遲", "write 端到端延遲 L（從這裡開始）", "{W} + {v₁} × ({d₁} + {L₁})"));
        assertThat(step(steps, "read 到達量").terms()).containsExactly(new ExplanationTerm("λ₁", 72.0, "rps", "client"));
        assertThat(step(steps, "使用率 ρ").value()).isCloseTo(0.8, within(EPS));
        assertThat(step(steps, "等待機率 P_wait").value()).isCloseTo(0.8, within(EPS));
        assertThat(step(steps, "平均排隊時間 Wq").value()).isCloseTo(40, within(EPS));
        assertThat(step(steps, "節點延遲 W").value()).isCloseTo(50, within(EPS));
        assertThat(term(step(steps, "read 端到端延遲"), "L₁").nodeId()).isEqualTo("db");
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
        assertThat(svc).noneMatch(step -> step.group().equals("成功率") || step.group().equals("端到端延遲"));
    }

    @Test
    void hotSpotExplainsEachSideAndTheWholeNode() {
        SimulationResult result = everyComponent();
        NodeResult cache = result.nodes().get("cache");
        List<ExplanationStep> steps = result.explanations().get("cache");

        assertThat(steps).extracting(ExplanationStep::group).containsSubsequence("到達量", "最熱那台", "其他 2 台",
                "整個節點", "往下游");
        assertThat(step(inGroup(steps, "最熱那台"), "到達量 λ").value())
                .isEqualTo(cache.hotSpot().hottest().arrivalRps().total());
        assertThat(step(steps, "使用率 ρ（取較高的一邊").value()).isEqualTo(cache.utilization());
        assertThat(step(steps, "處理量").value()).isEqualTo(cache.throughputRps());
    }

    @Test
    void backlogStepsMatchTheEdgeAndTheDrops() {
        // Worker 容量 600，收到 1000：處理 600，backlog 每秒 +400，不算丟棄
        SimulationResult result = simulator.simulate(new Topology(
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
        List<ExplanationStep> steps = result.explanations().get("worker");

        assertThat(step(steps, "每秒留在 Queue 的訊息").value())
                .isEqualTo(result.edges().get("consume").backlogRps());
        assertThat(step(steps, "超過容量、丟棄").value()).isCloseTo(400, within(EPS));
        assertThat(step(steps, "丟棄量（留在 queue 的不算）").value()).isEqualTo(result.nodes().get("worker").droppedRps());
        assertThat(step(result.explanations().get("mq"), "write 成功率").formula())
                .isEqualTo("{pass}（訊息進到 queue 就算成功，consumer 的處理是非同步的）");
    }

    @Test
    void rateLimiterAndReplicaLag() {
        // Limiter 放行 500；Replica 容量 100，收到 450 read + 50 複製寫入 → 過載，丟到複製寫入
        SimulationResult result = simulator.simulate(new Topology(
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
        NodeResult replica = result.nodes().get("replica");

        assertThat(step(result.explanations().get("rl"), "拒絕量").label()).isEqualTo("拒絕量（λ > limitRps：LIMITING）");
        assertThat(step(result.explanations().get("rl"), "拒絕量").value()).isEqualTo(result.nodes().get("rl").rejectedRps());
        assertThat(step(result.explanations().get("replica"), "丟掉的複製寫入").value())
                .isCloseTo(replica.droppedRps() * replica.arrivalRps().write() / replica.arrivalRps().total(),
                        within(EPS));
        // 複製是非同步的，不在 primary 的路徑上
        assertThat(step(result.explanations().get("db"), "write 端到端延遲").formula())
                .isEqualTo("{W}（非同步的下游不在路徑上）");
    }
}
