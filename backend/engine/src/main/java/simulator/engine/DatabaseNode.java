package simulator.engine;

public record DatabaseNode(String id, String name, NodeState state, Capacity capacity) implements Node {
}
