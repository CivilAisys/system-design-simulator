package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 未連線的節點（沒有任何邊）不檢查跟邊有關的規則，照常計算成沒有流量（spec 4.5）。 */
class UnconnectedNodeTest {

    private static final CapacityParams CAPACITY = new CapacityParams(1, 100, 10);

    private final Simulator simulator = new SteadyStateSimulator();

    // 一條連好的路徑，加上未連線的節點後結果不能變
    private static final List<Node> CONNECTED = List.of(
            new ClientNode("c", "Users", NodeHealth.HEALTHY, 100, 0.9),
            new ServiceNode("s", "API", NodeHealth.HEALTHY, CAPACITY, CallMode.SEQUENTIAL),
            new DatabaseNode("db", "DB", NodeHealth.HEALTHY, CAPACITY));
    private static final List<Edge> EDGES = List.of(new Edge("e1", "c", "s", 1, 1, 1),
            new Edge("e2", "s", "db", 1, 1, 1));

    // Client 以外的每一種元件，各自沒有任何邊
    private static final List<Node> UNCONNECTED = List.of(
            new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, CAPACITY),
            new ServiceNode("svc", "Service", NodeHealth.HEALTHY, CAPACITY, CallMode.SEQUENTIAL),
            new CacheNode("cache", "Cache", NodeHealth.HEALTHY, CAPACITY, 0.8),
            new CdnNode("cdn", "CDN", NodeHealth.HEALTHY, CAPACITY, 0.95),
            new DatabaseNode("db2", "DB 2", NodeHealth.HEALTHY, CAPACITY),
            new ReadReplicaNode("replica", "Replica", NodeHealth.HEALTHY, CAPACITY),
            new ObjectStorageNode("s3", "Media", NodeHealth.HEALTHY, CAPACITY),
            new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, CAPACITY),
            new RateLimiterNode("rl", "Limiter", NodeHealth.HEALTHY, 1000),
            new ExternalApiNode("pay", "Payments", NodeHealth.HEALTHY, 100, 1000));

    private SimulationResult run(List<Node> nodes, List<Edge> edges) {
        return simulator.simulate(new Topology(nodes, edges));
    }

    private static List<Node> plus(List<Node> base, List<Node> extra) {
        var nodes = new ArrayList<>(base);
        nodes.addAll(extra);
        return nodes;
    }

    @Test
    void unconnectedNodesAreNotValidated() {
        SimulationResult result = run(plus(CONNECTED, UNCONNECTED), EDGES);

        assertThat(result.valid()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void unconnectedNodesAreComputedWithoutTraffic() {
        SimulationResult result = run(plus(CONNECTED, UNCONNECTED), EDGES);

        for (Node node : UNCONNECTED) {
            NodeResult nodeResult = result.nodes().get(node.id());
            assertThat(nodeResult.arrivalRps().total()).as(node.id()).isZero();
            assertThat(nodeResult.droppedRps()).as(node.id()).isZero();
        }
        assertThat(result.storage().get("db2").dailyBytes()).isZero();
        assertThat(result.storage().get("db2").replicas()).isZero();
    }

    @Test
    void unconnectedNodesDoNotChangeTheConnectedResults() {
        SimulationResult alone = run(CONNECTED, EDGES);
        SimulationResult withUnconnected = run(plus(CONNECTED, UNCONNECTED), EDGES);

        for (Node node : CONNECTED) {
            assertThat(withUnconnected.nodes().get(node.id())).as(node.id()).isEqualTo(alone.nodes().get(node.id()));
        }
        assertThat(withUnconnected.summary()).isEqualTo(alone.summary());
    }

    @Test
    void unconnectedClientIsStillRejected() {
        SimulationResult result = run(plus(CONNECTED,
                List.of(new ClientNode("c2", "Bots", NodeHealth.HEALTHY, 100, 0.9))), EDGES);

        assertThat(result.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("NO_DOWNSTREAM", "c2"));
    }

    @Test
    void unconnectedNodeParamsAreStillChecked() {
        SimulationResult result = run(plus(CONNECTED,
                List.of(new ServiceNode("svc", "Service", NodeHealth.HEALTHY, new CapacityParams(0, 100, 10),
                        CallMode.SEQUENTIAL))), EDGES);

        assertThat(result.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("INVALID_PARAM", "svc"));
    }

    @Test
    void nodeWithOnlyAnUpstreamIsStillValidated() {
        SimulationResult result = run(plus(CONNECTED, List.of(new CacheNode("cache", "Cache", NodeHealth.HEALTHY,
                CAPACITY, 0.8))), List.of(EDGES.get(0), EDGES.get(1), new Edge("e3", "c", "cache", 1, 1, 1)));

        assertThat(result.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("CACHE_DOWNSTREAM_COUNT", "cache"));
    }

    @Test
    void nodeWithOnlyADownstreamIsStillValidated() {
        SimulationResult result = run(plus(CONNECTED, List.of(new ReadReplicaNode("replica", "Replica",
                NodeHealth.HEALTHY, CAPACITY))), List.of(EDGES.get(0), EDGES.get(1),
                new Edge("e3", "replica", "db", 1, 1, 1)));

        assertThat(result.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("REPLICA_PRIMARY_COUNT", "replica"), tuple("REPLICA_HAS_OUTPUT", "replica"));
    }
}
