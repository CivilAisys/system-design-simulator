package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** External API（spec 3.3、4.2.1）：固定延遲 latencyMs，超過 quotaRps 的部分是拒絕量。 */
class ExternalApiTest {

    private static final double EPS = 1e-6;

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client（read 90%）→ Service → External API，Service 容量足夠不影響結果，邊的延遲為 0。 */
    private SimulationResult run(double rps, double latencyMs, double quotaRps) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 1),
                                CallMode.SEQUENTIAL),
                        new ExternalApiNode("pay", "Payments", NodeHealth.HEALTHY, latencyMs, quotaRps)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 0),
                        new Edge("e2", "svc", "pay", 1, 1, 0))));
    }

    @Test
    void addsFixedLatencyWithoutQueueing() {
        SimulationResult result = run(500, 100, 1000);
        NodeResult api = result.nodes().get("pay");
        NodeResult svc = result.nodes().get("svc");

        assertThat(api.avgLatencyMs()).isEqualTo(100);
        assertThat(api.avgQueueMs()).isZero();
        assertThat(api.capacityRps()).isNull();
        assertThat(api.utilization()).isNull();
        assertThat(api.rejectedRps()).isZero();
        assertThat(api.status()).isEqualTo(Status.WITHIN_QUOTA);
        // 端到端 = Service 的 W + External API 的 100ms
        assertThat(result.summary().avgEndToEndMs().read().ms()).isCloseTo(svc.avgLatencyMs() + 100, within(EPS));
        assertThat(result.summary().dropRate()).isZero();
    }

    @Test
    void requestsOverQuotaAreRejectedAndLowerSuccess() {
        // λ = 2000、配額 500：放行 1/4，其餘拒絕（HTTP 429）
        SimulationResult result = run(2000, 100, 500);
        NodeResult api = result.nodes().get("pay");

        assertThat(api.throughputRps()).isCloseTo(500, within(EPS));
        assertThat(api.rejectedRps()).isCloseTo(1500, within(EPS));
        assertThat(api.droppedRps()).isZero();
        assertThat(api.status()).isEqualTo(Status.OVER_QUOTA);
        assertThat(result.nodes().get("client").successRps()).isCloseTo(500, within(EPS));
        assertThat(result.summary().rejectedRps()).isCloseTo(1500, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(0.75, within(EPS));
        // 拒絕不會讓延遲變成無定義：沒有排隊，放行的請求仍是固定延遲
        assertThat(result.summary().avgEndToEndMs().read().ms()).isNotNull();
    }

    @Test
    void externalApiIsNeverTheBottleneck() {
        SimulationResult result = run(2000, 100, 500);

        assertThat(result.summary().bottleneckNodeId()).isEqualTo("svc");
    }
}
