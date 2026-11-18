package simulator.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
class SimulateEndpointTest {

    private static final List<String> NODE_FIELDS = List.of("arrivalRps", "throughputRps", "droppedRps", "rejectedRps",
            "successRps", "endToEndMs", "capacityRps", "utilization", "avgQueueMs", "avgLatencyMs", "status",
            "hotSpot", "warnings");
    private static final List<String> SERVER_FIELDS = List.of("capacityRps", "utilization", "avgQueueMs",
            "avgLatencyMs", "status");

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    @Test
    void simulatesBasicWebApp() throws Exception {
        // 基本 Web App：Client → LB → Service → Cache → Database
        byte[] scenario = readScenario("basic-web-app.json");
        JsonNode body = simulate(scenario);

        assertThat(fieldNames(body)).containsExactlyInAnyOrder("valid", "errors", "nodes", "edges", "summary",
                "storage");
        assertThat(body.get("valid").asBoolean()).isTrue();
        assertThat(body.get("errors")).isEmpty();

        JsonNode nodes = body.get("nodes");
        assertThat(fieldNames(nodes)).containsExactly("client-1", "lb-1", "svc-1", "cache-1", "db-1");
        for (JsonNode node : nodes) {
            assertThat(fieldNames(node)).containsExactlyInAnyOrderElementsOf(NODE_FIELDS);
            assertThat(fieldNames(node.get("arrivalRps"))).containsExactlyInAnyOrder("read", "write");
        }

        JsonNode client = nodes.get("client-1");
        assertRates(client.get("arrivalRps"), 900, 100);
        assertThat(client.get("throughputRps").asDouble()).isEqualTo(1000);
        assertThat(client.get("droppedRps").asDouble()).isZero();
        assertThat(client.get("successRps").asDouble()).isEqualTo(1000);
        for (String field : SERVER_FIELDS) {
            assertThat(client.get(field).isNull()).as("client %s", field).isTrue();
        }
        // 數值由 engine 的 EndToEndLatencyTest 驗算，這裡只確認 JSON 形狀
        assertThat(fieldNames(client.get("endToEndMs"))).containsExactlyInAnyOrder("read", "write");
        for (String requestClass : List.of("read", "write")) {
            JsonNode latency = client.at("/endToEndMs/" + requestClass);
            assertThat(fieldNames(latency))
                    .containsExactlyInAnyOrder("ms", "approximate", "overloadedNodeIds", "undefinedReason");
            assertThat(latency.get("ms").isNumber()).isTrue();
            assertThat(latency.get("approximate").asBoolean()).isFalse();
            assertThat(latency.get("overloadedNodeIds")).isEmpty();
            assertThat(latency.get("undefinedReason").isNull()).isTrue();
        }

        // 容量 = instances × concurrency / serviceTimeMs；Cache 只把 read miss（20%）和 write 往下送
        assertServer(nodes.get("lb-1"), 900, 100, 1_000_000, 0.001);
        assertServer(nodes.get("svc-1"), 900, 100, 8_000, 0.125);
        assertServer(nodes.get("cache-1"), 900, 100, 100_000, 0.01);
        assertServer(nodes.get("db-1"), 180, 100, 10_000, 0.028);
        assertThat(nodes.at("/svc-1/avgLatencyMs").asDouble()).isCloseTo(50, within(1e-6));

        JsonNode edges = body.get("edges");
        assertThat(fieldNames(edges)).containsExactly("e1", "e2", "e3", "e4");
        for (String id : List.of("e1", "e2", "e3")) {
            assertRates(edges.at("/" + id + "/rps"), 900, 100);
        }
        assertRates(edges.at("/e4/rps"), 180, 100);

        JsonNode summary = body.get("summary");
        assertThat(fieldNames(summary)).containsExactlyInAnyOrder("offeredRps", "successRps", "rejectedRps",
                "dropRate", "avgEndToEndMs", "bottleneckNodeId", "bandwidth", "cdnOffloadBytesPerSec");
        assertThat(summary.get("offeredRps").asDouble()).isEqualTo(1000);
        assertThat(summary.get("successRps").asDouble()).isEqualTo(1000);
        assertThat(summary.get("dropRate").asDouble()).isZero();
        // 只有一個 Client 時等於該 Client 的延遲（加權平均會有浮點誤差，ms 用容差比對）
        for (String requestClass : List.of("read", "write")) {
            ObjectNode average = summary.at("/avgEndToEndMs/" + requestClass).deepCopy();
            ObjectNode own = client.at("/endToEndMs/" + requestClass).deepCopy();
            assertThat(average.remove("ms").asDouble()).isCloseTo(own.remove("ms").asDouble(), within(1e-9));
            assertThat(average).isEqualTo(own);
        }
        assertThat(summary.get("bottleneckNodeId").asText()).isEqualTo("svc-1");
    }

