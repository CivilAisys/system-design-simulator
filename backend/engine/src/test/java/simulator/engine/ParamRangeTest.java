package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import java.lang.reflect.RecordComponent;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

/** 參數範圍（spec 3.2、4.5）：不合法時回傳 INVALID_PARAM，附上有問題的節點或邊。 */
class ParamRangeTest {

    private static final CapacityParams CAPACITY = new CapacityParams(1, 100, 10);

    private final Simulator simulator = new SteadyStateSimulator();

    private SimulationResult run(ClientNode client, CapacityParams serviceCapacity, Edge clientEdge, Edge serviceEdge) {
        return simulator.simulate(new Topology(
                List.of(client,
                        new ServiceNode("s", "API", NodeHealth.HEALTHY, serviceCapacity, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, CAPACITY)),
                List.of(clientEdge, serviceEdge)));
    }

    /** 只有一個 INVALID_PARAM 錯誤，指向 {@code nodeId} 或 {@code edgeId}，訊息包含 {@code messagePart}。 */
    private static void assertInvalidParam(SimulationResult result, String nodeId, String edgeId,
            String messagePart) {
        assertThat(result.valid()).isFalse();
        assertThat(result.errors())
                .extracting(ValidationError::code, ValidationError::nodeId, ValidationError::edgeId)
                .containsExactly(tuple("INVALID_PARAM", nodeId, edgeId));
        assertThat(result.errors().getFirst().message()).contains(messagePart);
    }

    private static ClientNode client(double rps, double readRatio) {
        return new ClientNode("c", "Users", NodeHealth.HEALTHY, rps, readRatio);
    }

    private static Edge clientEdge(double weight, int callsPerRequest, double latencyMs) {
        return new Edge("e1", "c", "s", weight, callsPerRequest, latencyMs);
    }

    private static Edge serviceEdge(double weight, int callsPerRequest, double latencyMs) {
        return new Edge("e2", "s", "db", weight, callsPerRequest, latencyMs);
    }

    static Stream<ClientNode> invalidClients() {
        return Stream.of(client(-1, 0.9), client(Double.NaN, 0.9), client(Double.POSITIVE_INFINITY, 0.9),
                client(1.1e12, 0.9), client(100, -0.1), client(100, 1.1), client(100, Double.NaN));
    }

    static Stream<CapacityParams> invalidCapacityParams() {
        return Stream.of(new CapacityParams(0, 100, 10), new CapacityParams(1, 0, 10), new CapacityParams(1, 100, 0),
                new CapacityParams(1, 100, -5), new CapacityParams(1, 100, Double.NaN),
                new CapacityParams(1, 100, Double.POSITIVE_INFINITY), new CapacityParams(1, 100, 1e-320),
                new CapacityParams(1, 100, 1.1e7), new CapacityParams(1_000_001, 1, 10),
                new CapacityParams(1, 1_000_001, 10));
    }

    @ParameterizedTest
    @MethodSource("invalidClients")
    void invalidClientParamsAreRejected(ClientNode client) {
        assertInvalidParam(run(client, CAPACITY, clientEdge(1, 1, 1),
                serviceEdge(1, 1, 1)), "c", null, "「Users」");
    }

    @ParameterizedTest
    @MethodSource("invalidCapacityParams")
    void invalidCapacityParamsAreRejected(CapacityParams params) {
        assertInvalidParam(run(client(100, 0.9),
                params, clientEdge(1, 1, 1), serviceEdge(1, 1, 1)), "s", null, "「API」");
    }

    @Test
    void negativeClientEdgeWeightIsRejected() {
        assertInvalidParam(run(client(100, 0.9),
                CAPACITY, clientEdge(-1, 1, 1), serviceEdge(1, 1, 1)), null, "e1", "weight");
    }

