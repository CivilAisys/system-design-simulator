package io.github.civilaisys.sds.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.github.civilaisys.sds.engine.Topology;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/** 拓撲的 JSON 格式，也是匯入／匯出的檔案格式。 */
@Schema(name = "Topology")
public record TopologyDto(
        @Schema(requiredMode = REQUIRED, example = "1") int version,
        @Schema(requiredMode = REQUIRED) List<NodeDto> nodes,
        @Schema(requiredMode = REQUIRED) List<EdgeDto> edges) {

    Topology toTopology() {
        return new Topology(
                nodes.stream().map(NodeDto::toNode).toList(),
                edges.stream().map(EdgeDto::toEdge).toList());
    }
}
