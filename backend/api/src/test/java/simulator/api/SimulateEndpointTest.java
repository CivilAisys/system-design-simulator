package simulator.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
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
            "endToEndMs", "capacityRps", "utilization", "avgQueueMs", "avgLatencyMs", "status");
    private static final List<String> SERVER_FIELDS = List.of("capacityRps", "utilization", "avgQueueMs",
            "avgLatencyMs", "status");

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    @Test
    void simulatesStraightTopology() throws Exception {
        JsonNode body = simulate("/straight-topology.json");

        assertThat(fieldNames(body)).containsExactlyInAnyOrder("valid", "errors", "nodes", "edges", "summary");
        assertThat(body.get("valid").asBoolean()).isTrue();
        assertThat(body.get("errors")).isEmpty();

        JsonNode nodes = body.get("nodes");
        assertThat(fieldNames(nodes)).containsExactly("client-1", "svc-1", "db-1");
        for (JsonNode node : nodes) {
            assertThat(fieldNames(node)).containsExactlyInAnyOrderElementsOf(NODE_FIELDS);
            assertThat(fieldNames(node.get("arrivalRps"))).containsExactlyInAnyOrder("read", "write");
        }

        JsonNode client = nodes.get("client-1");
        assertThat(client.at("/arrivalRps/read").asDouble()).isCloseTo(900, within(1e-6));
        assertThat(client.at("/arrivalRps/write").asDouble()).isCloseTo(100, within(1e-6));
        assertThat(client.get("throughputRps").asDouble()).isEqualTo(1000);
        assertThat(client.get("droppedRps").asDouble()).isZero();
        for (String field : SERVER_FIELDS) {
            assertThat(client.get(field).isNull()).as("client %s", field).isTrue();
        }
        // 數值由 engine 的 EndToEndLatencyTest 驗算，這裡只確認 JSON 形狀
        assertThat(fieldNames(client.get("endToEndMs"))).containsExactlyInAnyOrder("read", "write");
        assertThat(client.at("/endToEndMs/read").isNumber()).isTrue();
        assertThat(client.at("/endToEndMs/write").isNumber()).isTrue();

        JsonNode svc = nodes.get("svc-1");
        assertThat(svc.get("capacityRps").asDouble()).isEqualTo(8000);
        assertThat(svc.get("utilization").asDouble()).isCloseTo(0.125, within(1e-9));
        assertThat(svc.get("avgLatencyMs").asDouble()).isCloseTo(50, within(1e-6));
        assertThat(svc.get("status").asText()).isEqualTo("OK");
        assertThat(svc.get("endToEndMs").isNull()).isTrue();

        JsonNode e1 = body.at("/edges/e1/rps");
        assertThat(e1.get("read").asDouble()).isCloseTo(900, within(1e-6));
        assertThat(e1.get("write").asDouble()).isCloseTo(100, within(1e-6));

        JsonNode summary = body.get("summary");
        assertThat(fieldNames(summary)).contains("offeredRps", "avgEndToEndMs", "bottleneckNodeId");
        assertThat(summary.get("offeredRps").asDouble()).isEqualTo(1000);
        // 只有一個 Client 時等於該 Client 的延遲
        assertThat(summary.get("avgEndToEndMs")).isEqualTo(client.get("endToEndMs"));
        assertThat(summary.get("bottleneckNodeId").asText()).isEqualTo("svc-1");
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

        postTopology(topology).andExpect(status().isBadRequest());
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
    void edgeFromUnknownNodeIsBadRequest() throws Exception {
        ObjectNode topology = straightTopology();
        ((ObjectNode) topology.at("/edges/1")).put("source", "ghost");

        postTopology(topology).andExpect(status().isBadRequest());
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

    private ResultActions postTopology(JsonNode topology) throws Exception {
        return mvc.perform(post("/api/v1/simulate").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(topology)));
    }

    private JsonNode simulate(String resource) throws Exception {
        byte[] topology;
        try (InputStream in = getClass().getResourceAsStream(resource)) {
            topology = in.readAllBytes();
        }
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
