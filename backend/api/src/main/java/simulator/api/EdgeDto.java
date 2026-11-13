package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.Edge;

/** {@code weight}、{@code callsPerRequest}、{@code latencyMs} 省略時為 spec 3.4 的預設值 1。 */
@Schema(name = "Edge")
public record EdgeDto(
        @Schema(requiredMode = REQUIRED) String id,
        @Schema(requiredMode = REQUIRED) String source,
        @Schema(requiredMode = REQUIRED) String target,
        @Schema(defaultValue = "1") Double weight,
        @Schema(defaultValue = "1") Integer callsPerRequest,
        @Schema(defaultValue = "1") Double latencyMs) {

    Edge toEdge() {
        Required.of(id, "edge id");
        String where = "edge " + id;
        return new Edge(id, Required.of(source, where + " source"), Required.of(target, where + " target"),
                weight == null ? 1 : weight,
                callsPerRequest == null ? 1 : callsPerRequest,
                latencyMs == null ? 1 : latencyMs);
    }
}
