package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import simulator.engine.CacheNode;
import simulator.engine.CapacityParams;
import simulator.engine.CdnNode;
import simulator.engine.ClientNode;
import simulator.engine.DatabaseNode;
import simulator.engine.ExternalApiNode;
import simulator.engine.LoadBalancerNode;
import simulator.engine.MessageQueueNode;
import simulator.engine.Node;
import simulator.engine.NodeHealth;
import simulator.engine.ObjectStorageNode;
import simulator.engine.RateLimiterNode;
import simulator.engine.ReadReplicaNode;
import simulator.engine.ServiceNode;
import simulator.engine.StorageSizing;

/** {@code state} 省略時為 HEALTHY；{@code ui} 只給前端用，後端忽略。 */
@Schema(name = "Node")
public record NodeDto(
        @Schema(requiredMode = REQUIRED) String id,
        @Schema(requiredMode = REQUIRED) NodeType type,
        @Schema(requiredMode = REQUIRED) String name,
        @Schema(requiredMode = REQUIRED) NodeParamsDto params,
        NodeHealth state,
        UiDto ui) {

    Node toNode() {
        Required.of(id, "node id");
        String where = "node " + id;
        Required.of(name, where + " name");
        Required.of(params, where + " params");
        NodeHealth health = state == null ? NodeHealth.HEALTHY : state;
        return switch (Required.of(type, where + " type")) {
            case CLIENT -> new ClientNode(id, name, health,
                    require(params.rps(), "rps"), require(params.readRatio(), "readRatio"),
                    orDefault(params.readResponseBytes(), ClientNode.DEFAULT_READ_RESPONSE_BYTES),
                    orDefault(params.writeRequestBytes(), ClientNode.DEFAULT_WRITE_REQUEST_BYTES));
            case LOAD_BALANCER -> new LoadBalancerNode(id, name, health, capacityParams());
            case SERVICE -> new ServiceNode(id, name, health, capacityParams(),
                    require(params.callMode(), "callMode"));
            case CACHE -> new CacheNode(id, name, health, capacityParams(), require(params.hitRatio(), "hitRatio"),
                    params.hotShare(), params.replicas() == null ? CacheNode.DEFAULT_REPLICAS : params.replicas());
            case CDN -> new CdnNode(id, name, health, capacityParams(), require(params.hitRatio(), "hitRatio"));
            case DATABASE -> new DatabaseNode(id, name, health, capacityParams(), sizing(DatabaseNode.DEFAULT_SIZING));
            case OBJECT_STORAGE -> new ObjectStorageNode(id, name, health, capacityParams(),
                    sizing(ObjectStorageNode.DEFAULT_SIZING));
            case RATE_LIMITER -> new RateLimiterNode(id, name, health, require(params.limitRps(), "limitRps"));
            case READ_REPLICA -> new ReadReplicaNode(id, name, health, capacityParams());
            case MESSAGE_QUEUE -> new MessageQueueNode(id, name, health, capacityParams());
            case EXTERNAL_API -> new ExternalApiNode(id, name, health,
                    require(params.latencyMs(), "latencyMs"), require(params.quotaRps(), "quotaRps"));
        };
    }

    private CapacityParams capacityParams() {
        return new CapacityParams(
                require(params.instances(), "instances"),
                require(params.concurrency(), "concurrency"),
                require(params.serviceTimeMs(), "serviceTimeMs"));
    }

    /** 省略的欄位用該 type 的預設值；{@code diskGbPerInstance} 省略時不估算磁碟幾天後會滿。 */
    private StorageSizing sizing(StorageSizing defaults) {
        return new StorageSizing(orDefault(params.bytesPerWrite(), defaults.bytesPerWrite()),
                orDefault(params.retentionDays(), defaults.retentionDays()), params.diskGbPerInstance());
    }

    private static double orDefault(Double value, double fallback) {
        return value == null ? fallback : value;
    }

    private <T> T require(T value, String param) {
        return Required.of(value, "node " + id + " (" + type + ") param " + param);
    }
}
