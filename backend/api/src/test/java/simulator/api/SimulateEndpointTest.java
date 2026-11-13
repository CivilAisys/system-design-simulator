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
import java.nio.file.Files;
import java.nio.file.Path;
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

    private static final List<String> NODE_FIELDS = List.of("arrivalRps", "throughputRps", "droppedRps",
            "successRps", "endToEndMs", "capacityRps", "utilization", "avgQueueMs", "avgLatencyMs", "status");
    private static final List<String> SERVER_FIELDS = List.of("capacityRps", "utilization", "avgQueueMs",
            "avgLatencyMs", "status");

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    @Test
    void simulatesBasicWebAppExample() throws Exception {
        // 前端「範例」選單的「基本 Web App」：Client → LB → Service → Cache → Database
        byte[] example = Files.readAllBytes(basicWebAppExample());
        JsonNode body = simulate(example);

        assertThat(fieldNames(body)).containsExactlyInAnyOrder("valid", "errors", "nodes", "edges", "summary");
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
        assertThat(fieldNames(summary)).containsExactlyInAnyOrder("offeredRps", "successRps", "dropRate",
                "avgEndToEndMs", "bottleneckNodeId");
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

    // Gradle 會用系統屬性傳路徑；直接在 IDE 跑 JUnit 時沒有這個屬性，退回相對於 api 模組的路徑
    private static Path basicWebAppExample() {
        String configured = System.getProperty("example.basic-web-app");
        Path path = Path.of(configured != null ? configured : "../../frontend/src/examples/basic-web-app.json");
        assertThat(path)
                .as("找不到內建範例檔 %s：用 Gradle 執行，或把工作目錄設成 backend/api", path.toAbsolutePath())
                .isRegularFile();
        return path;
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
                // 超出 32 位元整數：Jackson 只給得出欄位，給不出預期的型別
                Arguments.of("/nodes/1/params/instances", "3000000000", "nodes[1].params.instances"),
                Arguments.of("/nodes/0/type", "1",
                        "nodes[0].type, expected one of [CLIENT, LOAD_BALANCER, SERVICE, CACHE, DATABASE]"),
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
