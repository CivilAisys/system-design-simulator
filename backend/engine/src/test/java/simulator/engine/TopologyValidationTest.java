package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import java.util.ArrayList;
import java.util.List;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/** 驗證規則（spec 4.5）：拓撲不合法時回傳 valid = false 和錯誤清單，不做任何計算。 */
class TopologyValidationTest {

    private static final CapacityParams CAPACITY = new CapacityParams(1, 100, 10);

    private final Simulator simulator = new SteadyStateSimulator();

    private static ClientNode client(String id) {
        return new ClientNode(id, id, NodeHealth.HEALTHY, 100, 0.9);
    }

    private static LoadBalancerNode loadBalancer(String id) {
        return new LoadBalancerNode(id, id, NodeHealth.HEALTHY, CAPACITY);
    }

    private static ServiceNode service(String id) {
        return new ServiceNode(id, id, NodeHealth.HEALTHY, CAPACITY, CallMode.SEQUENTIAL);
    }

    private static CacheNode cache(String id) {
        return new CacheNode(id, id, NodeHealth.HEALTHY, CAPACITY, 0.8);
    }

    private static DatabaseNode database(String id) {
        return new DatabaseNode(id, id, NodeHealth.HEALTHY, CAPACITY);
    }

    private static Edge edge(String id, String source, String target) {
        return new Edge(id, source, target, 1, 1, 1);
    }

    private SimulationResult run(List<Node> nodes, List<Edge> edges) {
        return simulator.simulate(new Topology(nodes, edges));
    }

    /** 錯誤依序是 (code, nodeId, edgeId)。 */
    private static void assertErrors(SimulationResult result, Tuple... expected) {
        assertThat(result.valid()).isFalse();
        assertThat(result.errors())
                .extracting(ValidationError::code, ValidationError::nodeId, ValidationError::edgeId)
                .containsExactly(expected);
    }

    @Test
    void invalidTopologyIsNotComputed() {
        SimulationResult result = run(List.of(client("c"), database("db")),
                List.of(edge("e1", "c", "db"), edge("e2", "db", "c")));

        assertThat(result.valid()).isFalse();
        assertThat(result.nodes()).isEmpty();
        assertThat(result.edges()).isEmpty();
        assertThat(result.summary()).isNull();
    }

