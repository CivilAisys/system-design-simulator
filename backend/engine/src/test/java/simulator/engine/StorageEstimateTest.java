package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 儲存量估算（spec 4.8）：用成功處理的 write、bytesPerWrite、retentionDays 推算資料量和磁碟幾天後會滿。 */
class StorageEstimateTest {

    private static final double EPS = 1e-3;
    private static final double DAY = 86_400;
    private static final CapacityParams AMPLE = new CapacityParams(10, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client 1000 rps、write 10%（100 rps）→ Service → storage，Service 容量足夠。 */
    private SimulationResult run(Node storage, Node... more) {
        var nodes = new ArrayList<Node>(List.of(
                new ClientNode("c", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                storage));
        var edges = new ArrayList<Edge>(List.of(
                new Edge("e1", "c", "svc", 1, 1, 0), new Edge("e2", "svc", storage.id(), 1, 1, 0)));
        for (Node node : more) {
            nodes.add(node);
            edges.add(new Edge("r-" + node.id(), storage.id(), node.id(), 1, 1, 0));
        }
        return simulator.simulate(new Topology(nodes, edges));
    }

    private static DatabaseNode db(CapacityParams capacity, StorageSizing sizing) {
        return new DatabaseNode("db", "DB", NodeHealth.HEALTHY, capacity, sizing);
    }

    private static ReadReplicaNode replica(String id) {
        return new ReadReplicaNode(id, id, NodeHealth.HEALTHY, AMPLE);
    }

    @Test
    void dailyGrowthAndTotalFollowProcessedWrites() {
        // 100 write/s × 2 KB × 86400 = 17.28 GB/天，保留 30 天
        SimulationResult result = run(db(AMPLE, new StorageSizing(2_000, 30, null)));
        StorageEstimate estimate = result.storage().get("db");

        assertThat(estimate.dailyBytes()).isCloseTo(100 * 2_000 * DAY, within(EPS));
        assertThat(estimate.totalBytes()).isCloseTo(100 * 2_000 * DAY * 30, within(EPS));
        assertThat(estimate.replicas()).isZero();
        assertThat(estimate.totalWithReplicasBytes()).isEqualTo(estimate.totalBytes());
        // AMPLE 是 10 台：資料平均分在每台
        assertThat(estimate.perInstanceBytes()).isCloseTo(estimate.totalBytes() / 10, within(EPS));
        assertThat(estimate.daysUntilFull()).isNull();
        assertThat(estimate.fillsDisk()).isFalse();
    }

    @Test
    void replicasMultiplyTheStoredCopies() {
        SimulationResult result = run(db(AMPLE, new StorageSizing(2_000, 30, null)), replica("r1"), replica("r2"));
        StorageEstimate estimate = result.storage().get("db");

        assertThat(estimate.replicas()).isEqualTo(2);
        assertThat(estimate.totalWithReplicasBytes()).isCloseTo(estimate.totalBytes() * 3, within(EPS));
        // Read Replica 沿用 primary 的設定，沒有自己的估算
        assertThat(result.storage()).containsOnlyKeys("db");
    }

    @Test
    void eachInstanceStoresAnEqualShare() {
        var four = new CapacityParams(4, 10_000, 1);
        StorageEstimate estimate = run(db(four, new StorageSizing(2_000, 30, null))).storage().get("db");

        assertThat(estimate.perInstanceBytes()).isCloseTo(estimate.totalBytes() / 4, within(EPS));
    }

    @Test
    void daysUntilDiskFullUseDailyGrowthPerInstance() {
        // 2 台：每台每天 17.28 GB ÷ 2 = 8.64 GB；磁碟 100 GB → 約 11.57 天，保留 30 天內就會滿
        var two = new CapacityParams(2, 10_000, 1);
        StorageEstimate estimate = run(db(two, new StorageSizing(2_000, 30, 100.0))).storage().get("db");

        assertThat(estimate.daysUntilFull()).isCloseTo(100e9 / (100 * 2_000 * DAY / 2), within(1e-9));
        assertThat(estimate.fillsDisk()).isTrue();
    }

    @Test
    void diskThatOutlastsRetentionDoesNotFill() {
        // 保留 30 天共 518.4 GB，磁碟 1 TB
        StorageEstimate estimate = run(db(AMPLE, new StorageSizing(2_000, 30, 1_000.0))).storage().get("db");

        assertThat(estimate.daysUntilFull()).isGreaterThan(30);
        assertThat(estimate.fillsDisk()).isFalse();
    }

    @Test
    void droppedWritesAreNotStored() {
        // DB 容量 1 × 500 / 1000ms = 500 rps：λ = 1000（read 900、write 100）只處理一半，write 處理 50
        StorageEstimate estimate = run(db(new CapacityParams(1, 500, 1000), new StorageSizing(2_000, 30, null)))
                .storage().get("db");

        assertThat(estimate.dailyBytes()).isCloseTo(50 * 2_000 * DAY, within(EPS));
    }

    @Test
    void noWritesNeverFillTheDisk() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(new ClientNode("c", "Users", NodeHealth.HEALTHY, 1000, 1),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                        db(AMPLE, new StorageSizing(2_000, 30, 100.0))),
                List.of(new Edge("e1", "c", "svc", 1, 1, 0), new Edge("e2", "svc", "db", 1, 1, 0))));
        StorageEstimate estimate = result.storage().get("db");

        assertThat(estimate.dailyBytes()).isZero();
        assertThat(estimate.daysUntilFull()).isNull();
        assertThat(estimate.fillsDisk()).isFalse();
    }

    @Test
    void tinyWritesDoNotOverflowDaysUntilFull() {
        // 每天增加不到 1e-290 bytes：天數超過 double 的範圍
        StorageEstimate estimate = run(db(AMPLE, new StorageSizing(1e-300, 30, 1e9))).storage().get("db");

        assertThat(estimate.daysUntilFull()).isNull();
        assertThat(estimate.fillsDisk()).isFalse();
    }

    @Test
    void estimateCarriesTheSizingItUsed() {
        StorageEstimate estimate = run(db(AMPLE, new StorageSizing(2_000, 30, 100.0))).storage().get("db");

        assertThat(estimate.retentionDays()).isEqualTo(30);
        assertThat(estimate.diskGbPerInstance()).isEqualTo(100.0);
    }

    @Test
    void objectStorageUsesItsOwnDefaults() {
        StorageEstimate estimate = run(new ObjectStorageNode("db", "S3", NodeHealth.HEALTHY, AMPLE))
                .storage().get("db");

        assertThat(estimate.dailyBytes()).isCloseTo(
                100 * ObjectStorageNode.DEFAULT_SIZING.bytesPerWrite() * DAY, within(EPS));
        assertThat(estimate.totalBytes()).isCloseTo(estimate.dailyBytes() * 365, within(1.0));
    }
}