    // 「過載」情境：一載入就有過載的瓶頸和丟棄
    @Test
    void overloadHasOverloadedBottleneck() throws Exception {
        JsonNode body = simulate(readScenario("overload.json"));

        String bottleneck = body.at("/summary/bottleneckNodeId").asText();
        assertThat(body.at("/nodes/" + bottleneck + "/status").asText()).isEqualTo("OVERLOADED");
        assertThat(body.at("/summary/dropRate").asDouble()).isPositive();
        // read 的 Cache miss 和 write 都會走到過載的 DB，兩種請求的延遲都無定義
        assertThat(body.at("/summary/avgEndToEndMs/read/ms").isNull()).isTrue();
        assertThat(body.at("/summary/avgEndToEndMs/write/ms").isNull()).isTrue();
    }

    // 「Fan-out」情境：切到 PARALLEL 時端到端延遲變短，並標示近似
    @Test
    void fanOutIsApproximateWhenParallel() throws Exception {
        ObjectNode scenario = (ObjectNode) mapper.readTree(readScenario("fan-out.json"));
        double sequential = simulate(mapper.writeValueAsBytes(scenario)).at("/summary/avgEndToEndMs/read/ms").asDouble();
        for (JsonNode node : scenario.get("nodes")) {
            if (node.get("name").asText().equals("Gateway")) {
                ((ObjectNode) node.get("params")).put("callMode", "PARALLEL");
            }
        }

        JsonNode parallel = simulate(mapper.writeValueAsBytes(scenario)).at("/summary/avgEndToEndMs/read");
        assertThat(parallel.get("approximate").asBoolean()).isTrue();
        assertThat(parallel.get("ms").asDouble()).isLessThan(sequential);
    }

    // 「CDN」情境：CDN 擋掉大部分 read，origin 負載低；hitRatio 降到 0 時 origin 過載
    @Test
    void cdnShieldsOrigin() throws Exception {
        ObjectNode scenario = (ObjectNode) mapper.readTree(readScenario("cdn.json"));
        JsonNode shielded = simulate(mapper.writeValueAsBytes(scenario));
        // read 19000 只有 5% miss 往下送，write 1000 全部穿透；Web API 容量 2 × 200 / 50ms = 8000
        assertRates(shielded.at("/nodes/svc-1/arrivalRps"), 950, 1000);
        assertThat(shielded.at("/nodes/svc-1/status").asText()).isEqualTo("OK");
        // 每個 read 回應 100 KB：CDN 命中的 95% 不必從 origin 送出
        assertThat(shielded.at("/summary/bandwidth/egressBytesPerSec").asDouble())
                .isCloseTo(19_000 * 100_000.0, within(1e-3));
        assertThat(shielded.at("/summary/cdnOffloadBytesPerSec").asDouble())
                .isCloseTo(19_000 * 0.95 * 100_000, within(1e-3));

        set(scenario, "/nodes/1/params/hitRatio", mapper.getNodeFactory().numberNode(0));
        JsonNode unshielded = simulate(mapper.writeValueAsBytes(scenario));
        assertRates(unshielded.at("/nodes/svc-1/arrivalRps"), 19000, 1000);
        assertThat(unshielded.at("/nodes/svc-1/status").asText()).isEqualTo("OVERLOADED");
        assertThat(unshielded.at("/summary/cdnOffloadBytesPerSec").asDouble()).isZero();
    }

