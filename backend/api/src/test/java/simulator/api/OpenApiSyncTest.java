package simulator.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 確認 repo 裡的 openapi.json 與目前程式碼產生的一致。
 * 由 {@code ./gradlew :api:generateOpenApi} 以 openapi.update=true 執行時改為寫檔。
 */
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiSyncTest {

    private static final String REGENERATE = "run ./gradlew :api:generateOpenApi";

    @Autowired
    private MockMvc mvc;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void openApiJsonMatchesCode() throws Exception {
        String body = mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode current = mapper.readTree(body);
        Path file = Path.of(System.getProperty("openapi.file"));

        if (Boolean.getBoolean("openapi.update")) {
            Files.writeString(file, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(current) + "\n");
            return;
        }

        assertThat(file).as("openapi.json is missing, " + REGENERATE).exists();
        assertThat(mapper.readTree(file.toFile())).as("openapi.json is out of date, " + REGENERATE)
                .isEqualTo(current);
    }

    /**
     * 有預設值的欄位就是選填（spec 3.6）：不能同時列在 required 裡，否則前端產生的型別會要求一定要給。
     * 之後新增的選填欄位只要在 {@code @Schema} 寫上 {@code defaultValue}，這個測試就會一起檢查。
     */
    @Test
    void fieldsWithDefaultsAreOptional() throws Exception {
        JsonNode schemas = mapper.readTree(Path.of(System.getProperty("openapi.file")).toFile())
                .at("/components/schemas");
        List<String> defaulted = new ArrayList<>();
        List<String> requiredWithDefault = new ArrayList<>();
        schemas.properties().forEach(schema -> {
            List<String> required = new ArrayList<>();
            schema.getValue().path("required").forEach(name -> required.add(name.asText()));
            schema.getValue().path("properties").properties().forEach(property -> {
                if (property.getValue().has("default")) {
                    String field = schema.getKey() + "." + property.getKey();
                    defaulted.add(field);
                    if (required.contains(property.getKey())) {
                        requiredWithDefault.add(field);
                    }
                }
            });
        });

        assertThat(defaulted).contains("Edge.weight", "Edge.callsPerRequest", "Edge.latencyMs", "Edge.requestClass");
        assertThat(requiredWithDefault).isEmpty();
    }
}
