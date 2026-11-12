package simulator.engine;

public record ServiceNode(String id, String name, NodeHealth health, CapacityParams capacityParams, CallMode callMode)
        implements Node {
}
