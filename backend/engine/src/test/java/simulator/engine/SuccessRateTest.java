package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** 成功率（spec 4.3.1）。 */
class SuccessRateTest {

    private static final double EPS = 1e-6;

    private final Simulator simulator = new SteadyStateSimulator();

    /** μ = 100，容量 = workers × 100 rps。 */
    private static CapacityParams workers(int workers) {
        return new CapacityParams(1, workers, 10);
    }

    private static CapacityParams roomy() {
        return new CapacityParams(1, 10_000, 1);
    }

    @Test
    void fanOutMultipliesSuccessOfEveryCall() {
        // spec 4.6：DB-A 收到 2000 rps、容量 1800，pass = 0.9；S = 0.9² × 1 = 0.81
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, roomy(), CallMode.SEQUENTIAL),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, workers(18)),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, roomy())),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "a", 1, 2, 1),
                        new Edge("e3", "svc", "b", 1, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isCloseTo(810, within(EPS));
        assertThat(result.summary().successRps()).isCloseTo(810, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(0.19, within(EPS));
    }

    @Test
    void cacheHitsAreNotAffectedByOverloadedDownstream() {
        // DB 收到 read 180 + write 100 = 280、容量 14 × 10 = 140，pass = 0.5
        // read：0.8 + 0.2 × 0.5 = 0.9；write：0.5
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new CacheNode("cache", "Redis", NodeHealth.HEALTHY, roomy(), 0.8),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, new CapacityParams(1, 14, 100))),
                List.of(
                        new Edge("e1", "client", "cache", 1, 1, 1),
                        new Edge("e2", "cache", "db", 1, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isCloseTo(900 * 0.9 + 100 * 0.5, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(1 - 860.0 / 1000, within(EPS));
    }

    @Test
    void loadBalancerAveragesByWeight() {
        // A 收到 250、容量 125，pass = 0.5；S = 0.25 × 0.5 + 0.75 × 1
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 1),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, roomy()),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, new CapacityParams(1, 5, 40)),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, roomy())),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 1),
                        new Edge("e2", "lb", "a", 1, 1, 1),
                        new Edge("e3", "lb", "b", 3, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isCloseTo(875, within(EPS));
    }

    @Test
    void overloadedNodeDropsBeforeCallingDownstream() {
        // Service 收到 1000、容量 500，pass = 0.5；下游 DB 沒有過載
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, workers(5), CallMode.PARALLEL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, roomy())),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "db", 1, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isCloseTo(500, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(0.5, within(EPS));
    }

    @Test
    void summaryAddsUpEveryClient() {
        // 兩個 Client 共用一個 DB：收到 1500、容量 1000，pass = 2/3
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("web", "Web", NodeHealth.HEALTHY, 1000, 0.9),
                        new ClientNode("mobile", "Mobile", NodeHealth.HEALTHY, 500, 0.5),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, workers(10))),
                List.of(
                        new Edge("e1", "web", "db", 1, 1, 1),
                        new Edge("e2", "mobile", "db", 1, 1, 1))));

        assertThat(result.nodes().get("web").successRps()).isCloseTo(1000 * 2.0 / 3, within(EPS));
        assertThat(result.nodes().get("mobile").successRps()).isCloseTo(500 * 2.0 / 3, within(EPS));
        assertThat(result.summary().offeredRps()).isEqualTo(1500);
        assertThat(result.summary().successRps()).isCloseTo(1000, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(1.0 / 3, within(EPS));
    }

    @Test
    void healthyTopologySucceedsCompletely() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ServiceNode("svc", "API", NodeHealth.HEALTHY, roomy(), CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, roomy())),
                List.of(
                        new Edge("e1", "client", "svc", 1, 1, 1),
                        new Edge("e2", "svc", "db", 1, 3, 1))));

        assertThat(result.nodes().get("client").successRps()).isEqualTo(1000);
        assertThat(result.summary().successRps()).isEqualTo(1000);
        assertThat(result.summary().dropRate()).isZero();
        // successRps 只有 Client 有
        assertThat(result.nodes().get("svc").successRps()).isNull();
        assertThat(result.nodes().get("db").successRps()).isNull();
    }

    @Test
    void roundingErrorDoesNotShowUpAsDrops() {
        // 權重 0.1、0.2 的比例加起來是 0.9999999999999999 而不是 1，所有節點都健康時 drop rate 仍要是 0
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, roomy()),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, roomy()),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, roomy())),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 1),
                        new Edge("e2", "lb", "a", 0.1, 1, 1),
                        new Edge("e3", "lb", "b", 0.2, 1, 1))));

        assertThat(result.summary().dropRate()).isZero();
    }

    @Test
    void zeroWeightEdgeToOverloadedNodeDoesNotAffectSuccess() {
        // A 被 other 打到過載（收到 1000、容量 500），但 lb 給 A 的權重是 0，client 的請求不會到 A
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new ClientNode("other", "Other", NodeHealth.HEALTHY, 1000, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, roomy()),
                        new DatabaseNode("a", "A", NodeHealth.HEALTHY, workers(5)),
                        new DatabaseNode("b", "B", NodeHealth.HEALTHY, roomy())),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 1),
                        new Edge("e2", "lb", "a", 0, 1, 1),
                        new Edge("e3", "lb", "b", 1, 1, 1),
                        new Edge("e4", "other", "a", 1, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isCloseTo(1000, within(EPS));
        assertThat(result.nodes().get("other").successRps()).isCloseTo(500, within(EPS));
    }

    @Test
    void clientWithoutDownstreamSucceedsNothing() {
        // 和端到端延遲的 NO_DOWNSTREAM 一致：請求沒有地方送，不算成功
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("web", "Web", NodeHealth.HEALTHY, 1000, 0.9),
                        new ClientNode("draft", "Draft", NodeHealth.HEALTHY, 1000, 0.9),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, roomy())),
                List.of(new Edge("e1", "web", "db", 1, 1, 1))));

        assertThat(result.nodes().get("draft").successRps()).isZero();
        assertThat(result.summary().dropRate()).isCloseTo(0.5, within(EPS));
    }

    @Test
    void loadBalancerWithoutDownstreamSucceedsNothing() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.9),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, roomy())),
                List.of(new Edge("e1", "client", "lb", 1, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isZero();
        assertThat(result.summary().dropRate()).isEqualTo(1);
    }

    @Test
    void noTrafficDropsNothing() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 0, 0.9),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, roomy())),
                List.of(new Edge("e1", "client", "db", 1, 1, 1))));

        assertThat(result.nodes().get("client").successRps()).isZero();
        assertThat(result.summary().successRps()).isZero();
        assertThat(result.summary().dropRate()).isZero();
    }
}
