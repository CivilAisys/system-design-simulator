package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** 儲存量估算的計算說明（spec 4.8、4.9）：步驟的結果和 StorageEstimate 的欄位相同，沒有的數字不列。 */
class StorageExplanationTest {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([^}]+)}");
    private static final CapacityParams AMPLE = new CapacityParams(4, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client 1000 rps → Service → storage，storage 再複製到 replicas；另外一個未連線的 Database。 */
    private SimulationResult run(double readRatio, Node storage, Node... replicas) {
        var nodes = new ArrayList<Node>(List.of(
                new ClientNode("c", "Users", NodeHealth.HEALTHY, 1000, readRatio),
                new ServiceNode("svc", "API", NodeHealth.HEALTHY, AMPLE, CallMode.SEQUENTIAL),
                storage,
                new DatabaseNode("idle", "Idle", NodeHealth.HEALTHY, AMPLE)));
        var edges = new ArrayList<Edge>(List.of(
                new Edge("e1", "c", "svc", 1, 1, 0), new Edge("e2", "svc", storage.id(), 1, 1, 0)));
        for (Node replica : replicas) {
            nodes.add(replica);
            edges.add(new Edge("r-" + replica.id(), storage.id(), replica.id(), 1, 1, 0));
        }
        return simulator.simulate(new Topology(nodes, edges));
    }

    private static DatabaseNode db(CapacityParams capacity, Double diskGb) {
        return new DatabaseNode("db", "DB", NodeHealth.HEALTHY, capacity, new StorageSizing(2_000, 30, diskGb));
    }

    private static ExplanationStep step(List<ExplanationStep> steps, String labelPrefix) {
        return steps.stream().filter(step -> step.label().startsWith(labelPrefix)).findFirst()
                .orElseThrow(() -> new AssertionError("No step " + labelPrefix + " in " + steps));
    }

    @Test
    void everyStepMatchesTheEstimate() {
        // 每台 1 TB、每日增量 17.28 GB ÷ 4 台：約 231 天會滿，超過保留期 30 天
        SimulationResult result = run(0.9, db(AMPLE, 1000.0),
                new ReadReplicaNode("r1", "Replica A", NodeHealth.HEALTHY, AMPLE),
                new ReadReplicaNode("r2", "Replica B", NodeHealth.HEALTHY, AMPLE));
        StorageEstimate estimate = result.storage().get("db");
        List<ExplanationStep> steps = estimate.explanation();

        assertThat(steps).extracting(ExplanationStep::group)
                .containsExactly("每日增量", "每日增量", "總量", "總量", "每台", "磁碟", "磁碟");
        assertThat(step(steps, "處理完的 write").value()).isEqualTo(100.0 * 1000 / 1000);
        assertThat(step(steps, "處理完的 write").terms().getFirst().nodeId()).isEqualTo("db");
        assertThat(step(steps, "每日增量").value()).isEqualTo(estimate.dailyBytes());
        assertThat(step(steps, "每日增量").terms().getFirst().nodeId()).isEqualTo("db");
        assertThat(step(steps, "總量").value()).isEqualTo(estimate.totalBytes());
        assertThat(step(steps, "含副本").value()).isEqualTo(estimate.totalWithReplicasBytes());
        assertThat(step(steps, "含副本").label()).isEqualTo("含副本（Read Replica：Replica A、Replica B）");
        assertThat(step(steps, "每台").value()).isEqualTo(estimate.perInstanceBytes());
        assertThat(step(steps, "磁碟幾天後會滿").value()).isEqualTo(estimate.daysUntilFull());
        assertThat(step(steps, "磁碟幾天後會滿").label()).isEqualTo("磁碟幾天後會滿（≥ 保留期 30 天：保留期內不會滿）");
        assertPlaceholdersMatchTerms(steps);
    }

    @Test
    void diskThatFillsWithinRetentionSaysSo() {
        // 每台 10 GB、每日 4.32 GB：約 2.3 天就滿
        List<ExplanationStep> steps = run(0.9, db(AMPLE, 10.0)).storage().get("db").explanation();

        assertThat(step(steps, "磁碟幾天後會滿").label()).isEqualTo("磁碟幾天後會滿（< 保留期 30 天：保留期內就會滿）");
        assertThat(step(steps, "含副本").label()).isEqualTo("含副本（沒有 Read Replica）");
    }

    @Test
    void objectStorageOnlyHasGrowthAndTotal() {
        SimulationResult result = run(0.9, new ObjectStorageNode("db", "Media", NodeHealth.HEALTHY, AMPLE));

        assertThat(result.storage().get("db").explanation()).extracting(ExplanationStep::group)
                .containsOnly("每日增量", "總量").hasSize(3);
    }

    @Test
    void noDiskOrNoWritesMeansNoDiskSteps() {
        assertThat(run(0.9, db(AMPLE, null)).storage().get("db").explanation())
                .extracting(ExplanationStep::group).doesNotContain("磁碟");
        // 只有 read：資料不會增加，磁碟不會滿
        List<ExplanationStep> readOnly = run(1, db(AMPLE, 1000.0)).storage().get("db").explanation();
        assertThat(readOnly).extracting(ExplanationStep::group).doesNotContain("磁碟");
        assertThat(step(readOnly, "每日增量").value()).isZero();
    }

    @Test
    void unconnectedStorageHasNoSteps() {
        assertThat(run(0.9, db(AMPLE, null)).storage().get("idle").explanation()).isEmpty();
    }

    @Test
    void laggingReplicaIsNotedOnTheTotal() {
        var slow = new ReadReplicaNode("slow", "Slow", NodeHealth.HEALTHY, new CapacityParams(1, 1, 20));
        StorageEstimate estimate = run(0.9, db(AMPLE, null), slow).storage().get("db");

        assertThat(estimate.replicasLagging()).isTrue();
        assertThat(step(estimate.explanation(), "含副本").label()).endsWith("，副本複製跟不上，實際副本量會比這少");
    }

    private static void assertPlaceholdersMatchTerms(List<ExplanationStep> steps) {
        for (ExplanationStep step : steps) {
            List<String> symbols = new ArrayList<>();
            Matcher matcher = PLACEHOLDER.matcher(step.formula());
            while (matcher.find()) {
                symbols.add(matcher.group(1));
            }
            assertThat(symbols).as(step.label())
                    .containsExactlyElementsOf(step.terms().stream().map(ExplanationTerm::symbol).toList());
        }
    }
}
