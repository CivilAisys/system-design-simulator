package io.github.civilaisys.sds.engine;

public record DatabaseNode(String id, String name, NodeState state, Capacity capacity) implements Node {
}
