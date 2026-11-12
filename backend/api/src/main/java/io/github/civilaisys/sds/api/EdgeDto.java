package io.github.civilaisys.sds.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.github.civilaisys.sds.engine.Edge;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Edge")
public record EdgeDto(
        @Schema(requiredMode = REQUIRED) String id,
        @Schema(requiredMode = REQUIRED) String source,
        @Schema(requiredMode = REQUIRED) String target,
        @Schema(requiredMode = REQUIRED, example = "1") double weight,
        @Schema(requiredMode = REQUIRED, example = "1") int callsPerRequest,
        @Schema(requiredMode = REQUIRED, example = "1") double latencyMs) {

    Edge toEdge() {
        return new Edge(id, source, target, weight, callsPerRequest, latencyMs);
    }
}
