package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** 參數範圍（spec 3.2、4.5）：不合法時 simulate() 丟 IllegalArgumentException。 */
class ParamRangeTest {

    private static final Capacity CAPACITY = new Capacity(1, 100, 10);

    private final Simulator simulator = new SteadyStateSimulator();

    private SimulationResult run(ClientNode client, Capacity serviceCapacity, Edge clientEdge, Edge serviceEdge) {
        return simulator.simulate(new Topology(
                List.of(client,
                        new ServiceNode("s", "API", NodeState.HEALTHY, serviceCapacity, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeState.HEALTHY, CAPACITY)),
                List.of(clientEdge, serviceEdge)));
    }

    private static ClientNode client(double rps, double readRatio) {
        return new ClientNode("c", "Users", NodeState.HEALTHY, rps, readRatio);
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

    static Stream<Capacity> invalidCapacities() {
        return Stream.of(new Capacity(0, 100, 10), new Capacity(1, 0, 10), new Capacity(1, 100, 0),
                new Capacity(1, 100, -5), new Capacity(1, 100, Double.NaN),
                new Capacity(1, 100, Double.POSITIVE_INFINITY));
    }

    @ParameterizedTest
    @MethodSource("invalidClients")
    void invalidClientParamsAreRejected(ClientNode client) {
        assertThatThrownBy(() -> run(client, CAPACITY, clientEdge(1, 1, 1), serviceEdge(1, 1, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("c");
    }

    @ParameterizedTest
    @MethodSource("invalidCapacities")
    void invalidCapacityParamsAreRejected(Capacity capacity) {
        assertThatThrownBy(() -> run(client(100, 0.9), capacity, clientEdge(1, 1, 1), serviceEdge(1, 1, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("s");
    }

    @Test
    void negativeClientEdgeWeightIsRejected() {
        assertThatThrownBy(() -> run(client(100, 0.9), CAPACITY, clientEdge(-1, 1, 1), serviceEdge(1, 1, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("e1");
    }

    @Test
    void serviceEdgeWithLessThanOneCallIsRejected() {
        assertThatThrownBy(() -> run(client(100, 0.9), CAPACITY, clientEdge(1, 1, 1), serviceEdge(1, 0, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("e2");
    }

    @Test
    void negativeLatencyIsRejected() {
        assertThatThrownBy(() -> run(client(100, 0.9), CAPACITY, clientEdge(1, 1, 1), serviceEdge(1, 1, -1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("e2");
    }

    @Test
    void fieldsThatDoNotApplyToTheSourceAreIgnored() {
        // weight 只用在 Client／LB 的邊，callsPerRequest 只用在 Service 的邊
        assertThatCode(() -> run(client(100, 0.9), CAPACITY, clientEdge(1, 0, 1), serviceEdge(-1, 1, 1)))
                .doesNotThrowAnyException();
    }

    @Test
    void largeInstanceTimesConcurrencyDoesNotOverflow() {
        // 100,000 × 100,000 = 1e10 個 worker，超過 int 範圍
        SimulationResult result = run(client(1000, 0.9), new Capacity(100_000, 100_000, 10),
                clientEdge(1, 1, 1), serviceEdge(1, 1, 1));
        NodeResult service = result.nodes().get("s");

        assertThat(service.capacityRps()).isCloseTo(1e12, within(1.0));
        assertThat(service.utilization()).isCloseTo(1e-9, within(1e-15));
        assertThat(service.avgLatencyMs()).isCloseTo(10, within(1e-9));
        assertThat(service.status()).isEqualTo(Status.OK);
    }
}
