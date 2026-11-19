package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 負載掃描（spec 4.10）：所有 Client 的 rps 一起放大，找出第一個到 ρ 0.7 和第一個過載的位置。 */
class LoadSweepTest {

    // 門檻用二分搜尋，相對誤差要小於 0.1%
    private static final double RELATIVE = 1e-3;
    private static final CapacityParams AMPLE = new CapacityParams(1, 10_000, 1);

    private final LoadSweep sweep = new LoadSweep(new SteadyStateSimulator());

    /** μ = 100，容量 = workers × 100 rps。 */
    private static CapacityParams workers(int workers) {
        return new CapacityParams(1, workers, 10);
    }

    /** Client 1000 rps → Service → Database。 */
    private static Topology clientServiceDb(CapacityParams service, CapacityParams db) {
        return new Topology(
                List.of(
                        new ClientNode("c", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, service, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, db)),
                List.of(new Edge("e1", "c", "svc", 1, 1, 1), new Edge("e2", "svc", "db", 1, 1, 1)));
    }

    @Test
    void thresholdsMatchTheHandCalculation() {
        // Service 容量 2000：ρ = 1000k ÷ 2000，k = 1.4 時到 0.7，k = 2 時過載
        SweepResult result = sweep.sweep(clientServiceDb(workers(20), AMPLE), 5);

        assertThat(result.valid()).isTrue();
        assertThat(result.currentRps()).isEqualTo(1000);
        assertThat(result.warn().nodeId()).isEqualTo("svc");
        assertThat(result.warn().multiplier()).isCloseTo(1.4, within(1.4 * RELATIVE));
        assertThat(result.warn().totalRps()).isCloseTo(1400, within(1400 * RELATIVE));
        assertThat(result.overload().nodeId()).isEqualTo("svc");
        assertThat(result.overload().multiplier()).isCloseTo(2, within(2 * RELATIVE));
    }

    @Test
    void pointsAreEvenlySpacedPlusTheThresholds() {
        SweepResult result = sweep.sweep(clientServiceDb(workers(20), AMPLE), 5);

        assertThat(result.points()).hasSize(LoadSweep.POINTS + 2);
        assertThat(result.points().getFirst().multiplier()).isZero();
        assertThat(result.points().getLast().multiplier()).isEqualTo(5);
        assertThat(result.points()).extracting(SweepPoint::multiplier).isSorted()
                .contains(result.warn().multiplier(), result.overload().multiplier());
        assertThat(result.points()).allSatisfy(point ->
                assertThat(point.totalRps()).isCloseTo(1000 * point.multiplier(), within(1e-9)));
    }

    @Test
    void firstNodeToStruggleMayNotBeTheCurrentBottleneck() {
        // 目前 Service（容量 2000）ρ 0.5、DB（容量 1500）ρ 0.67：DB 先到 0.7 也先過載
        SweepResult result = sweep.sweep(clientServiceDb(workers(20), workers(15)), 5);

        assertThat(result.warn().nodeId()).isEqualTo("db");
        assertThat(result.warn().multiplier()).isCloseTo(1.05, within(1.05 * RELATIVE));
        assertThat(result.overload().nodeId()).isEqualTo("db");
        assertThat(result.overload().multiplier()).isCloseTo(1.5, within(1.5 * RELATIVE));
    }

    @Test
    void rateLimiterInFrontKeepsTheBottleneckFromOverloading() {
        // Limiter 最多放行 1500：Service（容量 2000）的 ρ 最高到 0.75，到 0.7 但不會過載
        Topology topology = new Topology(
                List.of(
                        new ClientNode("c", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new RateLimiterNode("rl", "Limiter", NodeHealth.HEALTHY, 1500),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, workers(20), CallMode.SEQUENTIAL)),
                List.of(new Edge("e1", "c", "rl", 1, 1, 1), new Edge("e2", "rl", "svc", 1, 1, 1)));
        SweepResult result = sweep.sweep(topology, 10);

        assertThat(result.warn().nodeId()).isEqualTo("svc");
        assertThat(result.warn().multiplier()).isCloseTo(1.4, within(1.4 * RELATIVE));
        assertThat(result.overload()).isNull();
        // 被拒絕的請求算失敗：k = 10 時只有 1500 ÷ 10000 成功
        assertThat(result.points().getLast().successRate()).isCloseTo(0.15, within(1e-9));
    }

