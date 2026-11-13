package simulator.api;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
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
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
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

    /**
     * 格式錯誤一律回 400（spec 4.5）：Jackson 預設會把字串、布林轉成數字，把小數截成整數，
     * 把數字當成 enum 的序號或轉成字串。這些都關掉，讓解析失敗。
     */
    @Bean
    Jackson2ObjectMapperBuilderCustomizer strictTopologyFormat() {
        return builder -> builder
                .featuresToDisable(MapperFeature.ALLOW_COERCION_OF_SCALARS, DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .featuresToEnable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .postConfigurer(mapper -> mapper.coercionConfigFor(LogicalType.Textual)
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail));
    }

    @Bean
    OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("System Design Simulator API").version("v1"))
                .addServersItem(new Server().url("/"));
    }

    /**
     * springdoc 把 nullable 的物件欄位寫成 {@code $ref} 加上 {@code type: null}，在 OpenAPI 3.1 代表「只能是 null」。
     * 改成 {@code oneOf: [$ref, null]}，前端型別才會是 {@code X | null}。欄位上的其他屬性（description 等）保留。
     */
    @Bean
    OpenApiCustomizer nullableObjectProperties() {
        return openApi -> {
            if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
                return;
            }
            openApi.getComponents().getSchemas().values().forEach(SimulatorApplication::fixNullableRefs);
        };
    }

    /** 往下走 properties、陣列的 items 和 Map 的值，每一層的 nullable $ref 都改寫。 */
    @SuppressWarnings({"rawtypes", "unchecked"}) // swagger-core 的 properties 是 Map<String, Schema>
    private static void fixNullableRefs(Schema<?> schema) {
        if (schema == null) {
            return;
        }
        if (isNullableRef(schema)) {
            String ref = schema.get$ref();
            schema.set$ref(null);
            schema.setTypes(null);
            schema.setOneOf(List.of(new JsonSchema().$ref(ref), new JsonSchema().types(Set.of("null"))));
        }
        Map<String, Schema> properties = schema.getProperties();
        if (properties != null) {
            properties.values().forEach(SimulatorApplication::fixNullableRefs);
        }
        fixNullableRefs(schema.getItems());
        if (schema.getAdditionalProperties() instanceof Schema<?> values) {
            fixNullableRefs(values);
        }
    }

    private static boolean isNullableRef(Schema<?> schema) {
        return schema.get$ref() != null && schema.getTypes() != null && schema.getTypes().contains("null");
    }
}
