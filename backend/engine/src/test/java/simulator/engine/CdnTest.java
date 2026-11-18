package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** CDN 的多個下游（spec 3.3）：沒命中的 read 和全部 write 依邊的 weight 分配，同 LB。 */
class CdnTest {

    private static final double EPS = 1e-6;
    private static final CapacityParams AMPLE = new CapacityParams(1, 10_000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** Client（1000 rps、read 90%）→ CDN（命中 50%）→ a（weight 3）、b（weight 1）。 */
    private SimulationResult run(CapacityParams b) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new CdnNode("cdn", "Edge", NodeHealth.HEALTHY, AMPLE, 0.5),
                        new ObjectStorageNode("a", "Media", NodeHealth.HEALTHY, new CapacityParams(1, 10_000, 10)),
                        new ObjectStorageNode("b", "Uploads", NodeHealth.HEALTHY, b)),
                List.of(
                        new Edge("e1", "client", "cdn", 1, 1, 0),
                        new Edge("e2", "cdn", "a", 3, 1, 0),
                        new Edge("e3", "cdn", "b", 1, 1, 0))));
    }

    @Test
    void missesAndWritesSplitByWeight() {
        SimulationResult result = run(new CapacityParams(1, 10_000, 20));

        // read miss 450、write 100，依 3:1 分配
        assertThat(result.edges().get("e2").rps().read()).isCloseTo(337.5, within(EPS));
        assertThat(result.edges().get("e2").rps().write()).isCloseTo(75, within(EPS));
        assertThat(result.edges().get("e3").rps().read()).isCloseTo(112.5, within(EPS));
        assertThat(result.edges().get("e3").rps().write()).isCloseTo(25, within(EPS));
    }

    @Test
    void latencyIsWeightedByDownstream() {
        SimulationResult result = run(new CapacityParams(1, 10_000, 20));
        double cdn = result.nodes().get("cdn").avgLatencyMs();
        double a = result.nodes().get("a").avgLatencyMs();
        double b = result.nodes().get("b").avgLatencyMs();

        EndToEndLatency read = result.nodes().get("client").endToEndMs().read();
        assertThat(read.ms()).isCloseTo(cdn + 0.5 * (0.75 * a + 0.25 * b), within(EPS));
        assertThat(read.approximate()).isFalse();
        assertThat(result.nodes().get("client").endToEndMs().write().ms())
                .isCloseTo(cdn + 0.75 * a + 0.25 * b, within(EPS));
    }

    @Test
    void successIsWeightedByDownstream() {
        // b 容量 50：收到 112.5 + 25 = 137.5，只處理 50
        SimulationResult result = run(new CapacityParams(1, 1, 20));
        double passB = 50 / 137.5;

        double read = 900 * (0.5 + 0.5 * (0.75 + 0.25 * passB));
        double write = 100 * (0.75 + 0.25 * passB);
        assertThat(result.nodes().get("client").successRps()).isCloseTo(read + write, within(EPS));
    }

    @Test
    void singleDownstreamIgnoresItsWeight() {
        List<Node> nodes = List.of(
                new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                new CdnNode("cdn", "Edge", NodeHealth.HEALTHY, AMPLE, 0.5),
                new ObjectStorageNode("a", "Media", NodeHealth.HEALTHY, AMPLE));
        SimulationResult one = simulator.simulate(new Topology(nodes,
                List.of(new Edge("e1", "client", "cdn", 1, 1, 0), new Edge("e2", "cdn", "a", 1, 1, 0))));
        SimulationResult five = simulator.simulate(new Topology(nodes,
                List.of(new Edge("e1", "client", "cdn", 1, 1, 0), new Edge("e2", "cdn", "a", 5, 1, 0))));

        assertThat(five).isEqualTo(one);
        assertThat(one.edges().get("e2").rps().read()).isCloseTo(450, within(EPS));
    }
}
