package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

class SteadyStateSimulatorTest {

    private static final double EPS = 1e-6;
    private static final CapacityParams HUGE = new CapacityParams(1, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client → Service → Database，Service 是要驗算的節點，Database 容量足夠不影響結果。 */
    private SimulationResult runClientServiceDb(double rps, CapacityParams service) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, service, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, HUGE)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "db", 1, 1, 1))));
    }

    private static void assertRates(ClassRates actual, double read, double write) {
        assertThat(actual.read()).isCloseTo(read, within(EPS));
        assertThat(actual.write()).isCloseTo(write, within(EPS));
    }

    @Test
    void mm1() {
        NodeResult svc = runClientServiceDb(80, new CapacityParams(1, 1, 10)).nodes().get("svc");

        assertThat(svc.utilization()).isCloseTo(0.8, within(EPS));
        assertThat(svc.avgQueueMs()).isCloseTo(40, within(EPS));
        assertThat(svc.avgLatencyMs()).isCloseTo(50, within(EPS));
        assertThat(svc.status()).isEqualTo(Status.WARN);
    }

    @Test
    void mm2() {
        NodeResult svc = runClientServiceDb(150, new CapacityParams(1, 2, 10)).nodes().get("svc");

        assertThat(svc.utilization()).isCloseTo(0.75, within(EPS));
        assertThat(svc.avgQueueMs()).isCloseTo(12.857, within(1e-3));
        assertThat(svc.avgLatencyMs()).isCloseTo(22.857, within(1e-3));
    }

    @Test
    void overloadedNodeDropsExcessAndHasNoLatency() {
        SimulationResult result = runClientServiceDb(150, new CapacityParams(1, 1, 10));
        NodeResult svc = result.nodes().get("svc");

        assertThat(svc.throughputRps()).isCloseTo(100, within(EPS));
        assertThat(svc.droppedRps()).isCloseTo(50, within(EPS));
        assertThat(svc.avgQueueMs()).isNull();
        assertThat(svc.avgLatencyMs()).isNull();
        assertThat(svc.status()).isEqualTo(Status.OVERLOADED);
        // 只有實際處理量往下送，read / write 依比例丟
        assertThat(result.edges().get("e2").rps().read()).isCloseTo(90, within(EPS));
        assertThat(result.edges().get("e2").rps().write()).isCloseTo(10, within(EPS));
        assertThat(result.nodes().get("db").arrivalRps().total()).isCloseTo(100, within(EPS));
    }

    @Test
    void largeWorkerCountDoesNotOverflow() {
        // c = 2 × 200 = 400，μ = 20，容量 8000；λ = 7200 → ρ = 0.9
        NodeResult svc = runClientServiceDb(7200, new CapacityParams(2, 200, 50)).nodes().get("svc");

        assertThat(svc.utilization()).isCloseTo(0.9, within(EPS));
        assertThat(svc.avgQueueMs()).isFinite().isBetween(0.0, 1.0);
        assertThat(svc.avgLatencyMs()).isFinite().isBetween(50.0, 51.0);
        assertThat(svc.status()).isEqualTo(Status.CRITICAL);
    }

    @Test
    void trafficFlowsDownstreamSplitByRequestClass() {
        SimulationResult result = runClientServiceDb(1000, new CapacityParams(2, 200, 50));

        assertThat(result.valid()).isTrue();
        assertThat(result.errors()).isEmpty();
        assertRates(result.edges().get("e1").rps(), 900, 100);
        assertRates(result.nodes().get("svc").arrivalRps(), 900, 100);
        assertThat(result.nodes().get("svc").capacityRps()).isCloseTo(8000, within(EPS));
        assertThat(result.nodes().get("svc").utilization()).isCloseTo(0.125, within(EPS));
        assertRates(result.nodes().get("db").arrivalRps(), 900, 100);
        assertThat(result.summary().offeredRps()).isEqualTo(1000);
    }

    @Test
    void clientHasTrafficButNoServerFields() {
        NodeResult client = runClientServiceDb(1000, new CapacityParams(2, 200, 50)).nodes().get("client");

        assertRates(client.arrivalRps(), 900, 100);
        assertThat(client.throughputRps()).isEqualTo(1000);
        assertThat(client.droppedRps()).isZero();
        assertThat(client.capacityRps()).isNull();
        assertThat(client.utilization()).isNull();
        assertThat(client.avgQueueMs()).isNull();
        assertThat(client.avgLatencyMs()).isNull();
        assertThat(client.status()).isNull();
    }

    @Test
    void bottleneckIsHighestUtilizationAndNeverClient() {
        // Service ρ = 0.125；DB 容量 10,000 → ρ = 0.1
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(2, 200, 50),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 100, 10))),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "db", 1, 1, 1))));

        assertThat(result.nodes().get("db").utilization()).isCloseTo(0.1, within(EPS));
        assertThat(result.summary().bottleneckNodeId()).isEqualTo("svc");
    }

    @Test
    void idleNodeHasZeroUtilizationAndServiceTimeLatency() {
        NodeResult svc = runClientServiceDb(0, new CapacityParams(2, 200, 50)).nodes().get("svc");

        assertThat(svc.utilization()).isZero();
        assertThat(svc.avgQueueMs()).isZero();
        assertThat(svc.avgLatencyMs()).isCloseTo(50, within(EPS));
        assertThat(svc.status()).isEqualTo(Status.OK);
    }

    @Test
    void resultsKeepInputOrder() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, HUGE),
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 10, 1),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e2", "svc", "db", 1, 1, 1),
                        new Edge("e1", "client", "svc", 1, 1, 1))));

        assertThat(result.nodes().keySet()).containsExactly("db", "client", "svc");
        assertThat(result.edges().keySet()).containsExactly("e2", "e1");
        assertThat(result.nodes().get("db").arrivalRps().total()).isCloseTo(10, within(EPS));
    }
}