    @Test
    void invalidLoadBalancerParamsAreRejected() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client(100, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, new CapacityParams(0, 100, 10)),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, CAPACITY)),
                List.of(new Edge("e1", "c", "lb", 1, 1, 1), new Edge("e2", "lb", "db", 1, 1, 1))));

        assertInvalidParam(result, "lb", null, "instances");
    }

    @Test
    void negativeLoadBalancerEdgeWeightIsRejected() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client(100, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, CAPACITY),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, CAPACITY)),
                List.of(new Edge("e1", "c", "lb", 1, 1, 1), new Edge("e2", "lb", "db", -1, 1, 1))));

        assertInvalidParam(result, null, "e2", "weight");
    }

    @ParameterizedTest
    @ValueSource(doubles = {-0.1, 1.1, Double.NaN})
    void invalidCacheHitRatioIsRejected(double hitRatio) {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client(100, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, CAPACITY, hitRatio),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, CAPACITY)),
                List.of(new Edge("e1", "c", "cache", 1, 1, 1), new Edge("e2", "cache", "db", 1, 1, 1))));

        assertInvalidParam(result, "cache", null, "hitRatio");
    }

    @Test
    void serviceEdgeWithLessThanOneCallIsRejected() {
        assertInvalidParam(run(client(100, 0.9),
                CAPACITY, clientEdge(1, 1, 1), serviceEdge(1, 0, 1)), null, "e2", "callsPerRequest");
    }

    @Test
    void negativeLatencyIsRejected() {
        assertInvalidParam(run(client(100, 0.9),
                CAPACITY, clientEdge(1, 1, 1), serviceEdge(1, 1, -1)), null, "e2", "latencyMs");
    }

    @Test
    void fieldsThatDoNotApplyToTheSourceAreIgnored() {
        // weight 只用在 Client／LB 的邊，callsPerRequest 只用在 Service 的邊
        assertThat(run(client(100, 0.9), CAPACITY, clientEdge(1, 0, 1), serviceEdge(-1, 1, 1)).valid()).isTrue();
    }

    @Test
    void workerLimitAppliesToInstancesTimesConcurrency() {
        // 各自都在上限內，乘積 2e9 超過
        assertInvalidParam(run(client(100, 0.9), new CapacityParams(40_000, 50_000, 10),
                clientEdge(1, 1, 1), serviceEdge(1, 1, 1)), "s", null, "instances × concurrency 必須 ≤ 1,000,000");
    }

    @Test
    void outOfRangeEdgeParamsAreRejected() {
        assertInvalidParam(run(client(100, 0.9), CAPACITY, clientEdge(1.1e6, 1, 1), serviceEdge(1, 1, 1)),
                null, "e1", "weight 必須 > 0 且 ≤ 1,000,000");
        assertInvalidParam(run(client(100, 0.9), CAPACITY, clientEdge(1, 1, 1), serviceEdge(1, 10_001, 1)),
                null, "e2", "callsPerRequest 必須 介於 1 和 10,000 之間");
        assertInvalidParam(run(client(100, 0.9), CAPACITY, clientEdge(1, 1, 1.1e7), serviceEdge(1, 1, 1)),
                null, "e1", "latencyMs 必須 介於 0 和 10,000,000 之間");
    }

    @Test
    void messageStatesTheRange() {
        assertInvalidParam(run(client(100, 0.9), new CapacityParams(1, 100, 0), clientEdge(1, 1, 1),
                serviceEdge(1, 1, 1)), "s", null, "serviceTimeMs 必須 介於 0.000001 和 10,000,000 之間，目前是 0");
    }

    @Test
    void largestWorkerCountIsAccepted() {
        SimulationResult result = run(client(1000, 0.9), new CapacityParams(1000, 1000, 10),
                clientEdge(1, 1, 1), serviceEdge(1, 1, 1));
        NodeResult service = result.nodes().get("s");

        assertThat(service.capacityRps()).isCloseTo(1e8, within(1e-3));
        assertThat(service.avgLatencyMs()).isCloseTo(10, within(1e-9));
        assertThat(service.status()).isEqualTo(Status.OK);
    }

    @Test
    void extremeValuesWithinTheLimitsRunFastAndStayFinite() {
        // 每個上限都踩到：最多 worker、使用率接近 1、最短處理時間、最大 rps／calls／weight／latency
        var maxed = new CapacityParams(1000, 1000, 1e-6);
        // 最多 worker 且使用率接近 1 時 Erlang C 算最久；容量 1e12 剛好是 rps 上限
        var busiest = new CapacityParams(1000, 1000, 0.001);
        List<Node> nodes = List.of(
                new ClientNode("c1", "A", NodeHealth.HEALTHY, 1e12, 0.5),
                new ClientNode("c2", "B", NodeHealth.HEALTHY, 1e12, 0.5),
                new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, maxed),
                new ServiceNode("s", "API", NodeHealth.HEALTHY, maxed, CallMode.PARALLEL),
                new CacheNode("cache", "Redis", NodeHealth.HEALTHY, maxed, 0),
                new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 1, 1e7)));
        List<Edge> edges = List.of(
                new Edge("e1", "c1", "lb", 1e6, 1, 1e7), new Edge("e2", "c2", "lb", 1e6, 1, 1e7),
                new Edge("e3", "lb", "s", 1e6, 1, 1e7), new Edge("e4", "s", "cache", 1, 10_000, 1e7),
                new Edge("e5", "cache", "db", 1, 1, 1e7));
        var nearFull = new Topology(List.of(
                new ClientNode("c", "A", NodeHealth.HEALTHY, busiest.capacityRps() * 0.999999, 0.5),
                new ServiceNode("s", "API", NodeHealth.HEALTHY, busiest, CallMode.SEQUENTIAL)),
                List.of(new Edge("e1", "c", "s", 1, 1, 0)));

        long start = System.nanoTime();
        SimulationResult overloaded = simulator.simulate(new Topology(nodes, edges));
        SimulationResult busy = simulator.simulate(nearFull);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;

        assertThat(elapsedMs).isLessThan(1000);
        assertThat(overloaded.errors()).isEmpty();
        assertThat(busy.errors()).isEmpty();
        assertThat(busy.nodes().get("s").avgLatencyMs()).isNotNull();
        assertAllFinite(overloaded);
        assertAllFinite(busy);
    }

    /** 結果裡每個數字都不是 NaN 或無限大（JSON 會變成字串 "Infinity"）；null 代表沒有定義，不算。 */
    private static void assertAllFinite(Object value) {
        switch (value) {
            case Double number -> assertThat(number).isFinite();
            case Record record -> {
                for (RecordComponent component : record.getClass().getRecordComponents()) {
                    try {
                        Object field = component.getAccessor().invoke(record);
                        if (field != null) {
                            assertAllFinite(field);
                        }
                    } catch (ReflectiveOperationException e) {
                        throw new AssertionError(e);
                    }
                }
            }
            case Collection<?> items -> items.forEach(ParamRangeTest::assertAllFinite);
            case Map<?, ?> map -> map.values().forEach(ParamRangeTest::assertAllFinite);
            default -> {
            }
        }
    }
}