    @Test
    void validTopologyHasNoErrors() {
        SimulationResult result = run(List.of(client("c"), database("db")), List.of(edge("e1", "c", "db")));

        assertThat(result.valid()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void topologyWithoutClientIsRejected() {
        assertErrors(run(List.of(service("s"), database("db")), List.of(edge("e1", "s", "db"))),
                tuple("NO_CLIENT", null, null));
    }

    @Test
    void emptyTopologyOnlyReportsMissingClient() {
        assertErrors(run(List.of(), List.of()), tuple("NO_CLIENT", null, null));
    }

    @Test
    void cycleIsReportedOnEveryNodeInIt() {
        // a → b → a 是環；d 在環的下游但不在環上
        SimulationResult result = run(List.of(client("c"), service("a"), service("b"), database("d")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "b"), edge("e3", "b", "a"), edge("e4", "b", "d")));

        assertErrors(result, tuple("CYCLE_DETECTED", "a", null), tuple("CYCLE_DETECTED", "b", null));
    }

    @Test
    @Timeout(5)
    void cycleWithoutAnyEntryDoesNotLoopForever() {
        // 環上沒有任何節點的入度為 0
        SimulationResult result = run(
                List.of(client("c"), database("db"), service("a"), service("b"), service("x")),
                List.of(edge("e1", "c", "db"), edge("e2", "a", "b"), edge("e3", "b", "x"), edge("e4", "x", "a")));

        assertErrors(result, tuple("CYCLE_DETECTED", "a", null), tuple("CYCLE_DETECTED", "b", null),
                tuple("CYCLE_DETECTED", "x", null));
    }

    @Test
    void nodeBetweenTwoCyclesIsNotOnACycle() {
        // a ↔ b、b → x → y、y ↔ z：x 夾在兩個環中間，但自己不在環上
        SimulationResult result = run(
                List.of(client("c"), database("db"), service("a"), service("b"), service("x"), service("y"),
                        service("z")),
                List.of(edge("e1", "c", "db"), edge("e2", "a", "b"), edge("e3", "b", "a"), edge("e4", "b", "x"),
                        edge("e5", "x", "y"), edge("e6", "y", "z"), edge("e7", "z", "y")));

        assertErrors(result, tuple("CYCLE_DETECTED", "a", null), tuple("CYCLE_DETECTED", "b", null),
                tuple("CYCLE_DETECTED", "y", null), tuple("CYCLE_DETECTED", "z", null));
    }

    @Test
    void longChainDoesNotOverflowTheStack() {
        // 找環不用遞迴：10 萬個節點的鏈，最後接回前一個節點形成環
        List<Node> nodes = new ArrayList<>(List.of(client("c")));
        List<Edge> edges = new ArrayList<>(List.of(edge("e0", "c", "s0")));
        int length = 100_000;
        for (int i = 0; i < length; i++) {
            nodes.add(service("s" + i));
            if (i > 0) {
                edges.add(edge("e" + i, "s" + (i - 1), "s" + i));
            }
        }
        edges.add(edge("back", "s" + (length - 1), "s" + (length - 2)));

        assertErrors(run(nodes, edges), tuple("CYCLE_DETECTED", "s" + (length - 2), null),
                tuple("CYCLE_DETECTED", "s" + (length - 1), null));
    }

    @Test
    void selfLoopIsACycle() {
        SimulationResult result = run(List.of(client("c"), service("s")),
                List.of(edge("e1", "c", "s"), edge("e2", "s", "s")));

        assertErrors(result, tuple("CYCLE_DETECTED", "s", null));
    }

    @Test
    void clientWithIncomingEdgeIsRejected() {
        SimulationResult result = run(List.of(client("c1"), client("c2"), database("db")),
                List.of(edge("e1", "c1", "c2"), edge("e2", "c2", "db")));

        assertErrors(result, tuple("CLIENT_HAS_INPUT", "c2", null));
    }

    @Test
    void databaseWithOutgoingEdgeIsRejected() {
        SimulationResult result = run(List.of(client("c"), database("db"), database("db2")),
                List.of(edge("e1", "c", "db"), edge("e2", "db", "db2")));

        assertErrors(result, tuple("DATABASE_HAS_OUTPUT", "db", null));
    }

    @Test
    void cacheWithoutDownstreamIsRejected() {
        assertErrors(run(List.of(client("c"), cache("cache")), List.of(edge("e1", "c", "cache"))),
                tuple("CACHE_DOWNSTREAM_COUNT", "cache", null));
    }

    @Test
    void cacheWithTwoDownstreamsIsRejected() {
        SimulationResult result = run(List.of(client("c"), cache("cache"), database("a"), database("b")),
                List.of(edge("e1", "c", "cache"), edge("e2", "cache", "a"), edge("e3", "cache", "b")));

        assertErrors(result, tuple("CACHE_DOWNSTREAM_COUNT", "cache", null));
        assertThat(result.errors().getFirst().message()).contains("2");
    }

    @Test
    void clientWithoutDownstreamIsRejected() {
        assertErrors(run(List.of(client("c")), List.of()), tuple("NO_DOWNSTREAM", "c", null));
    }

    @Test
    void loadBalancerWithoutDownstreamIsRejected() {
        assertErrors(run(List.of(client("c"), loadBalancer("lb")), List.of(edge("e1", "c", "lb"))),
                tuple("NO_DOWNSTREAM", "lb", null));
    }

    @Test
    void serviceMayBeAnEndpoint() {
        assertThat(run(List.of(client("c"), service("s")), List.of(edge("e1", "c", "s"))).valid()).isTrue();
    }

    @Test
    void edgeToUnknownNodeIsRejected() {
        SimulationResult result = run(List.of(client("c"), database("db")),
                List.of(edge("e1", "c", "db"), edge("e2", "c", "ghost"), edge("e3", "ghost", "phantom")));

        assertErrors(result, tuple("UNKNOWN_NODE", null, "e2"), tuple("UNKNOWN_NODE", null, "e3"));
        assertThat(result.errors().getLast().message()).contains("ghost", "phantom");
    }

    @Test
    void edgeToUnknownNodeStillCountsAsTheSourcesDownstream() {
        // 畫布上 cache 有一條出邊，不能再多報「目前有 0 個下游」
        SimulationResult result = run(List.of(client("c"), cache("cache")),
                List.of(edge("e1", "c", "cache"), edge("e2", "cache", "ghost")));

        assertErrors(result, tuple("UNKNOWN_NODE", null, "e2"));
    }

    @Test
    void edgeFromUnknownNodeStillCountsAsTheTargetsUpstream() {
        SimulationResult result = run(List.of(client("c"), database("db")),
                List.of(edge("e1", "c", "db"), edge("e2", "ghost", "c")));

        assertErrors(result, tuple("CLIENT_HAS_INPUT", "c", null), tuple("UNKNOWN_NODE", null, "e2"));
    }

    @Test
    void largeNumbersAreShownAsIs() {
        SimulationResult result = run(List.of(new ClientNode("c", "c", NodeHealth.HEALTHY, -1e20, 0.9),
                database("db")), List.of(edge("e1", "c", "db")));

        assertThat(result.errors().getFirst().message()).contains("-1.0E20").doesNotContain("9223372036854775808");
    }

    @Test
    void duplicateEdgeIsRejected() {
        SimulationResult result = run(List.of(client("c"), database("db")),
                List.of(edge("e1", "c", "db"), edge("e2", "c", "db")));

        assertErrors(result, tuple("DUPLICATE_EDGE", null, "e2"));
    }

    @Test
    void oppositeDirectionIsNotADuplicateButACycle() {
        SimulationResult result = run(List.of(client("c"), service("a"), service("b")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "b"), edge("e3", "b", "a")));

        assertThat(result.errors()).extracting(ValidationError::code).containsOnly("CYCLE_DETECTED");
    }