    // 「Rate Limiter」情境：限流讓原本會過載的 API 回到穩態，拒絕的部分算進丟棄率
    @Test
    void rateLimiterProtectsBackend() throws Exception {
        ObjectNode scenario = (ObjectNode) mapper.readTree(readScenario("rate-limiter.json"));
        JsonNode limited = simulate(mapper.writeValueAsBytes(scenario));
        assertThat(limited.at("/nodes/limiter-1/status").asText()).isEqualTo("LIMITING");
        assertThat(limited.at("/nodes/limiter-1/rejectedRps").asDouble()).isCloseTo(6000, within(1e-6));
        assertThat(limited.at("/nodes/svc-1/status").asText()).isEqualTo("WARN");
        assertThat(limited.at("/summary/rejectedRps").asDouble()).isCloseTo(6000, within(1e-6));
        assertThat(limited.at("/summary/dropRate").asDouble()).isCloseTo(0.5, within(1e-9));
        assertThat(limited.at("/summary/bottleneckNodeId").asText()).isEqualTo("svc-1");

        set(scenario, "/nodes/1/params/limitRps", mapper.getNodeFactory().numberNode(1e12));
        JsonNode unlimited = simulate(mapper.writeValueAsBytes(scenario));
        assertThat(unlimited.at("/nodes/limiter-1/status").asText()).isEqualTo("NOT_LIMITING");
        assertThat(unlimited.at("/nodes/svc-1/status").asText()).isEqualTo("OVERLOADED");
    }

    // 「External API」情境：第三方的固定延遲拖慢結帳，超過配額的部分被拒絕
    @Test
    void externalApiIsSlowAndOverQuota() throws Exception {
        JsonNode body = simulate(readScenario("external-api.json"));

        assertThat(body.at("/nodes/ext-1/status").asText()).isEqualTo("OVER_QUOTA");
        assertThat(body.at("/nodes/ext-1/rejectedRps").asDouble()).isCloseTo(500, within(1e-6));
        assertThat(body.at("/summary/dropRate").asDouble()).isCloseTo(1.0 / 3, within(1e-9));
        // 端到端延遲大半來自 External API：來回 2 × 20ms 加上它的 300ms
        assertThat(body.at("/summary/avgEndToEndMs/write/ms").asDouble()).isGreaterThan(340);
        assertThat(body.at("/summary/bottleneckNodeId").asText()).isNotEqualTo("ext-1");
    }

    // 「Redis Cluster 熱點 key」情境：最熱的那台過載，其他兩台還很閒；沒有熱點時撐得住
    @Test
    void redisClusterHasOneHotInstance() throws Exception {
        ObjectNode scenario = (ObjectNode) mapper.readTree(readScenario("redis-cluster.json"));
        JsonNode hot = simulate(mapper.writeValueAsBytes(scenario));
        // 250,000 × 0.5 = 125,000 > 每台的 100,000；其他兩台共 125,000，ρ 0.625
        assertThat(fieldNames(hot.at("/nodes/cache-1/hotSpot"))).containsExactlyInAnyOrder("hottest", "others");
        assertThat(hot.at("/nodes/cache-1/hotSpot/hottest/status").asText()).isEqualTo("OVERLOADED");
        assertThat(hot.at("/nodes/cache-1/hotSpot/others/status").asText()).isEqualTo("OK");
        assertThat(hot.at("/nodes/cache-1/hotSpot/others/utilization").asDouble()).isCloseTo(0.625, within(1e-9));
        assertThat(hot.at("/nodes/cache-1/capacityRps").asDouble()).isCloseTo(300_000, within(1e-6));
        assertThat(hot.at("/summary/bottleneckNodeId").asText()).isEqualTo("cache-1");

        remove(scenario, "/nodes/2/params/hotShare");
        JsonNode even = simulate(mapper.writeValueAsBytes(scenario));
        assertThat(even.at("/nodes/cache-1/hotSpot").isNull()).isTrue();
        assertThat(even.at("/summary/dropRate").asDouble()).isZero();
    }

