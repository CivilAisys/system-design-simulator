package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Rate Limiter（spec 3.3、4.2.1）：放行 min(λ, limitRps)，超過的部分是拒絕量。 */
class RateLimiterTest {

    private static final double EPS = 1e-6;

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client（read 90%）→ Rate Limiter → Service → Database，Service 容量 = serviceWorkers × 100 rps。 */
    private SimulationResult run(double rps, double limitRps, int serviceWorkers) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new RateLimiterNode("limiter", "Limiter", NodeHealth.HEALTHY, limitRps),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(1, serviceWorkers, 10),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 1))),
                List.of(
                        new Edge("e1", "client", "limiter", 1, 1, 1),
                        new Edge("e2", "limiter", "svc", 1, 1, 1),
                        new Edge("e3", "svc", "db", 1, 1, 1))));
    }

    private static void assertRates(ClassRates actual, double read, double write) {
        assertThat(actual.read()).isCloseTo(read, within(EPS));
        assertThat(actual.write()).isCloseTo(write, within(EPS));
    }

    @Test
    void belowLimitPassesEverythingAndIsNotLimiting() {
        SimulationResult result = run(500, 1000, 20);
        NodeResult limiter = result.nodes().get("limiter");

        assertRates(limiter.arrivalRps(), 450, 50);
        assertThat(limiter.throughputRps()).isCloseTo(500, within(EPS));
        assertThat(limiter.rejectedRps()).isZero();
        assertThat(limiter.droppedRps()).isZero();
        assertThat(limiter.status()).isEqualTo(Status.NOT_LIMITING);
        // 沒有 M/M/c：沒有容量和 ρ，延遲記為 0
        assertThat(limiter.capacityRps()).isNull();
        assertThat(limiter.utilization()).isNull();
        assertThat(limiter.avgQueueMs()).isZero();
        assertThat(limiter.avgLatencyMs()).isZero();
        assertThat(result.summary().rejectedRps()).isZero();
        assertThat(result.summary().dropRate()).isZero();
    }

    @Test
    void exactlyAtLimitRejectsNothing() {
        NodeResult limiter = run(1000, 1000, 20).nodes().get("limiter");

        assertThat(limiter.throughputRps()).isCloseTo(1000, within(EPS));
        assertThat(limiter.rejectedRps()).isZero();
        assertThat(limiter.status()).isEqualTo(Status.NOT_LIMITING);
    }

    @Test
    void aboveLimitRejectsExcessProportionally() {
        // λ = 2000、limit = 1000：read／write 各放行一半
        SimulationResult result = run(2000, 1000, 20);
        NodeResult limiter = result.nodes().get("limiter");

        assertThat(limiter.throughputRps()).isCloseTo(1000, within(EPS));
        assertThat(limiter.rejectedRps()).isCloseTo(1000, within(EPS));
        assertThat(limiter.droppedRps()).isZero();
        assertThat(limiter.status()).isEqualTo(Status.LIMITING);
        assertRates(result.edges().get("e2").rps(), 900, 100);
        // 拒絕量算進失敗率：pass = 0.5
        assertThat(result.nodes().get("client").successRps()).isCloseTo(1000, within(EPS));
        assertThat(result.summary().rejectedRps()).isCloseTo(1000, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(0.5, within(EPS));
    }

    @Test
    void limiterKeepsOtherwiseOverloadedDownstreamStable() {
        // Service 容量 2000：沒有限流時 λ = 3000 會過載；限流到 1500 → ρ = 0.75
        SimulationResult unlimited = run(3000, 1e12, 20);
        SimulationResult limited = run(3000, 1500, 20);

        assertThat(unlimited.nodes().get("svc").status()).isEqualTo(Status.OVERLOADED);
        assertThat(unlimited.summary().avgEndToEndMs().read().ms()).isNull();

        NodeResult svc = limited.nodes().get("svc");
        assertThat(svc.utilization()).isCloseTo(0.75, within(EPS));
        assertThat(svc.droppedRps()).isZero();
        // 端到端延遲只算被放行的請求：limiter 的 W = 0，加上各邊的往返延遲和下游的 W
        double expected = 1 + 0 + 1 + svc.avgLatencyMs() + 1 + limited.nodes().get("db").avgLatencyMs();
        assertThat(limited.summary().avgEndToEndMs().read().ms()).isCloseTo(expected, within(EPS));
        assertThat(limited.summary().dropRate()).isCloseTo(0.5, within(EPS));
    }

    @Test
    void limiterIsNeverTheBottleneck() {
        // limiter 正在限流，Service ρ = 0.5 仍然是瓶頸
        SimulationResult result = run(2000, 1000, 20);

        assertThat(result.nodes().get("limiter").status()).isEqualTo(Status.LIMITING);
        assertThat(result.summary().bottleneckNodeId()).isEqualTo("svc");
    }
}
