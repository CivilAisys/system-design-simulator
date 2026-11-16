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
        // web 的 read 900 rps、app 的 read 300 rps，經過 Rate Limiter（不限流）後進同一個 CDN；
        // 加權平均 = (900 × 10 KB + 300 × 30 KB) / 1200 = 15 KB（直接平均是 20 KB）
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("web", 1000, 10_000, 0), client("app", 1000 / 3.0, 30_000, 0),
                        new RateLimiterNode("rl", "rl", NodeHealth.HEALTHY, 1e6), cdn("cdn", 0.5),
                        service("origin")),
                List.of(new Edge("e1", "web", "rl", 1, 1, 0), new Edge("e2", "app", "rl", 1, 1, 0),
                        new Edge("e3", "rl", "cdn", 1, 1, 0), new Edge("e4", "cdn", "origin", 1, 1, 0))));

        assertThat(result.summary().cdnOffloadBytesPerSec())
                .isCloseTo(0.5 * 1200 * 15_000, within(EPS));
    }

    @Test
    void cacheHitsAreNotOffloaded() {
        // Cache 命中的回應仍由 origin 的 Service 送出
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 0),
                        new CacheNode("cache", "cache", NodeHealth.HEALTHY, AMPLE, 0.95), service("origin")),
                List.of(new Edge("e1", "c", "cache", 1, 1, 0), new Edge("e2", "cache", "origin", 1, 1, 0))));

        assertThat(result.summary().cdnOffloadBytesPerSec()).isZero();
    }

    @Test
    void overloadedCdnOnlyOffloadsWhatItServes() {
        // CDN 容量 1 × 450 / 1000ms = 450 rps：read 900、write 100 依比例丟棄，處理的 read = 900 × 450 / 1000
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 0),
                        new CdnNode("cdn", "cdn", NodeHealth.HEALTHY, new CapacityParams(1, 450, 1000), 1),
                        service("origin")),
                List.of(new Edge("e1", "c", "cdn", 1, 1, 0), new Edge("e2", "cdn", "origin", 1, 1, 0))));

        assertThat(result.summary().cdnOffloadBytesPerSec()).isCloseTo(405 * 10_000, within(EPS));
        // 出口是需求量，不扣除丟棄
        assertThat(result.summary().bandwidth().egressBytesPerSec()).isCloseTo(900 * 10_000, within(EPS));
    }

    @Test
    void offloadNeverExceedsEgress() {
        // CDN 在 fan-out 的 Service 後面：每個請求呼叫 3 次，子呼叫沿用 Client 的回應大小，擋掉的量封頂在出口
        SimulationResult result = simulator.simulate(new Topology(
                List.of(client("c", 1000, 10_000, 0), service("api"), cdn("cdn", 1), service("origin")),
                List.of(new Edge("e1", "c", "api", 1, 1, 0), new Edge("e2", "api", "cdn", 1, 3, 0),
                        new Edge("e3", "cdn", "origin", 1, 1, 0))));

        assertThat(result.summary().cdnOffloadBytesPerSec())
                .isEqualTo(result.summary().bandwidth().egressBytesPerSec());
    }
}