    @Test
    void zeroWeightIsRejectedOnTheEdge() {
        SimulationResult result = run(List.of(client("c"), loadBalancer("lb"), database("a"), database("b")),
                List.of(edge("e1", "c", "lb"), edge("e2", "lb", "a"), new Edge("e3", "lb", "b", 0, 1, 1)));

        assertErrors(result, tuple("INVALID_PARAM", null, "e3"));
        assertThat(result.errors().getFirst().message()).contains("weight");
    }

    @Test
    void everyErrorIsReportedInNodeThenEdgeOrder() {
        SimulationResult result = run(List.of(client("c"), cache("cache"), database("db")),
                List.of(edge("e1", "c", "cache"), edge("e2", "db", "cache"), edge("e3", "c", "cache")));

        assertErrors(result,
                tuple("CACHE_DOWNSTREAM_COUNT", "cache", null),
                tuple("DATABASE_HAS_OUTPUT", "db", null),
                tuple("DUPLICATE_EDGE", null, "e3"));
    }

    @Test
    void messagesUseNodeNames() {
        SimulationResult result = run(
                List.of(client("c"), new CacheNode("cache", "Redis", NodeHealth.HEALTHY, CAPACITY, 0.8)),
                List.of(edge("e1", "c", "cache")));

        assertThat(result.errors().getFirst().message()).contains("「Redis」");
    }

    @Test
    void duplicateNodeIdIsMalformed() {
        assertThatThrownBy(() -> run(List.of(client("c"), service("x"), database("x")),
                List.of(edge("e1", "c", "x"))))
                .isInstanceOf(TopologyFormatException.class)
                .hasMessageContaining("x");
    }

    @Test
    void duplicateEdgeIdIsMalformed() {
        assertThatThrownBy(() -> run(List.of(client("c"), service("s"), database("db")),
                List.of(edge("e1", "c", "s"), edge("e1", "s", "db"))))
                .isInstanceOf(TopologyFormatException.class)
                .hasMessageContaining("e1");
    }
}
