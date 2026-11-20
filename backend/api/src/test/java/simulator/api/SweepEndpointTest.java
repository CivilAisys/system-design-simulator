package simulator.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/** {@code POST /api/v1/simulate/sweep}：數值由 engine 的 LoadSweepTest 驗算，這裡確認 JSON 形狀和錯誤狀態。 */
@SpringBootTest
@AutoConfigureMockMvc
class SweepEndpointTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper mapper;

    @Test
    void sweepsAValidTopology() throws Exception {
        JsonNode body = mapper.readTree(sweep(request(scenario("basic-web-app.json"), 10))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());

        assertThat(fieldNames(body)).containsExactlyInAnyOrder("valid", "errors", "currentRps", "points", "thresholds");
        assertThat(fieldNames(body.get("thresholds"))).containsExactlyInAnyOrder("warn", "overload");
        assertThat(body.get("valid").asBoolean()).isTrue();
        assertThat(body.get("currentRps").asDouble()).isEqualTo(1000);
        assertThat(body.get("points").size()).isGreaterThanOrEqualTo(40);
        JsonNode point = body.at("/points/1");
        assertThat(fieldNames(point)).containsExactlyInAnyOrder("multiplier", "totalRps", "endToEndMs", "successRate",
                "busiest");
        assertThat(fieldNames(point.get("endToEndMs"))).containsExactlyInAnyOrder("read", "write");
        assertThat(fieldNames(point.get("busiest"))).containsExactlyInAnyOrder("nodeId", "utilization");
    }

    @Test
    void invalidTopologyIsValidFalse() throws Exception {
        ObjectNode topology = scenario("basic-web-app.json");
        topology.withArray("edges").removeAll();

        sweep(request(topology, 2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.points").isEmpty())
                .andExpect(jsonPath("$.thresholds.warn").isEmpty());
    }

    @ParameterizedTest
    @ValueSource(doubles = {0, 10.5, -2})
    void maxMultiplierOutOfRangeIsBadRequest(double maxMultiplier) throws Exception {
        sweep(request(scenario("basic-web-app.json"), maxMultiplier))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("maxMultiplier must be > 0 and ≤ 10"));
    }

    @Test
    void missingFieldsAreBadRequest() throws Exception {
        ObjectNode noMultiplier = mapper.createObjectNode().set("topology", scenario("basic-web-app.json"));
        sweep(noMultiplier).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Missing required field maxMultiplier"));
        sweep(mapper.createObjectNode().put("maxMultiplier", 2)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Missing required field topology"));
    }

    private ObjectNode request(JsonNode topology, double maxMultiplier) {
        ObjectNode request = mapper.createObjectNode();
        request.set("topology", topology);
        request.put("maxMultiplier", maxMultiplier);
        return request;
    }

    private ObjectNode scenario(String fileName) throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/scenarios/" + fileName)) {
            assertThat(in).as("找不到情境 %s", fileName).isNotNull();
            return (ObjectNode) mapper.readTree(in);
        }
    }

    private ResultActions sweep(JsonNode request) throws Exception {
        return mvc.perform(post("/api/v1/simulate/sweep").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(request)));
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
