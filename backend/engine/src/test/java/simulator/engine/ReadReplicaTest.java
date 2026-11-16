package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Read Replica（spec 4.2.3）：write 是 primary 處理完的寫入，read 由 Service 的 READ 邊送來。 */
class ReadReplicaTest {

    private static final double EPS = 1e-6;
    private static final CapacityParams ROOMY = new CapacityParams(1, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** μ = 100，容量 = workers × 100 rps。 */
    private static CapacityParams workers(int workers) {
        return new CapacityParams(1, workers, 10);
    }

    /** Client → Service ─WRITE→ primary ─複製→ replica，Service ─READ→ replica。 */
    private SimulationResult run(double rps, double readRatio, DatabaseNode primary, CapacityParams replica) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, readRatio),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, ROOMY, CallMode.SEQUENTIAL),
                        primary,
                        new ReadReplicaNode("replica", "Replica", NodeHealth.HEALTHY, replica)),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 0),
                        new Edge("write", "svc", "db", 1, 1, 2, RequestClass.WRITE),
                        new Edge("read", "svc", "replica", 1, 1, 2, RequestClass.READ),
                        new Edge("repl", "db", "replica", 1, 1, 50))));
    }

    private static DatabaseNode primary(CapacityParams params) {
        return new DatabaseNode("db", "Primary", NodeHealth.HEALTHY, params);
    }

    private static void assertRates(ClassRates actual, double read, double write) {
        assertThat(actual.read()).isCloseTo(read, within(EPS));
        assertThat(actual.write()).isCloseTo(write, within(EPS));
    }

    @Test
    void replicaWritesAreThePrimaryProcessedWrites() {
        // primary 容量 100，收到 write 200：處理 100，複製到 replica 的也是 100
        SimulationResult result = run(1000, 0.8, primary(workers(1)), workers(20));

        assertRates(result.nodes().get("db").arrivalRps(), 0, 200);
        assertRates(result.edges().get("repl").rps(), 0, 100);
        assertRates(result.nodes().get("replica").arrivalRps(), 800, 100);
    }

    @Test
    void replicaTakesReadsOffThePrimary() {
        SimulationResult result = run(1000, 0.9, primary(workers(5)), workers(20));

        // primary 只剩 write 100：ρ 0.2；replica 收 read 900 + 複製 100：ρ 0.5
        assertThat(result.nodes().get("db").utilization()).isCloseTo(0.2, within(EPS));
        assertThat(result.nodes().get("replica").utilization()).isCloseTo(0.5, within(EPS));
        assertThat(result.nodes().get("replica").warnings()).isEmpty();
        assertThat(result.summary().dropRate()).isZero();
    }

    @Test
    void heavyWritesOverloadTheReplicaTooAndLagReplication() {
        // write 多：primary 容量 1000 處理 600 write；replica 容量 1000 要套用 600 write 再加 400 read → 剛好過載
        SimulationResult result = run(1000, 0.4, primary(workers(10)), workers(9));
        NodeResult replica = result.nodes().get("replica");

        assertThat(replica.status()).isEqualTo(Status.OVERLOADED);
        assertThat(replica.warnings()).containsExactly(NodeWarning.REPLICATION_LAG);
        // 丟棄依比例分給 read 和複製寫入：900 / 1000 通過
        assertThat(replica.droppedRps()).isCloseTo(100, within(EPS));
    }

    @Test
    void replicationDoesNotAffectClientLatencyOrSuccess() {
        // replica 被複製寫入壓到過載：write 的請求只到 primary，延遲和成功率都不受影響
        SimulationResult result = run(1000, 0.4, primary(workers(10)), workers(5));
        NodeResult client = result.nodes().get("client");
        double write = result.nodes().get("svc").avgLatencyMs() + 2 * 2 + result.nodes().get("db").avgLatencyMs();

        assertThat(client.endToEndMs().write().ms()).isCloseTo(write, within(EPS));
        // read 走到過載的 replica：延遲無定義，成功率 = replica 的通過率
        assertThat(client.endToEndMs().read().ms()).isNull();
        double replicaPass = 500.0 / 1000;
        assertThat(client.successRps()).isCloseTo(600 + 400 * replicaPass, within(EPS));
    }

    @Test
    void replicaMirrorsThePrimaryShards() {
        // primary 2 個 shard，最熱 75%：write 400 → 300（容量 200，處理 200）、100（全部處理）
        var sharded = new DatabaseNode("db", "Primary", NodeHealth.HEALTHY, workers(2), new ShardLayout(2, 0.75));
        SimulationResult result = run(1000, 0.6, sharded, workers(20));
        NodeResult replica = result.nodes().get("replica");

        assertThat(replica.shards()).hasSize(2);
        // shard 1：read 600 × 0.75 + 複製 200；shard 2：read 600 × 0.25 + 複製 100
        assertRates(replica.shards().get(0).arrivalRps(), 450, 200);
        assertRates(replica.shards().get(1).arrivalRps(), 150, 100);
        assertRates(replica.arrivalRps(), 600, 300);
    }

    @Test
    void shardedReplicaReadSuccessUsesEachShardsReadShare() {
        // primary 2 個 shard，最熱 75%、容量各 200：write 400 → 熱 shard 300 只處理 200，另一個 100
        // replica 每個 shard 容量 500：熱 shard read 450 + 寫 200 = 650（處理 500），另一個 read 150 + 寫 100 = 250
        var sharded = new DatabaseNode("db", "Primary", NodeHealth.HEALTHY, workers(2), new ShardLayout(2, 0.75));
        SimulationResult result = run(1000, 0.6, sharded, workers(5));

        // read 的通過率逐 shard 算：(450 × 500/650 + 150) / 600，不是整個節點的 750/900
        double readPass = (450 * 500.0 / 650 + 150) / 600;
        double writePass = 300.0 / 400;
        assertThat(result.nodes().get("client").successRps()).isCloseTo(600 * readPass + 400 * writePass, within(EPS));
        assertThat(result.nodes().get("replica").warnings()).containsExactly(NodeWarning.REPLICATION_LAG);
    }

    @Test
    void duplicateOrUnknownReplicationEdgesAreReportedOnce() {
        SimulationResult duplicate = validate(List.of(client(), database("a"), replica("r")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "r"), edge("e3", "a", "r")));
        SimulationResult unknown = validate(List.of(client(), replica("r")),
                List.of(edge("e1", "c", "r"), edge("e2", "ghost", "r")));

        assertThat(duplicate.errors()).extracting(ValidationError::code).containsExactly("DUPLICATE_EDGE");
        assertThat(unknown.errors()).extracting(ValidationError::code).containsExactly("UNKNOWN_NODE");
    }

    private SimulationResult validate(List<Node> nodes, List<Edge> edges) {
        return simulator.simulate(new Topology(nodes, edges));
    }

    private static ClientNode client() {
        return new ClientNode("c", "Users", NodeHealth.HEALTHY, 100, 0.9);
    }

    private static ReadReplicaNode replica(String id) {
        return new ReadReplicaNode(id, id, NodeHealth.HEALTHY, workers(10));
    }

    private static DatabaseNode database(String id) {
        return new DatabaseNode(id, id, NodeHealth.HEALTHY, workers(10));
    }

    private static Edge edge(String id, String source, String target) {
        return new Edge(id, source, target, 1, 1, 1);
    }

    @Test
    void replicaNeedsExactlyOnePrimaryAndNoDownstream() {
        SimulationResult none = validate(List.of(client(), replica("r")), List.of(edge("e1", "c", "r")));
        SimulationResult two = validate(List.of(client(), database("a"), database("b"), replica("r")),
                List.of(edge("e1", "c", "a"), edge("e2", "c", "b"), edge("e3", "a", "r"), edge("e4", "b", "r")));
        SimulationResult output = validate(List.of(client(), database("a"), replica("r"), database("d")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "r"), edge("e3", "r", "d")));

        assertThat(none.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("REPLICA_PRIMARY_COUNT", "r"));
        assertThat(two.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("REPLICA_PRIMARY_COUNT", "r"));
        assertThat(two.errors().getFirst().message()).contains("2");
        assertThat(output.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("REPLICA_HAS_OUTPUT", "r"));
    }

    @Test
    void databaseMayOnlyOutputToReadReplicas() {
        SimulationResult toReplica = validate(List.of(client(), database("a"), replica("r")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "r")));
        SimulationResult toDatabase = validate(List.of(client(), database("a"), database("b")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "b")));

        assertThat(toReplica.errors()).isEmpty();
        assertThat(toDatabase.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("DATABASE_HAS_OUTPUT", "a"));
        assertThat(toDatabase.errors().getFirst().message()).contains("只能連到 Read Replica");
    }
}
