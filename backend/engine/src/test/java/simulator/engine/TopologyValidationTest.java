package simulator.engine;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

/** 拓撲不合法時，simulate() 丟 IllegalArgumentException（#8 會改成回傳驗證錯誤）。 */
class TopologyValidationTest {

    private static final CapacityParams CAPACITY = new CapacityParams(1, 100, 10);

    private final Simulator simulator = new SteadyStateSimulator();

    private static ClientNode client(String id) {
        return new ClientNode(id, id, NodeHealth.HEALTHY, 100, 0.9);
    }

    private static ServiceNode service(String id) {
        return new ServiceNode(id, id, NodeHealth.HEALTHY, CAPACITY, CallMode.SEQUENTIAL);
    }

    private static DatabaseNode database(String id) {
        return new DatabaseNode(id, id, NodeHealth.HEALTHY, CAPACITY);
    }

    private static Edge edge(String id, String source, String target) {
        return new Edge(id, source, target, 1, 1, 1);
    }

    private void assertRejected(List<Node> nodes, List<Edge> edges, String messagePart) {
        assertThatThrownBy(() -> simulator.simulate(new Topology(nodes, edges)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining(messagePart);
    }

    @Test
    void edgeFromUnknownNodeIsRejected() {
        assertRejected(List.of(database("db")), List.of(edge("e1", "ghost", "db")), "e1");
    }

    @Test
    void edgeToUnknownNodeIsRejected() {
        assertRejected(List.of(client("c")), List.of(edge("e1", "c", "ghost")), "e1");
    }

    @Test
    void duplicateNodeIdIsRejected() {
        assertRejected(List.of(client("c"), service("x"), database("x")),
                List.of(edge("e1", "c", "x")), "x");
    }

    @Test
    void duplicateEdgeIdIsRejected() {
        assertRejected(List.of(client("c"), service("s"), database("db")),
                List.of(edge("e1", "c", "s"), edge("e1", "s", "db")), "e1");
    }

    @Test
    void databaseWithOutgoingEdgeIsRejected() {
        assertRejected(List.of(client("c"), database("db"), database("db2")),
                List.of(edge("e1", "c", "db"), edge("e2", "db", "db2")), "db");
    }

    @Test
    void clientWithIncomingEdgeIsRejected() {
        assertRejected(List.of(client("c1"), client("c2"), database("db")),
                List.of(edge("e1", "c1", "c2"), edge("e2", "c2", "db")), "c2");
    }

    @Test
    void clientWhoseEdgeWeightsSumToZeroIsRejected() {
        assertRejected(List.of(client("c"), database("db")),
                List.of(new Edge("e1", "c", "db", 0, 1, 1)), "c");
    }

    @Test
    void loadBalancerWhoseEdgeWeightsSumToZeroIsRejected() {
        assertRejected(List.of(client("c"), new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, CAPACITY),
                        database("db")),
                List.of(edge("e1", "c", "lb"), new Edge("e2", "lb", "db", 0, 1, 1)), "lb");
    }

    @Test
    void cycleIsRejected() {
        assertRejected(List.of(client("c"), service("a"), service("b")),
                List.of(edge("e1", "c", "a"), edge("e2", "a", "b"), edge("e3", "b", "a")), "cycle");
    }
}
