package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Cache 的熱點（spec 4.2.2）：最熱的那台單獨計算，其他台共用一條佇列，ρ 較高的一邊決定節點的 ρ。 */
class HotSpotTest {

    private static final double EPS = 1e-6;
    // μ = 100、c = 10：每台容量 1000 rps，4 台共 4000
    private static final CapacityParams FOUR = new CapacityParams(4, 10, 10);
    private static final CapacityParams AMPLE = new CapacityParams(1, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client（read 90%）→ Cache（命中 80%）→ Database。 */
    private SimulationResult run(double rps, CapacityParams cache, Double hotShare) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, cache, 0.8, hotShare),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, AMPLE)),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 1),
                        new Edge("e2", "cache", "db", 1, 1, 1))));
    }

    @Test
    void withoutHotShareAllInstancesShareOneQueue() {
        NodeResult cache = run(3000, FOUR, null).nodes().get("cache");

        assertThat(cache.capacityRps()).isCloseTo(4000, within(EPS));
        assertThat(cache.utilization()).isCloseTo(0.75, within(EPS));
        assertThat(cache.hotSpot()).isNull();
    }

    @Test
    void hottestInstanceOverloadsFirstAndDecidesNodeUtilization() {
        // 3000 rps，最熱那台分到 40% = 1200 > 1000；其他 3 台共 1800，ρ 0.6。總量還沒到容量 4000
        SimulationResult result = run(3000, FOUR, 0.4);
        NodeResult cache = result.nodes().get("cache");

        assertThat(cache.capacityRps()).isCloseTo(4000, within(EPS));
        assertThat(cache.utilization()).isCloseTo(1.2, within(EPS));
        assertThat(cache.status()).isEqualTo(Status.OVERLOADED);
        assertThat(cache.droppedRps()).isCloseTo(200, within(EPS));
        assertThat(cache.throughputRps()).isCloseTo(2800, within(EPS));
        assertThat(cache.avgLatencyMs()).isNull();
        assertThat(result.summary().bottleneckNodeId()).isEqualTo("cache");

        InstanceResult hot = cache.hotSpot().hottest();
        assertThat(hot.arrivalRps().total()).isCloseTo(1200, within(EPS));
        assertThat(hot.status()).isEqualTo(Status.OVERLOADED);
        assertThat(hot.avgLatencyMs()).isNull();
        InstanceResult others = cache.hotSpot().others();
        assertThat(others.arrivalRps().total()).isCloseTo(1800, within(EPS));
        assertThat(others.utilization()).isCloseTo(0.6, within(EPS));
        assertThat(others.status()).isEqualTo(Status.OK);
        // 只有最熱那台丟掉的請求失敗
        assertThat(result.summary().dropRate()).isCloseTo(200.0 / 3000, within(EPS));
    }

    @Test
    void latencyIsWeightedByTraffic() {
        // 最熱那台 0.4 × 2000 = 800（ρ 0.8），其他 3 台共 1200（ρ 0.4）
        NodeResult cache = run(2000, FOUR, 0.4).nodes().get("cache");
        InstanceResult hot = cache.hotSpot().hottest();
        InstanceResult others = cache.hotSpot().others();

        assertThat(cache.utilization()).isCloseTo(0.8, within(EPS));
        assertThat(cache.avgLatencyMs()).isCloseTo(0.4 * hot.avgLatencyMs() + 0.6 * others.avgLatencyMs(),
                within(EPS));
        assertThat(hot.avgLatencyMs()).isGreaterThan(others.avgLatencyMs());
    }

    @Test
    void allTrafficOnOneInstanceLeavesTheOthersIdle() {
        NodeResult cache = run(800, FOUR, 1.0).nodes().get("cache");
        InstanceResult others = cache.hotSpot().others();

        assertThat(others.arrivalRps().total()).isZero();
        assertThat(others.utilization()).isZero();
        assertThat(cache.utilization()).isCloseTo(0.8, within(EPS));
        assertThat(cache.avgLatencyMs()).isCloseTo(cache.hotSpot().hottest().avgLatencyMs(), within(EPS));
    }

    @Test
    void singleInstanceHasNoOthers() {
        var one = new CapacityParams(1, 10, 10);
        NodeResult plain = run(800, one, null).nodes().get("cache");
        NodeResult hot = run(800, one, 1.0).nodes().get("cache");

        assertThat(hot.hotSpot().others()).isNull();
        assertThat(hot.utilization()).isEqualTo(plain.utilization());
        assertThat(hot.avgLatencyMs()).isEqualTo(plain.avgLatencyMs());
    }

    @Test
    void missesOfBothSidesGoDownstream() {
        // 最熱那台 1200 只處理 1000；其他 1800 全部處理：處理完的 2800 裡 read 2520、write 280
        SimulationResult result = run(3000, FOUR, 0.4);

        ClassRates down = result.edges().get("e2").rps();
        assertThat(down.read()).isCloseTo(2520 * 0.2, within(EPS));
        assertThat(down.write()).isCloseTo(280, within(EPS));
    }

    @Test
    void cdnHasNoHotSpot() {
        assertThat(new CdnNode("cdn", "CDN", NodeHealth.HEALTHY, FOUR, 0.9).hotShare()).isNull();
    }
}
