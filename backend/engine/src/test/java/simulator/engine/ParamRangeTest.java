package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
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
                client(100, -0.1), client(100, 1.1), client(100, Double.NaN));
    }

    static Stream<CapacityParams> invalidCapacityParams() {
        return Stream.of(new CapacityParams(0, 100, 10), new CapacityParams(1, 0, 10), new CapacityParams(1, 100, 0),
                new CapacityParams(1, 100, -5), new CapacityParams(1, 100, Double.NaN),
                new CapacityParams(1, 100, Double.POSITIVE_INFINITY));
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
    void largeInstanceTimesConcurrencyDoesNotOverflow() {
        // 100,000 × 100,000 = 1e10 個 worker，超過 int 範圍
        SimulationResult result = run(client(1000, 0.9), new CapacityParams(100_000, 100_000, 10),
                clientEdge(1, 1, 1), serviceEdge(1, 1, 1));
        NodeResult service = result.nodes().get("s");

        assertThat(service.capacityRps()).isCloseTo(1e12, within(1.0));
        assertThat(service.utilization()).isCloseTo(1e-9, within(1e-15));
        assertThat(service.avgLatencyMs()).isCloseTo(10, within(1e-9));
        assertThat(service.status()).isEqualTo(Status.OK);
    }
}
