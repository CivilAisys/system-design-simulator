package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Service 邊的 requestClass（spec 3.4）：一個 class 的請求只呼叫 requestClass 符合的下游。 */
class RequestClassTest {

    private static final double EPS = 1e-6;

    private final Simulator simulator = new SteadyStateSimulator();

    /** μ = 100，容量 = workers × 100 rps。 */
    private static CapacityParams workers(int workers) {
        return new CapacityParams(1, workers, 10);
    }

    /**
     * Client（read 90%）→ Service ─READ→ replica、─WRITE→ primary、─ALL→ audit，邊的單程延遲各自不同。
     * {@code primaryWorkers} 決定 primary 會不會過載。
     */
    private SimulationResult run(CallMode mode, int primaryWorkers) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 1), mode),
                        new DatabaseNode("replica", "Replica", NodeHealth.HEALTHY, workers(100)),
                        new DatabaseNode("primary", "Primary", NodeHealth.HEALTHY, workers(primaryWorkers)),
                        new DatabaseNode("audit", "Audit", NodeHealth.HEALTHY, workers(100))),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 0),
                        new Edge("read", "svc", "replica", 1, 1, 5, RequestClass.READ),
                        new Edge("write", "svc", "primary", 1, 2, 20, RequestClass.WRITE),
                        new Edge("all", "svc", "audit", 1, 1, 1, RequestClass.ALL))));
    }

    private static void assertRates(ClassRates actual, double read, double write) {
        assertThat(actual.read()).isCloseTo(read, within(EPS));
        assertThat(actual.write()).isCloseTo(write, within(EPS));
    }

    @Test
    void eachClassOnlyCallsMatchingDownstreams() {
        SimulationResult result = run(CallMode.SEQUENTIAL, 100);

        assertRates(result.edges().get("read").rps(), 900, 0);
        // callsPerRequest 2 只乘在符合的 class 上
        assertRates(result.edges().get("write").rps(), 0, 200);
        assertRates(result.edges().get("all").rps(), 900, 100);
        assertRates(result.nodes().get("replica").arrivalRps(), 900, 0);
        assertRates(result.nodes().get("primary").arrivalRps(), 0, 200);
    }

    @Test
    void sequentialLatencyOnlyAddsMatchingDownstreams() {
        SimulationResult result = run(CallMode.SEQUENTIAL, 100);
        double svc = result.nodes().get("svc").avgLatencyMs();
        double replica = result.nodes().get("replica").avgLatencyMs();
        double primary = result.nodes().get("primary").avgLatencyMs();
        double audit = result.nodes().get("audit").avgLatencyMs();

        ClassLatencies latencies = result.summary().avgEndToEndMs();
        assertThat(latencies.read().ms()).isCloseTo(svc + (10 + replica) + (2 + audit), within(EPS));
        assertThat(latencies.write().ms()).isCloseTo(svc + 2 * (40 + primary) + (2 + audit), within(EPS));
    }

    @Test
    void parallelIsApproximateOnlyWhenTheClassCallsSeveralDownstreams() {
        Topology onlyRead = new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 1),
                                CallMode.PARALLEL),
                        new DatabaseNode("replica", "Replica", NodeHealth.HEALTHY, workers(100)),
                        new DatabaseNode("primary", "Primary", NodeHealth.HEALTHY, workers(100))),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 0),
                        new Edge("read", "svc", "replica", 1, 1, 5, RequestClass.READ),
                        new Edge("write", "svc", "primary", 1, 1, 5, RequestClass.WRITE)));

        // 每個 class 只呼叫一個下游，取最大值就是它本身，不是近似
        ClassLatencies split = simulator.simulate(onlyRead).summary().avgEndToEndMs();
        assertThat(split.read().approximate()).isFalse();
        assertThat(split.write().approximate()).isFalse();

        // read 呼叫 replica 和 audit 兩個，write 呼叫 primary 和 audit 兩個
        ClassLatencies withAudit = run(CallMode.PARALLEL, 100).summary().avgEndToEndMs();
        assertThat(withAudit.read().approximate()).isTrue();
        assertThat(withAudit.write().approximate()).isTrue();
    }

    @Test
    void classWithoutMatchingDownstreamEndsAtTheService() {
        Topology readOnlyEdge = new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 1),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("replica", "Replica", NodeHealth.HEALTHY, workers(1))),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 0),
                        new Edge("read", "svc", "replica", 1, 1, 5, RequestClass.READ)));

        SimulationResult result = simulator.simulate(readOnlyEdge);

        // replica 被 read 壓到過載，write 不經過它：延遲是 Service 自己的 W，而且全部成功
        assertThat(result.summary().avgEndToEndMs().read().ms()).isNull();
        assertThat(result.summary().avgEndToEndMs().write().ms())
                .isCloseTo(result.nodes().get("svc").avgLatencyMs(), within(EPS));
        double readPass = 100.0 / 900;
        assertThat(result.summary().successRps()).isCloseTo(900 * readPass + 100, within(EPS));
    }

    @Test
    void successOnlyMultipliesMatchingDownstreams() {
        // primary 容量 100、收到 write 200 → pass = 0.5；read 不經過 primary，不受影響
        SimulationResult result = run(CallMode.SEQUENTIAL, 1);

        assertThat(result.nodes().get("primary").status()).isEqualTo(Status.OVERLOADED);
        assertThat(result.nodes().get("client").successRps()).isCloseTo(900 + 100 * 0.5 * 0.5, within(EPS));
        assertThat(result.summary().avgEndToEndMs().read().ms()).isNotNull();
        assertThat(result.summary().avgEndToEndMs().write().ms()).isNull();
    }
}
