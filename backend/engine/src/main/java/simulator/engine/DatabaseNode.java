package simulator.engine;

public record DatabaseNode(String id, String name, NodeHealth health, CapacityParams capacityParams) implements Node {
}
