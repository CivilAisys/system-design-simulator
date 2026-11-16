package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** 使用者端頻寬（spec 4.7）：只算 Client 進出的流量，CDN 命中的 read 不必從 origin 送出。 */
class BandwidthTest {

    private static final double EPS = 1e-6;
    private static final CapacityParams AMPLE = new CapacityParams(10, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    private static ClientNode client(String id, double rps, double readResponseBytes, double writeRequestBytes) {
        return new ClientNode(id, id, NodeHealth.HEALTHY, rps, 0.9, readResponseBytes, writeRequestBytes);
    }

    private static ServiceNode service(String id) {
        return new ServiceNode(id, id, NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL);
    }

    private static CdnNode cdn(String id, double hitRatio) {
        return new CdnNode(id, id, NodeHealth.HEALTHY, AMPLE, hitRatio);
    }

    @Test
    void egressIsReadsTimesResponseSizeAndIngressIsWritesTimesUploadSize() {
        // 1000 rps、read 90%：分成 3:1 兩條邊
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 2_000), service("a"), service("b")),
                List.of(new Edge("e1", "c", "a", 3, 1, 0), new Edge("e2", "c", "b", 1, 1, 0))));

        assertThat(result.summary().bandwidth().egressBytesPerSec()).isCloseTo(900 * 10_000, within(EPS));
        assertThat(result.summary().bandwidth().ingressBytesPerSec()).isCloseTo(100 * 2_000, within(EPS));
        Bandwidth e1 = result.edges().get("e1").bandwidth();
        assertThat(e1.egressBytesPerSec()).isCloseTo(675 * 10_000, within(EPS));
        assertThat(e1.ingressBytesPerSec()).isCloseTo(75 * 2_000, within(EPS));
        assertThat(result.edges().get("e2").bandwidth().egressBytesPerSec()).isCloseTo(225 * 10_000, within(EPS));
        assertThat(result.summary().cdnOffloadBytesPerSec()).isZero();
    }

    @Test
    void onlyClientEdgesHaveBandwidth() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 2_000), service("a"),
                        new DatabaseNode("db", "db", NodeHealth.HEALTHY, AMPLE)),
                List.of(new Edge("e1", "c", "a", 1, 1, 0), new Edge("e2", "a", "db", 1, 1, 0))));

        assertThat(result.edges().get("e2").bandwidth()).isNull();
    }

    @Test
    void sizesDefaultWhenOmitted() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(new ClientNode("c", "c", NodeHealth.HEALTHY, 1000, 0.9), service("a")),
                List.of(new Edge("e1", "c", "a", 1, 1, 0))));

        assertThat(result.summary().bandwidth()).isEqualTo(new Bandwidth(
                900 * ClientNode.DEFAULT_READ_RESPONSE_BYTES, 100 * ClientNode.DEFAULT_WRITE_REQUEST_BYTES));
    }

    @Test
    void cdnHitsAreOffloadedFromOrigin() {
        // 命中率 0.95：origin 只送出 5% 的 read 回應
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 2_000), cdn("cdn", 0.95), service("origin")),
                List.of(new Edge("e1", "c", "cdn", 1, 1, 0), new Edge("e2", "cdn", "origin", 1, 1, 0))));

        Summary summary = result.summary();
        assertThat(summary.bandwidth().egressBytesPerSec()).isCloseTo(900 * 10_000, within(EPS));
        assertThat(summary.cdnOffloadBytesPerSec()).isCloseTo(900 * 0.95 * 10_000, within(EPS));
    }

    @Test
    void offloadDropsAsHitRatioDrops() {
        double high = offload(0.9);
        double low = offload(0.5);

        assertThat(low).isLessThan(high);
        assertThat(low).isCloseTo(900 * 0.5 * 10_000, within(EPS));
    }

    private double offload(double hitRatio) {
        return simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 2_000), cdn("cdn", hitRatio), service("origin")),
                List.of(new Edge("e1", "c", "cdn", 1, 1, 0), new Edge("e2", "cdn", "origin", 1, 1, 0))))
                .summary().cdnOffloadBytesPerSec();
    }

    @Test
    void cdnOffloadUsesTheResponseSizeOfTheReadsItReceives() {
        // 只有 web 經過 CDN；app 直接打 origin，它的大回應不會被 CDN 擋掉
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("web", 1000, 10_000, 0), client("app", 1000, 50_000, 0), cdn("cdn", 0.8),
                        service("origin")),
                List.of(new Edge("e1", "web", "cdn", 1, 1, 0), new Edge("e2", "cdn", "origin", 1, 1, 0),
                        new Edge("e3", "app", "origin", 1, 1, 0))));

        Summary summary = result.summary();
        assertThat(summary.bandwidth().egressBytesPerSec()).isCloseTo(900 * 10_000 + 900 * 50_000, within(EPS));
        assertThat(summary.cdnOffloadBytesPerSec()).isCloseTo(900 * 0.8 * 10_000, within(EPS));
    }

    @Test
    void mixedClientsBehindOneCdnUseTheAverageResponseSize() {
        // 兩個 Client 的 read 各 900 rps，經過 Rate Limiter（不限流）後進同一個 CDN
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("web", 1000, 10_000, 0), client("app", 1000, 30_000, 0),
                        new RateLimiterNode("rl", "rl", NodeHealth.HEALTHY, 1e6), cdn("cdn", 0.5),
                        service("origin")),
                List.of(new Edge("e1", "web", "rl", 1, 1, 0), new Edge("e2", "app", "rl", 1, 1, 0),
                        new Edge("e3", "rl", "cdn", 1, 1, 0), new Edge("e4", "cdn", "origin", 1, 1, 0))));

        assertThat(result.summary().cdnOffloadBytesPerSec())
                .isCloseTo(0.5 * (900 * 10_000 + 900 * 30_000), within(EPS));
    }
}
