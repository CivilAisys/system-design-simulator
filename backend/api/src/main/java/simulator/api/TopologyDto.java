package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import simulator.engine.Topology;

/** 拓撲的 JSON 格式，也是匯入／匯出的檔案格式。 */
@Schema(name = "Topology")
public record TopologyDto(
        @Schema(requiredMode = REQUIRED, example = "1") Integer version,
        @Schema(requiredMode = REQUIRED) List<NodeDto> nodes,
        @Schema(requiredMode = REQUIRED) List<EdgeDto> edges) {

    Topology toTopology() {
        Required.of(version, "version");
        return new Topology(
                Required.of(nodes, "nodes").stream().map(node -> Required.of(node, "nodes[]").toNode()).toList(),
                Required.of(edges, "edges").stream().map(edge -> Required.of(edge, "edges[]").toEdge()).toList());
    }
}
