package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** 分片（spec 4.2.2）：每個 shard 套用節點的參數，最熱的 shard 決定節點的 ρ。 */
class ShardingTest {

    private static final double EPS = 1e-6;
    // μ = 100、c = 10：每個 shard 容量 1000 rps
    private static final CapacityParams SHARD = new CapacityParams(1, 10, 10);

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client（read 90%）→ Database。 */
    private SimulationResult runDatabase(double rps, ShardLayout shards) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0.9),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, SHARD, shards)),
                List.of(new Edge("e1", "client", "db", 1, 1, 1))));
    }

    @Test
    void singleShardIsTheSameAsNoSharding() {
        SimulationResult plain = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 800, 0.9),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, SHARD)),
                List.of(new Edge("e1", "client", "db", 1, 1, 1))));

        assertThat(runDatabase(800, new ShardLayout(1, null))).isEqualTo(plain);
        assertThat(runDatabase(800, new ShardLayout(1, 1.0))).isEqualTo(plain);
        assertThat(plain.nodes().get("db").shards()).isNull();
    }

    @Test
    void evenSplitMultipliesCapacity() {
        // 4 個 shard 平均分配 3000 rps：每個 750，ρ = 0.75
        NodeResult db = runDatabase(3000, new ShardLayout(4, null)).nodes().get("db");

        assertThat(db.capacityRps()).isCloseTo(4000, within(EPS));
        assertThat(db.utilization()).isCloseTo(0.75, within(EPS));
        assertThat(db.status()).isEqualTo(Status.WARN);
        assertThat(db.throughputRps()).isCloseTo(3000, within(EPS));
        assertThat(db.droppedRps()).isZero();
        assertThat(db.shards()).hasSize(4).allSatisfy(shard -> {
            assertThat(shard.arrivalRps().total()).isCloseTo(750, within(EPS));
            assertThat(shard.utilization()).isCloseTo(0.75, within(EPS));
        });
        // 每個 shard 一樣，加權平均就是單一 shard 的延遲
        assertThat(db.avgLatencyMs()).isCloseTo(db.shards().getFirst().avgLatencyMs(), within(EPS));
    }

    @Test
    void hotShardOverloadsFirstAndDecidesNodeUtilization() {
        // 同樣 3000 rps，最熱的 shard 分到 40% = 1200 > 1000；其他 3 個各 600
        SimulationResult result = runDatabase(3000, new ShardLayout(4, 0.4));
        NodeResult db = result.nodes().get("db");

        assertThat(db.utilization()).isCloseTo(1.2, within(EPS));
        assertThat(db.status()).isEqualTo(Status.OVERLOADED);
        assertThat(db.droppedRps()).isCloseTo(200, within(EPS));
        assertThat(db.throughputRps()).isCloseTo(2800, within(EPS));
        assertThat(db.avgLatencyMs()).isNull();
        assertThat(result.summary().bottleneckNodeId()).isEqualTo("db");

        ShardResult hot = db.shards().getFirst();
        assertThat(hot.arrivalRps().total()).isCloseTo(1200, within(EPS));
        assertThat(hot.status()).isEqualTo(Status.OVERLOADED);
        assertThat(hot.avgLatencyMs()).isNull();
        assertThat(db.shards().subList(1, 4)).allSatisfy(shard -> {
            assertThat(shard.utilization()).isCloseTo(0.6, within(EPS));
            assertThat(shard.status()).isEqualTo(Status.OK);
        });
        // 只有最熱 shard 丟掉的請求失敗：pass = 2800 / 3000
        assertThat(result.summary().dropRate()).isCloseTo(200.0 / 3000, within(EPS));
    }

    @Test
    void latencyIsWeightedByShardTraffic() {
        // 最熱 shard 0.4 × 2000 = 800（ρ 0.8），其他各 400（ρ 0.4）
        NodeResult db = runDatabase(2000, new ShardLayout(4, 0.4)).nodes().get("db");
        ShardResult hot = db.shards().get(0);
        ShardResult other = db.shards().get(1);

        assertThat(db.utilization()).isCloseTo(0.8, within(EPS));
        assertThat(db.avgLatencyMs()).isCloseTo(0.4 * hot.avgLatencyMs() + 0.6 * other.avgLatencyMs(), within(EPS));
        assertThat(hot.avgLatencyMs()).isGreaterThan(other.avgLatencyMs());
    }

    @Test
    void shardedCacheSendsMissesOfAllShardsDownstream() {
        // Cache 2 個 shard，最熱的分 75%：1500 > 1000 過載，處理 1000；另一個 500 全部處理
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 2000, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, SHARD, 0.8, new ShardLayout(2, 0.75)),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 1))),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 1),
                        new Edge("e2", "cache", "db", 1, 1, 1))));

        NodeResult cache = result.nodes().get("cache");
        assertThat(cache.throughputRps()).isCloseTo(1500, within(EPS));
        // 處理完的 1500 裡 read 1350、write 150；read 只有 20% miss 往下送
        ClassRates down = result.edges().get("e2").rps();
        assertThat(down.read()).isCloseTo(1350 * 0.2, within(EPS));
        assertThat(down.write()).isCloseTo(150, within(EPS));
    }

    @Test
    void cdnAndObjectStorageNeverShard() {
        assertThat(new CdnNode("cdn", "CDN", NodeHealth.HEALTHY, SHARD, 0.9).shards()).isEqualTo(ShardLayout.SINGLE);
        assertThat(new ObjectStorageNode("s3", "S3", NodeHealth.HEALTHY, SHARD).shards())
                .isEqualTo(ShardLayout.SINGLE);
    }
}