    // 「Read Replica」情境：replica 分擔 read，但每個 replica 都要套用全部的 write
    @Test
    void readReplicaSplitsReadsButEveryReplicaAppliesAllWrites() throws Exception {
        JsonNode body = simulate(readScenario("read-replica.json"));

        assertRates(body.at("/nodes/db-1/arrivalRps"), 0, 1200);
        for (String replica : List.of("replica-1", "replica-2")) {
            assertRates(body.at("/nodes/" + replica + "/arrivalRps"), 5400, 1200);
            assertThat(body.at("/nodes/" + replica + "/utilization").asDouble()).isCloseTo(0.66, within(1e-9));
            assertThat(body.at("/nodes/" + replica + "/warnings").isEmpty()).isTrue();
        }
        assertThat(body.at("/summary/dropRate").asDouble()).isZero();
    }

    // 「Message Queue 削峰」情境：worker 處理不完時積壓在 queue 裡，使用者的請求照樣成功、延遲很短
    @Test
    void messageQueueBuildsBacklogWithoutFailures() throws Exception {
        JsonNode body = simulate(readScenario("message-queue.json"));

        // worker 容量 2 × 50 / 50ms = 2,000，收到 3,000：每秒積壓 1,000，不算丟棄
        assertThat(body.at("/edges/e3/backlogRps").asDouble()).isCloseTo(1000, within(1e-6));
        assertThat(body.at("/nodes/svc-2/droppedRps").asDouble()).isCloseTo(0, within(1e-6));
        assertThat(body.at("/nodes/svc-2/warnings/0").asText()).isEqualTo("BACKLOG");
        assertThat(body.at("/nodes/db-1/arrivalRps/write").asDouble()).isCloseTo(2000, within(1e-6));
        assertThat(body.at("/summary/dropRate").asDouble()).isZero();
        // 使用者只等到 ack：API 50ms 加上 MQ，遠低於 worker 的路徑
        assertThat(body.at("/summary/avgEndToEndMs/write/ms").asDouble()).isLessThan(60);
    }

