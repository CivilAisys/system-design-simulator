package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.Capacity;
import simulator.engine.ClientNode;
import simulator.engine.DatabaseNode;
import simulator.engine.Node;
import simulator.engine.NodeState;
import simulator.engine.ServiceNode;

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
        Required.of(id, "node id");
        String where = "node " + id;
        Required.of(name, where + " name");
        Required.of(params, where + " params");
        NodeState nodeState = state == null ? NodeState.HEALTHY : state;
        return switch (Required.of(type, where + " type")) {
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
        return Required.of(value, "node " + id + " (" + type + ") param " + param);
    }
}
