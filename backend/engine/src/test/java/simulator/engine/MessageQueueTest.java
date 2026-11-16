package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Message Queue（spec 4.2.4）：Client 只等到 ack，consumer 處理不完的訊息留在 queue 裡。 */
class MessageQueueTest {

    private static final double EPS = 1e-6;
    private static final CapacityParams ROOMY = new CapacityParams(1, 10_000, 1);
    private static final CapacityParams BROKER = new CapacityParams(1, 1000, 1);

    private final Simulator simulator = new SteadyStateSimulator();

    /** μ = 100，容量 = workers × 100 rps。 */
    private static CapacityParams workers(int workers) {
        return new CapacityParams(1, workers, 10);
    }

    /**
     * Client（write 100%）→ API ─→ MQ ─→ worker → DB，API 也同步呼叫 DB。
     * worker 的容量 = workerSlots × 100。
     */
    private SimulationResult run(double rps, int workerSlots) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, rps, 0),
                        new ServiceNode("api", "API", NodeHealth.HEALTHY, ROOMY, CallMode.SEQUENTIAL),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, workers(workerSlots),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, ROOMY)),
                List.of(
                        new Edge("e1", "client", "api", 1, 1, 1),
                        new Edge("enqueue", "api", "mq", 1, 1, 2),
                        new Edge("consume", "mq", "worker", 1, 1, 50),
                        new Edge("store", "worker", "db", 1, 1, 50),
                        new Edge("sync", "api", "db", 1, 1, 1))));
    }

    @Test
    void clientLatencyStopsAtTheQueueAck() {
        SimulationResult result = run(1000, 20);
        double api = result.nodes().get("api").avgLatencyMs();
        double mq = result.nodes().get("mq").avgLatencyMs();
        double db = result.nodes().get("db").avgLatencyMs();

        // 1×2 + API + (2×2 + MQ) + (1×2 + DB)：worker 和它到 DB 的路徑都不算
        assertThat(result.summary().avgEndToEndMs().write().ms()).isCloseTo(2 + api + 4 + mq + 2 + db, within(EPS));
    }

    @Test
    void overloadedConsumerBuildsBacklogInsteadOfDropping() {
        // worker 容量 600，收到 1000：處理 600，backlog 每秒 +400，不算丟棄
        SimulationResult result = run(1000, 6);
        NodeResult worker = result.nodes().get("worker");

        assertThat(worker.throughputRps()).isCloseTo(600, within(EPS));
        assertThat(worker.droppedRps()).isCloseTo(0, within(EPS));
        assertThat(worker.warnings()).containsExactly(NodeWarning.BACKLOG);
        assertThat(result.edges().get("consume").backlogRps()).isCloseTo(400, within(EPS));
        // consumer 處理完的照常往下送
        assertThat(result.edges().get("store").rps().write()).isCloseTo(600, within(EPS));
        // 非同步路徑處理不完，不影響 Client 的成功率和延遲
        assertThat(result.summary().dropRate()).isZero();
        assertThat(result.summary().avgEndToEndMs().write().ms()).isNotNull();
    }

    @Test
    void consumerWritesAddToTheSynchronousLoadOnTheDatabase() {
        SimulationResult result = run(1000, 20);

        // 同步路徑 1000 + worker 寫入 1000
        assertThat(result.nodes().get("db").arrivalRps().write()).isCloseTo(2000, within(EPS));
    }

    @Test
    void everyConsumerGroupReceivesAllMessages() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0.5),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER),
                        new ServiceNode("email", "Email", NodeHealth.HEALTHY, ROOMY, CallMode.SEQUENTIAL),
                        new ServiceNode("search", "Search", NodeHealth.HEALTHY, ROOMY, CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e1", "client", "mq", 1, 1, 1),
                        new Edge("g1", "mq", "email", 1, 1, 1),
                        new Edge("g2", "mq", "search", 1, 1, 1))));

        assertThat(result.nodes().get("email").arrivalRps().total()).isCloseTo(1000, within(EPS));
        assertThat(result.nodes().get("search").arrivalRps().total()).isCloseTo(1000, within(EPS));
    }

    @Test
    void overloadedBrokerDropsAndCountsAsFailure() {
        // broker 容量 500，收到 1000：丟掉一半，算進 Client 的失敗率
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, workers(5)),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, ROOMY, CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e1", "client", "mq", 1, 1, 1),
                        new Edge("g1", "mq", "worker", 1, 1, 1))));

        assertThat(result.nodes().get("mq").droppedRps()).isCloseTo(500, within(EPS));
        assertThat(result.summary().dropRate()).isCloseTo(0.5, within(EPS));
    }

    /** Client（write 100%）→ MQ ─→ worker → DB，worker 每則訊息寫 DB callsPerRequest 次。 */
    private SimulationResult consumeIntoDatabase(int workerSlots, int callsPerRequest, int dbSlots) {
        return simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, workers(workerSlots),
                                CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, workers(dbSlots))),
                List.of(
                        new Edge("e1", "client", "mq", 1, 1, 1),
                        new Edge("g1", "mq", "worker", 1, 1, 1),
                        new Edge("store", "worker", "db", 1, callsPerRequest, 1))));
    }

    @Test
    void failuresBehindTheConsumerStayInTheQueue() {
        // worker 處理得完，但它寫入的 DB 容量只有 200：80% 的訊息沒有完整成功，留在 queue 裡
        SimulationResult result = consumeIntoDatabase(100, 1, 2);
        NodeResult worker = result.nodes().get("worker");

        assertThat(result.edges().get("g1").backlogRps()).isCloseTo(800, within(EPS));
        assertThat(worker.droppedRps()).isCloseTo(0, within(EPS));
        assertThat(worker.warnings()).containsExactly(NodeWarning.BACKLOG);
        // DB 照常顯示自己的丟棄
        assertThat(result.nodes().get("db").status()).isEqualTo(Status.OVERLOADED);
        assertThat(result.nodes().get("db").droppedRps()).isCloseTo(800, within(EPS));
        // Client 的成功率只看 broker
        assertThat(result.summary().dropRate()).isZero();
        assertThat(result.summary().avgEndToEndMs().write().ms()).isNotNull();
    }

    @Test
    void overloadedConsumerAndFailingDownstreamBothCountAsBacklog() {
        // worker 容量 600：處理不完的 400 + 處理了但 DB（容量 300）丟掉的 300
        SimulationResult result = consumeIntoDatabase(6, 1, 3);

        assertThat(result.edges().get("g1").backlogRps()).isCloseTo(400 + 300, within(EPS));
        assertThat(result.nodes().get("worker").droppedRps()).isCloseTo(0, within(EPS));
        assertThat(result.nodes().get("worker").warnings()).containsExactly(NodeWarning.BACKLOG);
        assertThat(result.summary().dropRate()).isZero();
    }

    @Test
    void backlogCountsMessagesNotFanOutCalls() {
        // 每則訊息寫 DB 2 次，DB 收到 2000、容量 1000：每次寫入成功率 0.5，兩次都成功的訊息只有 25%
        SimulationResult result = consumeIntoDatabase(100, 2, 10);

        assertThat(result.edges().get("g1").backlogRps()).isCloseTo(1000 * (1 - 0.5 * 0.5), within(EPS));
    }

    @Test
    void healthyConsumerPathHasNoBacklog() {
        SimulationResult result = consumeIntoDatabase(100, 1, 100);

        assertThat(result.edges().get("g1").backlogRps()).isZero();
        assertThat(result.nodes().get("worker").warnings()).isEmpty();
    }

    @Test
    void consumerOnBothPathsDropsOnlyTheSynchronousShare() {
        // worker 同時被 Client 直接呼叫（同步 500）和 MQ 送訊息（非同步 500），容量 600：超過的 400 依比例分
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, ROOMY),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, workers(6), CallMode.SEQUENTIAL)),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 1),
                        new Edge("direct", "lb", "worker", 1, 1, 1),
                        new Edge("enqueue", "lb", "mq", 1, 1, 1),
                        new Edge("g1", "mq", "worker", 1, 1, 1))));
        NodeResult worker = result.nodes().get("worker");

        assertThat(result.edges().get("g1").backlogRps()).isCloseTo(200, within(EPS));
        assertThat(worker.droppedRps()).isCloseTo(200, within(EPS));
        assertThat(worker.warnings()).containsExactly(NodeWarning.BACKLOG);
        // 同步那一半的通過率是 600 / 1000；送進 queue 的一半全部成功
        assertThat(result.summary().successRps()).isCloseTo(500 * 0.6 + 500, within(EPS));
    }

    @Test
    void consumerOnBothPathsQueuesOnlyTheAsynchronousDownstreamFailures() {
        // worker 同時收到同步 500 和 MQ 的 500，處理得完；它寫入的 DB 容量 500、收到 1000，通過率 0.5
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new LoadBalancerNode("lb", "LB", NodeHealth.HEALTHY, ROOMY),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER),
                        new ServiceNode("worker", "Worker", NodeHealth.HEALTHY, ROOMY, CallMode.SEQUENTIAL),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, workers(5))),
                List.of(
                        new Edge("e1", "client", "lb", 1, 1, 1),
                        new Edge("direct", "lb", "worker", 1, 1, 1),
                        new Edge("enqueue", "lb", "mq", 1, 1, 1),
                        new Edge("g1", "mq", "worker", 1, 1, 1),
                        new Edge("store", "worker", "db", 1, 1, 1))));

        assertThat(result.edges().get("g1").backlogRps()).isCloseTo(250, within(EPS));
        assertThat(result.nodes().get("worker").droppedRps()).isCloseTo(0, within(EPS));
        // 同步那一半照常因 DB 失敗；送進 queue 的一半全部算成功
        assertThat(result.summary().successRps()).isCloseTo(500 * 0.5 + 500, within(EPS));
    }

    @Test
    void queueMayOnlyFeedServices() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER),
                        new DatabaseNode("db", "DB", NodeHealth.HEALTHY, ROOMY)),
                List.of(new Edge("e1", "client", "mq", 1, 1, 1), new Edge("g1", "mq", "db", 1, 1, 1))));

        assertThat(result.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .contains(tuple("QUEUE_CONSUMER_TYPE", "mq"));
    }

    @Test
    void queueNeedsAtLeastOneConsumer() {
        SimulationResult result = simulator.simulate(new Topology(
                List.of(
                        new ClientNode("client", "Users", NodeHealth.HEALTHY, 1000, 0),
                        new MessageQueueNode("mq", "Queue", NodeHealth.HEALTHY, BROKER)),
                List.of(new Edge("e1", "client", "mq", 1, 1, 1))));

        assertThat(result.errors()).extracting(ValidationError::code, ValidationError::nodeId)
                .containsExactly(tuple("NO_DOWNSTREAM", "mq"));
    }
}
