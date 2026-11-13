package simulator.api;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.JsonSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import simulator.engine.Simulator;
import simulator.engine.SteadyStateSimulator;

@SpringBootApplication
public class SimulatorApplication {

    public static void main(String[] args) {
        SpringApplication.run(SimulatorApplication.class, args);
    }

    @Bean
    Simulator simulator() {
        return new SteadyStateSimulator();
    }

    @Bean
    OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("System Design Simulator API").version("v1"))
                .addServersItem(new Server().url("/"));
    }

    /**
     * springdoc 把 nullable 的物件欄位寫成 {@code $ref} 加上 {@code type: null}，在 OpenAPI 3.1 代表「只能是 null」。
     * 改成 {@code oneOf: [$ref, null]}，前端型別才會是 {@code X | null}。
     */
    @Bean
    @SuppressWarnings("rawtypes") // swagger-core 的 properties 是 Map<String, Schema>
    OpenApiCustomizer nullableObjectProperties() {
        return openApi -> {
            for (Schema<?> schema : openApi.getComponents().getSchemas().values()) {
                Map<String, Schema> properties = schema.getProperties();
                if (properties != null) {
                    properties.replaceAll((name, property) -> isNullableRef(property) ? nullableRef(property) : property);
                }
            }
        };
    }

    private static boolean isNullableRef(Schema<?> property) {
        return property.get$ref() != null && property.getTypes() != null && property.getTypes().contains("null");
    }

    private static Schema<?> nullableRef(Schema<?> property) {
        return new JsonSchema()
                .oneOf(List.of(new JsonSchema().$ref(property.get$ref()), new JsonSchema().types(Set.of("null"))))
                .description(property.getDescription());
    }
}