    @ParameterizedTest
    @ValueSource(doubles = {2, 5, 10})
    void highestUtilizationNeverDecreases(double maxMultiplier) {
        SweepResult result = sweep.sweep(clientServiceDb(workers(20), workers(15)), maxMultiplier);

        List<Double> utilizations = result.points().stream()
                .map(point -> point.busiest() == null ? 0 : point.busiest().utilization()).toList();
        assertThat(utilizations).isSorted();
    }

    @Test
    void latencyIsUndefinedAfterOverloadWhileSuccessKeepsFalling() {
        SweepResult result = sweep.sweep(clientServiceDb(workers(20), AMPLE), 5);
        double overload = result.overload().multiplier();

        for (SweepPoint point : result.points()) {
            if (point.multiplier() > 0 && point.multiplier() < overload) {
                assertThat(point.readMs()).as("k = %s", point.multiplier()).isNotNull();
                assertThat(point.successRate()).isEqualTo(1);
            } else if (point.multiplier() >= overload) {
                assertThat(point.readMs()).as("k = %s", point.multiplier()).isNull();
                assertThat(point.writeMs()).isNull();
            }
        }
        // k = 5：5000 rps 只處理 2000
        assertThat(result.points().getLast().successRate()).isCloseTo(0.4, within(1e-9));
        assertThat(result.points()).extracting(SweepPoint::successRate).isSortedAccordingTo((a, b) -> Double.compare(b, a));
    }

    @Test
    void latencyIsWeightedByEachClientsRequests() {
        // A 100 read/s 走 10 ms 的 Service，B 300 read/s 走 50 ms 的 Service：(100 × 10 + 300 × 50) ÷ 400 = 40
        Topology topology = new Topology(
                List.of(
                        new ClientNode("a", "A", NodeHealth.HEALTHY, 100, 1),
                        new ClientNode("b", "B", NodeHealth.HEALTHY, 300, 1),
                        new ServiceNode("fast", "Fast", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 10),
                                CallMode.SEQUENTIAL),
                        new ServiceNode("slow", "Slow", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 50),
                                CallMode.SEQUENTIAL)),
                List.of(new Edge("e1", "a", "fast", 1, 1, 0), new Edge("e2", "b", "slow", 1, 1, 0)));
        SweepPoint last = sweep.sweep(topology, 2).points().getLast();

        assertThat(last.readMs()).isCloseTo(40, within(1e-6));
        // 只有 read，沒有 write 的延遲
        assertThat(last.writeMs()).isNull();
    }

    @Test
    void zeroTrafficHasNoThresholds() {
        Topology topology = new Topology(
                List.of(
                        new ClientNode("c", "Users", NodeHealth.HEALTHY, 0, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, workers(1), CallMode.SEQUENTIAL)),
                List.of(new Edge("e1", "c", "svc", 1, 1, 1)));
        SweepResult result = sweep.sweep(topology, 10);

        assertThat(result.currentRps()).isZero();
        assertThat(result.warn()).isNull();
        assertThat(result.overload()).isNull();
        assertThat(result.points()).hasSize(LoadSweep.POINTS)
                .allSatisfy(point -> assertThat(point.successRate()).isEqualTo(1));
    }

    @Test
    void invalidTopologyIsNotSwept() {
        Topology topology = new Topology(
                List.of(new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL)), List.of());
        SweepResult result = sweep.sweep(topology, 2);

        assertThat(result.valid()).isFalse();
        assertThat(result.errors()).isNotEmpty();
        assertThat(result.points()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(doubles = {0, -1, 10.5, Double.NaN})
    void maxMultiplierMustBeWithinRange(double maxMultiplier) {
        assertThatThrownBy(() -> sweep.sweep(clientServiceDb(AMPLE, AMPLE), maxMultiplier))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
