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
        double write = result.nodes().get("svc").avgLatencyMs() + 2 + result.nodes().get("db").avgLatencyMs();

        assertThat(client.endToEndMs().write().ms()).isCloseTo(write, within(EPS));
        // read 走到過載的 replica：延遲無定義，成功率 = replica 的通過率
        assertThat(client.endToEndMs().read().ms()).isNull();
        double replicaPass = 500.0 / 1000;
        assertThat(client.successRps()).isCloseTo(600 + 400 * replicaPass, within(EPS));
    }

    @Test
    void duplicateOrUnknownReplicationEdgesAreReportedOnce() {
        SimulationResult duplicate = validate(List.of(client(), database("a"), replica("r")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "r"), edge("e3", "a", "r")));
        SimulationResult unknown = validate(List.of(readOnlyClient(), replica("r")),
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

    /** readRatio = 1：沒有 write，可以直接連到 replica。 */
    private static ClientNode readOnlyClient() {
        return new ClientNode("c", "Users", NodeHealth.HEALTHY, 100, 1);
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

    private static Edge edge(String id, String source, String target, RequestClass requestClass) {
        return new Edge(id, source, target, 1, 1, 1, requestClass);
    }

    private static ServiceNode service(String id) {
        return new ServiceNode(id, id, NodeHealth.HEALTHY, workers(10), CallMode.SEQUENTIAL);
    }

    private static LoadBalancerNode loadBalancer(String id) {
        return new LoadBalancerNode(id, id, NodeHealth.HEALTHY, workers(10));
    }

    /** Client → Service ─(requestClass)→ replica，replica 的 primary 是 db。 */
    private SimulationResult serviceToReplica(RequestClass requestClass) {
        return validate(List.of(client(), service("s"), database("db"), replica("r")),
                List.of(edge("e1", "c", "s"), edge("e2", "s", "db", RequestClass.WRITE),
                        edge("e3", "s", "r", requestClass), edge("e4", "db", "r")));
    }

    /** Client → Service ─(requestClass)→ LB → 兩個 replica，primary 都是 db。 */
    private SimulationResult serviceToReplicasThroughLb(RequestClass requestClass) {
        return validate(
                List.of(client(), service("s"), database("db"), loadBalancer("lb"), replica("r1"), replica("r2")),
                List.of(edge("e1", "c", "s"), edge("e2", "s", "db", RequestClass.WRITE),
                        edge("e3", "s", "lb", requestClass), edge("e4", "lb", "r1"), edge("e5", "lb", "r2"),
                        edge("e6", "db", "r1"), edge("e7", "db", "r2")));
    }

    private static List<String> receivesWrites(SimulationResult result) {
        return result.errors().stream().filter(error -> error.code().equals("REPLICA_RECEIVES_WRITES"))
                .map(ValidationError::nodeId).toList();
    }

    @Test
    void writesCanOnlyReachAReplicaThroughReplication() {
        assertThat(receivesWrites(serviceToReplica(RequestClass.ALL))).containsExactly("r");
        assertThat(receivesWrites(serviceToReplica(RequestClass.WRITE))).containsExactly("r");
        assertThat(serviceToReplica(RequestClass.READ).errors()).isEmpty();

        // LB 原樣往下傳：上游 Service 的邊有 write 就報錯，只有 READ 就合法
        assertThat(receivesWrites(serviceToReplicasThroughLb(RequestClass.ALL))).containsExactly("r1", "r2");
        assertThat(serviceToReplicasThroughLb(RequestClass.READ).errors()).isEmpty();
    }

    @Test
    void clientsSendWritesUnlessTheyOnlyRead() {
        List<Edge> edges = List.of(edge("e1", "c", "db"), edge("e2", "c", "lb"), edge("e3", "lb", "r"),
                edge("e4", "db", "r"));
        SimulationResult mixed = validate(List.of(client(), database("db"), loadBalancer("lb"), replica("r")), edges);
        SimulationResult readOnly = validate(
                List.of(readOnlyClient(), database("db"), loadBalancer("lb"), replica("r")), edges);
        SimulationResult direct = validate(List.of(client(), database("db"), replica("r")),
                List.of(edge("e1", "c", "db"), edge("e2", "c", "r"), edge("e3", "db", "r")));

        assertThat(mixed.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("REPLICA_RECEIVES_WRITES", "r"));
        assertThat(readOnly.errors()).isEmpty();
        assertThat(receivesWrites(direct)).containsExactly("r");
    }

    @Test
    void replicaNeedsExactlyOnePrimaryAndNoDownstream() {
        SimulationResult none = validate(List.of(readOnlyClient(), replica("r")), List.of(edge("e1", "c", "r")));
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
