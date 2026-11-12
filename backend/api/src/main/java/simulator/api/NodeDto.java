package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import simulator.engine.Capacity;
import simulator.engine.ClientNode;
import simulator.engine.DatabaseNode;
import simulator.engine.Node;
import simulator.engine.NodeState;
import simulator.engine.ServiceNode;
import io.swagger.v3.oas.annotations.media.Schema;

/** {@code state} 省略時為 HEALTHY；{@code ui} 只給前端用，後端忽略。 */
@Schema(name = "Node")
public record NodeDto(
        @Schema(requiredMode = REQUIRED) String id,
        @Schema(requiredMode = REQUIRED) NodeType type,
        @Schema(requiredMode = REQUIRED) String name,
        @Schema(requiredMode = REQUIRED) NodeParamsDto params,
        NodeState state,
        UiDto ui) {

    Node toNode() {
        NodeState nodeState = state == null ? NodeState.HEALTHY : state;
        return switch (type) {
            case CLIENT -> new ClientNode(id, name, nodeState,
                    require(params.rps(), "rps"), require(params.readRatio(), "readRatio"));
            case SERVICE -> new ServiceNode(id, name, nodeState, capacity(),
                    require(params.callMode(), "callMode"));
            case DATABASE -> new DatabaseNode(id, name, nodeState, capacity());
        };
    }

    private Capacity capacity() {
        return new Capacity(
                require(params.instances(), "instances"),
                require(params.concurrency(), "concurrency"),
                require(params.serviceTimeMs(), "serviceTimeMs"));
    }

    private <T> T require(T value, String param) {
        if (value == null) {
            throw new IllegalArgumentException("Node " + id + " (" + type + ") is missing param " + param);
        }
        return value;
    }
}
