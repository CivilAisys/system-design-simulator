package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** 端到端延遲（spec 4.3）。 */
class EndToEndLatencyTest {

    private static final double EPS = 1e-6;

    private final Simulator simulator = new SteadyStateSimulator();

    /** worker 很多、負載很低：排隊時間為 0，W 剛好等於 serviceTimeMs。 */
    private static CapacityParams fixedLatency(double ms) {
        return new CapacityParams(1, 10_000, ms);
    }

    private static void assertLatencies(ClassLatencies actual, Double read, Double write) {
        assertLatency(actual.read(), read);
        assertLatency(actual.write(), write);
    }

    private static void assertLatency(Double actual, Double expected) {
        if (expected == null) {
            assertThat(actual).isNull();
        } else {
            assertThat(actual).isCloseTo(expected, within(EPS));
        }
    }

    /** spec 4.6：Service W = 50ms，兩個下游 L = 10ms、30ms，邊 latency = 1ms。Client 到 Service 的邊不算延遲。 */
    private SimulationResult runTwoDownstreams(CallMode callMode, int callsToA) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 100, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, fixedLatency(50), callMode),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, fixedLatency(10)),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, fixedLatency(30))),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 0),
                        new Edge("e2", "svc", "a", 1, callsToA, 1),
                        new Edge("e3", "svc", "b", 1, 1, 1))));
    }

    @Test
    void sequentialCallsAddUp() {
        // L = 50 + 12 + 32
        SimulationResult result = runTwoDownstreams(CallMode.SEQUENTIAL, 1);

        assertLatencies(result.nodes().get("client").endToEndMs(), 94.0, 94.0);
        assertLatencies(result.summary().avgEndToEndMs(), 94.0, 94.0);
    }

    @Test
    void parallelCallsTakeTheSlowestDownstream() {
        // L = 50 + max(12, 32)
        SimulationResult result = runTwoDownstreams(CallMode.PARALLEL, 1);

        assertLatencies(result.nodes().get("client").endToEndMs(), 82.0, 82.0);
    }

    @Test
    void parallelCallsToTheSameDownstreamStillAddUp() {
        // 同一個下游呼叫 3 次仍依序：L = 50 + max(3 × 12, 32)
        SimulationResult result = runTwoDownstreams(CallMode.PARALLEL, 3);

        assertLatencies(result.nodes().get("client").endToEndMs(), 86.0, 86.0);
    }

    @Test
    void loadBalancerAveragesDownstreamsByWeight() {
        // L = 1 + 0.25 × 12 + 0.75 × 32
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 100, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, fixedLatency(1)),
                        new ServiceNode("a", "A", NodeHealth.HEALTHY, fixedLatency(10), CallMode.SEQUENTIAL),
                        new ServiceNode("b", "B", NodeHealth.HEALTHY, fixedLatency(30), CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 0),
                        new Edge("e2", "lb", "a", 1, 1, 1),
                        new Edge("e3", "lb", "b", 3, 1, 1))));

        assertLatencies(result.nodes().get("client").endToEndMs(), 28.0, 28.0);
    }

    @Test
    void cacheReadsGoDownstreamOnlyOnMiss() {
        // Cache read：1 + 0.2 × (2 + 10) = 3.4；write：1 + 2 + 10 = 13；Client 再加上自己那條邊的 2ms
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 100, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, fixedLatency(1), 0.8),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, fixedLatency(10))),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 1),
                        new Edge("e2", "cache", "db", 1, 1, 1))));

        assertLatencies(result.nodes().get("client").endToEndMs(), 5.4, 15.0);
    }

    @Test
    void summaryWeightsClientsByRequestCount() {
        // read：(100 × 10 + 300 × 30) / 400 = 25；兩個 Client 都沒有 write 流量，分母為 0
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("web", "Web", NodeHealth.HEALTHY, 100, 1),
                        new ClientNode("mobile", "Mobile", NodeHealth.HEALTHY, 300, 1),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, fixedLatency(10)),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, fixedLatency(30))),
                List.of(
                        new Edge("e1", "web", "a", 1, 1, 0),
                        new Edge("e2", "mobile", "b", 1, 1, 0))));

        assertLatencies(result.nodes().get("web").endToEndMs(), 10.0, 10.0);
        assertLatencies(result.nodes().get("mobile").endToEndMs(), 30.0, 30.0);
        assertLatencies(result.summary().avgEndToEndMs(), 25.0, null);
    }

    @Test
    void overloadedNodeOnThePathMakesLatencyUndefined() {
        // web 的 Service 容量 100、λ = 150 → 過載；mobile 走另一條路不受影響
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("web", "Web", NodeHealth.HEALTHY, 150, 0.9),
                        new ClientNode("mobile", "Mobile", NodeHealth.HEALTHY, 10, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(1, 1, 10),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, fixedLatency(10))),
                List.of(
                        new Edge("e1", "web", "svc", 1, 1, 0),
                        new Edge("e2", "mobile", "db", 1, 1, 0))));

        assertThat(result.nodes().get("svc").status()).isEqualTo(Status.OVERLOADED);
        assertLatencies(result.nodes().get("web").endToEndMs(), null, null);
        assertLatencies(result.nodes().get("mobile").endToEndMs(), 10.0, 10.0);
        assertLatencies(result.summary().avgEndToEndMs(), null, null);
    }

    @Test
    void overloadOnlyAffectsRequestClassesThatReachIt() {
        // hitRatio = 1：read 全部命中，不會到 DB；DB 容量 50、write λ = 100 → 過載
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 200, 0.5),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, fixedLatency(1), 1),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 1, 20))),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 0),
                        new Edge("e2", "cache", "db", 1, 1, 1))));

        assertThat(result.nodes().get("db").status()).isEqualTo(Status.OVERLOADED);
        assertLatencies(result.nodes().get("client").endToEndMs(), 1.0, null);
        assertLatencies(result.summary().avgEndToEndMs(), 1.0, null);
    }

    @Test
    void onlyClientsHaveEndToEndLatency() {
        SimulationResult result = runTwoDownstreams(CallMode.SEQUENTIAL, 1);

        assertThat(result.nodes().get("svc").endToEndMs()).isNull();
        assertThat(result.nodes().get("a").endToEndMs()).isNull();
    }
}
