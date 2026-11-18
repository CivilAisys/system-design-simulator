package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

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
    void loadBalancerSplitsByEdgeWeight() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, HUGE),
                        new ServiceNode("a", "A", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL),
                        new ServiceNode("b", "B", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 1),
                        new Edge("e2", "lb", "a", 1, 1, 1),
                        new Edge("e3", "lb", "b", 3, 1, 1))));

        assertRates(result.nodes().get("lb").arrivalRps(), 900, 100);
        assertRates(result.edges().get("e2").rps(), 225, 25);
        assertRates(result.edges().get("e3").rps(), 675, 75);
        assertRates(result.nodes().get("a").arrivalRps(), 225, 25);
        assertRates(result.nodes().get("b").arrivalRps(), 675, 75);
    }

    @Test
    void trafficFromSeveralClientsAddsUpDownstream() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("web", "Web", NodeHealth.HEALTHY, 1000, 0.9),
                        new ClientNode("mobile", "Mobile", NodeHealth.HEALTHY, 500, 0.5),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e1", "web", "svc", 1, 1, 1),
                        new Edge("e2", "mobile", "svc", 1, 1, 1))));

        assertRates(result.nodes().get("svc").arrivalRps(), 1150, 350);
        assertThat(result.summary().offeredRps()).isEqualTo(1500);
    }

    @Test
    void weightOnServiceEdgesIsIgnored() {
        // Service 對每個下游都呼叫 callsPerRequest 次，weight 不分流
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, HUGE),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, HUGE)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "a", 1, 1, 1),
                        new Edge("e3", "svc", "b", 3, 1, 1))));

        assertRates(result.nodes().get("a").arrivalRps(), 900, 100);
        assertRates(result.nodes().get("b").arrivalRps(), 900, 100);
    }

    @Test
    void cacheSendsOnlyReadMissesAndAllWritesDownstream() {
        // spec 4.6「Cache 分流」：λ_read=900、λ_write=100、hit=0.8；Cache 容量 2000 → ρ = 0.5
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, new CapacityParams(2, 10, 10), 0.8),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, HUGE)),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 1),
                        new Edge("e2", "cache", "db", 1, 1, 1))));

        NodeResult cache = result.nodes().get("cache");
        assertRates(cache.arrivalRps(), 900, 100);
        assertThat(cache.capacityRps()).isCloseTo(2000, within(EPS));
        assertThat(cache.utilization()).isCloseTo(0.5, within(EPS));
        assertThat(cache.status()).isEqualTo(Status.OK);
        assertRates(result.edges().get("e2").rps(), 180, 100);
        assertRates(result.nodes().get("db").arrivalRps(), 180, 100);
    }

    @Test
    void overloadedCacheSendsOnlyProcessedTrafficDownstream() {
        // Cache 容量 500，λ = 1000 → 處理 450 read、50 write，再依 hitRatio 分流
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, new CapacityParams(1, 5, 10), 0.8),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, HUGE)),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 1),
                        new Edge("e2", "cache", "db", 1, 1, 1))));

        assertThat(result.nodes().get("cache").status()).isEqualTo(Status.OVERLOADED);
        assertThat(result.nodes().get("cache").droppedRps()).isCloseTo(500, within(EPS));
        assertRates(result.nodes().get("db").arrivalRps(), 90, 50);
    }

    /** Client → Service → cache → Database，端到端延遲和成功率都經過 cache。Database 容量足夠不影響結果。 */
    private SimulationResult runThrough(CachingNode cache) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL),
                        cache,
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, HUGE)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "cache", 1, 1, 2),
                        new Edge("e3", "cache", "db", 1, 1, 3))));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 5, 20})
    void cdnComputesLikeCacheWithSameParams(int concurrency) {
        // λ = 1000：concurrency 1、5 時 cache 過載（成功率 < 1），20 時沒有過載（端到端延遲是數字）
        var params = new CapacityParams(1, concurrency, 10);

        SimulationResult cdn = runThrough(new CdnNode("cache", "CDN", NodeHealth.HEALTHY, params, 0.8));
        SimulationResult cache = runThrough(new CacheNode("cache", "Redis", NodeHealth.HEALTHY, params, 0.8));

        assertThat(cdn.valid()).isTrue();
        assertThat(cdn.nodes()).isEqualTo(cache.nodes());
        assertThat(cdn.edges()).isEqualTo(cache.edges());
        // 只有 CDN 命中才算擋掉 origin 頻寬（spec 4.7），Cache 的命中仍由 origin 送出
        assertThat(cdn.summary()).usingRecursiveComparison().ignoringFields("cdnOffloadBytesPerSec")
                .isEqualTo(cache.summary());
        if (concurrency == 20) {
            assertThat(cdn.nodes().get("client").endToEndMs().read().ms()).isNotNull();
        } else {
            assertThat(cdn.nodes().get("client").successRps()).isLessThan(1000);
        }
    }

    /** Client → Service → storage，延遲和成功率都經過 storage。 */
    private SimulationResult runInto(StorageNode storage) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, HUGE, CallMode.SEQUENTIAL),
                        storage),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "storage", 1, 1, 2))));
    }

    @ParameterizedTest
    @ValueSource(ints = {5, 20})
    void objectStorageComputesLikeDatabaseWithSameParams(int concurrency) {
        // λ = 1000：concurrency 5 時過載（成功率 < 1），20 時沒有過載（端到端延遲是數字）
        var params = new CapacityParams(1, concurrency, 10);

        // 儲存量估算的預設值不同（spec 4.8），比較時用同一組
        var sizing = new StorageSizing(1_000, 30, null);
        SimulationResult objectStorage = runInto(new ObjectStorageNode("storage", "S3", NodeHealth.HEALTHY, params,
                sizing));
        SimulationResult database = runInto(new DatabaseNode("storage", "DB", NodeHealth.HEALTHY, params,
                sizing));

        assertThat(objectStorage.valid()).isTrue();
        assertThat(objectStorage).isEqualTo(database);
        if (concurrency == 20) {
            assertThat(objectStorage.nodes().get("client").endToEndMs().read().ms()).isNotNull();
        } else {
            assertThat(objectStorage.nodes().get("client").successRps()).isLessThan(1000);
        }
    }

    /** Client → Service，Service 對 a、b 兩個 Database 各呼叫 callsA、callsB 次。 */
    private SimulationResult runFanOut(double rps, CapacityParams service, int callsA, int callsB) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, service, CallMode.SEQUENTIAL),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, HUGE),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, HUGE)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "a", 1, callsA, 1),
                        new Edge("e3", "svc", "b", 1, callsB, 1))));
    }

    @Test
    void serviceCallsEachDownstreamCallsPerRequestTimes() {
        SimulationResult result = runFanOut(1000, HUGE, 2, 1);

        assertThat(result.nodes().get("svc").throughputRps()).isCloseTo(1000, within(EPS));
        assertRates(result.edges().get("e2").rps(), 1800, 200);
        assertRates(result.edges().get("e3").rps(), 900, 100);
        assertThat(result.nodes().get("a").arrivalRps().total()).isCloseTo(2000, within(EPS));
        assertThat(result.nodes().get("b").arrivalRps().total()).isCloseTo(1000, within(EPS));
    }

    @Test
    void overloadedServiceFansOutOnlyProcessedTraffic() {
        // Service 容量 100，λ = 150 → 處理 100，下游收到 2 × 100 和 1 × 100
        SimulationResult result = runFanOut(150, new CapacityParams(1, 1, 10), 2, 1);

        assertThat(result.nodes().get("svc").status()).isEqualTo(Status.OVERLOADED);
        assertRates(result.nodes().get("a").arrivalRps(), 180, 20);
        assertRates(result.nodes().get("b").arrivalRps(), 90, 10);
    }

    @Test
    void serviceWithoutDownstreamIsAnEndpoint() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, new CapacityParams(2, 200, 50),
                                CallMode.SEQUENTIAL)),
                List.of(new Edge("e1", "client", "svc", 1, 1, 1))));

        assertThat(result.valid()).isTrue();
        assertRates(result.nodes().get("svc").arrivalRps(), 900, 100);
        assertThat(result.nodes().get("svc").utilization()).isCloseTo(0.125, within(EPS));
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