    // 測試用的情境拓撲，在 src/test/resources/scenarios
    private byte[] readScenario(String fileName) throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/scenarios/" + fileName)) {
            assertThat(in).as("找不到情境 %s", fileName).isNotNull();
            return in.readAllBytes();
        }
    }

    private static void assertServer(JsonNode node, double read, double write, double capacity, double utilization) {
        assertRates(node.get("arrivalRps"), read, write);
        assertThat(node.get("throughputRps").asDouble()).isCloseTo(read + write, within(1e-6));
        assertThat(node.get("droppedRps").asDouble()).isZero();
        assertThat(node.get("capacityRps").asDouble()).isCloseTo(capacity, within(1e-6));
        assertThat(node.get("utilization").asDouble()).isCloseTo(utilization, within(1e-9));
        assertThat(node.get("avgQueueMs").isNumber()).isTrue();
        assertThat(node.get("avgLatencyMs").isNumber()).isTrue();
        assertThat(node.get("status").asText()).isEqualTo("OK");
        // 只有 Client 才有
        assertThat(node.get("successRps").isNull()).isTrue();
        assertThat(node.get("endToEndMs").isNull()).isTrue();
    }

    private static void assertRates(JsonNode rates, double read, double write) {
        assertThat(rates.get("read").asDouble()).isCloseTo(read, within(1e-6));
        assertThat(rates.get("write").asDouble()).isCloseTo(write, within(1e-6));
    }

    @Test
    void missingParamIsBadRequest() throws Exception {
        String topology = """
                { "version": 1,
                  "nodes": [ { "id": "c", "type": "CLIENT", "name": "Users", "params": { "rps": 10 } } ],
                  "edges": [] }
                """;

        mvc.perform(post("/api/v1/simulate").contentType(MediaType.APPLICATION_JSON).content(topology))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/version", "/nodes", "/edges", "/nodes/0/id", "/nodes/0/type", "/nodes/0/name",
            "/nodes/0/params", "/edges/0/id", "/edges/0/source", "/edges/0/target"})
    void missingRequiredFieldIsBadRequest(String pointer) throws Exception {
        ObjectNode topology = straightTopology();
        remove(topology, pointer);

        postTopology(topology)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(startsWith("Missing required field ")));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 2, 99})
    void unsupportedVersionIsBadRequest(int version) throws Exception {
        ObjectNode topology = straightTopology();
        topology.put("version", version);

        postTopology(topology)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail")
                        .value("Unsupported version " + version + ", only version 1 is supported"));
    }

    // 指定欄位換成錯誤型別的值，Jackson 預設會自動轉換或截斷，這裡要全部回 400
    static Stream<Arguments> wrongTypes() {
        return Stream.of(
                Arguments.of("/version", "\"1\"", "version, expected an integer"),
                Arguments.of("/version", "1.5", "version, expected an integer"),
                Arguments.of("/nodes/0/params/rps", "\"1000\"", "nodes[0].params.rps, expected a number"),
                Arguments.of("/nodes/0/params/rps", "true", "nodes[0].params.rps, expected a number"),
                Arguments.of("/nodes/0/params/readRatio", "false", "nodes[0].params.readRatio, expected a number"),
                Arguments.of("/nodes/1/params/serviceTimeMs", "\"50\"",
                        "nodes[1].params.serviceTimeMs, expected a number"),
                Arguments.of("/nodes/1/params/instances", "2.7", "nodes[1].params.instances, expected an integer"),
                Arguments.of("/nodes/1/params/instances", "\"2\"", "nodes[1].params.instances, expected an integer"),
                Arguments.of("/nodes/1/params/concurrency", "true",
                        "nodes[1].params.concurrency, expected an integer"),
                Arguments.of("/nodes/2/params/concurrency", "100.5",
                        "nodes[2].params.concurrency, expected an integer"),
                Arguments.of("/edges/0/weight", "\"1\"", "edges[0].weight, expected a number"),
                Arguments.of("/edges/0/latencyMs", "true", "edges[0].latencyMs, expected a number"),
                Arguments.of("/edges/1/callsPerRequest", "2.5", "edges[1].callsPerRequest, expected an integer"),
                Arguments.of("/edges/1/requestClass", "\"BOTH\"",
                        "edges[1].requestClass, expected one of [ALL, READ, WRITE]"),
                // 超出 32 位元整數：Jackson 只給得出欄位，給不出預期的型別
                Arguments.of("/nodes/1/params/instances", "3000000000", "nodes[1].params.instances"),
                Arguments.of("/nodes/0/type", "1",
                        "nodes[0].type, expected one of [CLIENT, LOAD_BALANCER, SERVICE, CACHE, CDN, DATABASE, OBJECT_STORAGE, RATE_LIMITER, EXTERNAL_API, READ_REPLICA, MESSAGE_QUEUE]"),
                Arguments.of("/nodes/0/name", "123", "nodes[0].name, expected a string"),
                Arguments.of("/nodes", "{}", "nodes, expected an array"));
    }

    @ParameterizedTest
    @MethodSource("wrongTypes")
    void wrongTypeIsBadRequest(String pointer, String json, String detail) throws Exception {
        ObjectNode topology = straightTopology();
        set(topology, pointer, mapper.readTree(json));

        postTopology(topology)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Invalid value for " + detail));
    }

    @Test
    void malformedJsonIsBadRequest() throws Exception {
        mvc.perform(post("/api/v1/simulate").contentType(MediaType.APPLICATION_JSON).content("{ \"version\": 1,"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Malformed JSON"));
    }

    @Test
    void missingEdgeFieldsDefaultToOne() throws Exception {
        ObjectNode topology = straightTopology();
        for (JsonNode edge : topology.get("edges")) {
            ((ObjectNode) edge).remove(List.of("weight", "callsPerRequest", "latencyMs"));
        }

        JsonNode body = mapper.readTree(postTopology(topology)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/edges/e1/rps/read").asDouble()).isCloseTo(900, within(1e-6));
        assertThat(body.at("/edges/e2/rps/read").asDouble()).isCloseTo(900, within(1e-6));
        assertThat(body.at("/nodes/db-1/arrivalRps/read").asDouble()).isCloseTo(900, within(1e-6));
    }

    @Test
    void omittedTransferSizesUseDefaults() throws Exception {
        // straight-topology.json 的 Client 沒有 readResponseBytes、writeRequestBytes：用預設的 10000、1000
        JsonNode body = mapper.readTree(postTopology(straightTopology())
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/summary/bandwidth/egressBytesPerSec").asDouble()).isCloseTo(900 * 10_000, within(1e-6));
        assertThat(body.at("/summary/bandwidth/ingressBytesPerSec").asDouble()).isCloseTo(100 * 1_000, within(1e-6));
        assertThat(body.at("/edges/e1/bandwidth/egressBytesPerSec").asDouble()).isCloseTo(900 * 10_000, within(1e-6));
        assertThat(body.at("/edges/e2/bandwidth").isNull()).isTrue();
    }

    @Test
    void clientTransferSizesSetBandwidth() throws Exception {
        ObjectNode topology = straightTopology();
        set(topology, "/nodes/0/params/readResponseBytes", mapper.getNodeFactory().numberNode(2_000));
        set(topology, "/nodes/0/params/writeRequestBytes", mapper.getNodeFactory().numberNode(500));

        JsonNode body = mapper.readTree(postTopology(topology)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/summary/bandwidth/egressBytesPerSec").asDouble()).isCloseTo(900 * 2_000, within(1e-6));
        assertThat(body.at("/summary/bandwidth/ingressBytesPerSec").asDouble()).isCloseTo(100 * 500, within(1e-6));
        assertThat(body.at("/summary/cdnOffloadBytesPerSec").asDouble()).isZero();
    }

    @Test
    void omittedStorageSizingUsesDefaults() throws Exception {
        // straight-topology.json 的 Database 沒有 bytesPerWrite、retentionDays、diskGbPerShard：1000 bytes、365 天、不估磁碟
        JsonNode body = mapper.readTree(postTopology(straightTopology())
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        JsonNode storage = body.at("/storage/db-1");
        assertThat(fieldNames(body.get("storage"))).containsExactly("db-1");
        assertThat(fieldNames(storage)).containsExactlyInAnyOrder("dailyBytes", "totalBytes", "replicas",
                "totalWithReplicasBytes", "perShardBytes", "daysUntilFull", "fillsDisk", "retentionDays", "diskGbPerShard");
        assertThat(storage.get("dailyBytes").asDouble()).isCloseTo(100 * 1_000 * 86_400.0, within(1e-3));
        assertThat(storage.get("totalBytes").asDouble()).isCloseTo(100 * 1_000 * 86_400.0 * 365, within(1.0));
        assertThat(storage.get("daysUntilFull").isNull()).isTrue();
    }

    @Test
    void storageSizingParamsAreRead() throws Exception {
        ObjectNode topology = straightTopology();
        set(topology, "/nodes/2/params/bytesPerWrite", mapper.getNodeFactory().numberNode(500));
        set(topology, "/nodes/2/params/retentionDays", mapper.getNodeFactory().numberNode(10));
        set(topology, "/nodes/2/params/diskGbPerShard", mapper.getNodeFactory().numberNode(1));

        JsonNode storage = mapper.readTree(postTopology(topology)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).at("/storage/db-1");

        // 100 write/s × 500 bytes × 86,400 = 4.32 GB/天，1 GB 的磁碟不到一天就滿
        assertThat(storage.get("totalBytes").asDouble()).isCloseTo(100 * 500 * 86_400.0 * 10, within(1e-3));
        assertThat(storage.get("daysUntilFull").asDouble()).isCloseTo(1e9 / (100 * 500 * 86_400.0), within(1e-9));
        assertThat(storage.get("fillsDisk").asBoolean()).isTrue();
    }

    @Test
    void hotShareOnCacheReportsHotSpot() throws Exception {
        String topology = """
                { "version": 1,
                  "nodes": [
                    { "id": "c", "type": "CLIENT", "name": "Users", "params": { "rps": 1000, "readRatio": 1 } },
                    { "id": "cache", "type": "CACHE", "name": "Redis",
                      "params": { "instances": 4, "concurrency": 1, "serviceTimeMs": 1, "hitRatio": 1,
                                  "hotShare": 0.4 } },
                    { "id": "db", "type": "DATABASE", "name": "DB",
                      "params": { "instances": 1, "concurrency": 100, "serviceTimeMs": 10 } } ],
                  "edges": [
                    { "id": "e1", "source": "c", "target": "cache" },
                    { "id": "e2", "source": "cache", "target": "db" } ] }
                """;

        JsonNode body = mapper.readTree(mvc.perform(post("/api/v1/simulate")
                        .contentType(MediaType.APPLICATION_JSON).content(topology))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        // 每台容量 1000：最熱那台 400（ρ 0.4），其他 3 台共 600（ρ 0.2）
        JsonNode hottest = body.at("/nodes/cache/hotSpot/hottest");
        assertThat(fieldNames(hottest)).containsExactlyInAnyOrder("arrivalRps", "throughputRps", "droppedRps",
                "utilization", "avgLatencyMs", "status");
        assertThat(hottest.at("/arrivalRps/read").asDouble()).isCloseTo(400, within(1e-6));
        assertThat(body.at("/nodes/cache/hotSpot/others/arrivalRps/read").asDouble()).isCloseTo(600, within(1e-6));
        assertThat(body.at("/nodes/cache/utilization").asDouble()).isCloseTo(0.4, within(1e-9));
        assertThat(body.at("/nodes/db/hotSpot").isNull()).isTrue();
    }

    @Test
    void legacyShardFieldsAreIgnored() throws Exception {
        // 0.6.0 之前的拓撲有 shards、hotShardShare：前端還原時會轉換，後端直接忽略
        ObjectNode topology = straightTopology();
        set(topology, "/nodes/2/params/shards", mapper.getNodeFactory().numberNode(4));
        set(topology, "/nodes/2/params/hotShardShare", mapper.getNodeFactory().numberNode(0.4));

        JsonNode body = mapper.readTree(postTopology(topology)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/nodes/db-1/capacityRps").asDouble()).isCloseTo(10_000, within(1e-6));
        assertThat(body.at("/nodes/db-1/hotSpot").isNull()).isTrue();
    }

    @Test
    void writeOnlyServiceEdgeCarriesOnlyWrites() throws Exception {
        ObjectNode topology = straightTopology();
        set(topology, "/edges/1/requestClass", mapper.getNodeFactory().textNode("WRITE"));

        JsonNode body = mapper.readTree(postTopology(topology)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/edges/e2/rps/read").asDouble()).isZero();
        assertThat(body.at("/edges/e2/rps/write").asDouble()).isCloseTo(100, within(1e-6));
    }

    @Test
    void loadBalancerSplitsByWeight() throws Exception {
        String topology = """
                { "version": 1,
                  "nodes": [
                    { "id": "c", "type": "CLIENT", "name": "Users", "params": { "rps": 1000, "readRatio": 1 } },
                    { "id": "lb", "type": "LOAD_BALANCER", "name": "LB",
                      "params": { "instances": 1, "concurrency": 1000, "serviceTimeMs": 1 } },
                    { "id": "a", "type": "DATABASE", "name": "A",
                      "params": { "instances": 1, "concurrency": 100, "serviceTimeMs": 10 } },
                    { "id": "b", "type": "DATABASE", "name": "B",
                      "params": { "instances": 1, "concurrency": 100, "serviceTimeMs": 10 } } ],
                  "edges": [
                    { "id": "e1", "source": "c", "target": "lb" },
                    { "id": "e2", "source": "lb", "target": "a", "weight": 1 },
                    { "id": "e3", "source": "lb", "target": "b", "weight": 3 } ] }
                """;

        JsonNode body = mapper.readTree(mvc.perform(post("/api/v1/simulate")
                        .contentType(MediaType.APPLICATION_JSON).content(topology))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/nodes/lb/capacityRps").asDouble()).isEqualTo(1_000_000);
        assertThat(body.at("/nodes/a/arrivalRps/read").asDouble()).isCloseTo(250, within(1e-6));
        assertThat(body.at("/nodes/b/arrivalRps/read").asDouble()).isCloseTo(750, within(1e-6));
    }

    @Test
    void cacheSendsReadMissesAndWritesDownstream() throws Exception {
        String topology = """
                { "version": 1,
                  "nodes": [
                    { "id": "c", "type": "CLIENT", "name": "Users", "params": { "rps": 1000, "readRatio": 0.9 } },
                    { "id": "cache", "type": "CACHE", "name": "Redis",
                      "params": { "instances": 1, "concurrency": 1, "serviceTimeMs": 0.01, "hitRatio": 0.8 } },
                    { "id": "db", "type": "DATABASE", "name": "DB",
                      "params": { "instances": 1, "concurrency": 100, "serviceTimeMs": 10 } } ],
                  "edges": [
                    { "id": "e1", "source": "c", "target": "cache" },
                    { "id": "e2", "source": "cache", "target": "db" } ] }
                """;

        JsonNode body = mapper.readTree(mvc.perform(post("/api/v1/simulate")
                        .contentType(MediaType.APPLICATION_JSON).content(topology))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.at("/nodes/cache/capacityRps").asDouble()).isCloseTo(100_000, within(1e-6));
        assertThat(body.at("/nodes/db/arrivalRps/read").asDouble()).isCloseTo(180, within(1e-6));
        assertThat(body.at("/nodes/db/arrivalRps/write").asDouble()).isCloseTo(100, within(1e-6));
    }

    @Test
    void invalidTopologyIsOkWithErrorsAndNoResults() throws Exception {
        // 拓撲有問題是使用者的編輯狀態，不是 HTTP 錯誤（spec 5）
        ObjectNode topology = straightTopology();
        ((ObjectNode) topology.at("/edges/1")).put("source", "ghost");

        JsonNode body = mapper.readTree(postTopology(topology)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.get("valid").asBoolean()).isFalse();
        assertThat(body.get("errors")).hasSize(1);
        JsonNode error = body.at("/errors/0");
        assertThat(fieldNames(error)).containsExactlyInAnyOrder("code", "message", "nodeId", "edgeId");
        assertThat(error.get("code").asText()).isEqualTo("UNKNOWN_NODE");
        assertThat(error.get("edgeId").asText()).isEqualTo("e2");
        assertThat(error.get("nodeId").isNull()).isTrue();
        assertThat(body.get("nodes")).isEmpty();
        assertThat(body.get("edges")).isEmpty();
        assertThat(body.get("summary").isNull()).isTrue();
        assertThat(body.get("storage")).isEmpty();
    }

    @Test
    void duplicateNodeIdIsBadRequest() throws Exception {
        ObjectNode topology = straightTopology();
        ((ObjectNode) topology.at("/nodes/2")).put("id", "svc-1");

        postTopology(topology)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Duplicate node id svc-1"));
    }

    @Test
    void duplicateEdgeIdIsBadRequest() throws Exception {
        ObjectNode topology = straightTopology();
        ((ObjectNode) topology.at("/edges/1")).put("id", "e1");

        postTopology(topology)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Duplicate edge id e1"));
    }

    private ObjectNode straightTopology() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/straight-topology.json")) {
            return (ObjectNode) mapper.readTree(in);
        }
    }

    private static void remove(ObjectNode root, String pointer) {
        int slash = pointer.lastIndexOf('/');
        JsonNode parent = slash == 0 ? root : root.at(pointer.substring(0, slash));
        String field = pointer.substring(slash + 1);
        if (parent instanceof ArrayNode array) {
            array.remove(Integer.parseInt(field));
        } else {
            ((ObjectNode) parent).remove(field);
        }
    }

    private static void set(ObjectNode root, String pointer, JsonNode value) {
        int slash = pointer.lastIndexOf('/');
        JsonNode parent = slash == 0 ? root : root.at(pointer.substring(0, slash));
        ((ObjectNode) parent).set(pointer.substring(slash + 1), value);
    }

    private ResultActions postTopology(JsonNode topology) throws Exception {
        return mvc.perform(post("/api/v1/simulate").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(topology)));
    }

    private JsonNode simulate(byte[] topology) throws Exception {
        String body = mvc.perform(post("/api/v1/simulate").contentType(MediaType.APPLICATION_JSON).content(topology))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(body);
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
