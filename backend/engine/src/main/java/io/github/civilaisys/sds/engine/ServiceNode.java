package io.github.civilaisys.sds.engine;

public record ServiceNode(String id, String name, NodeState state, Capacity capacity, CallMode callMode)
        implements Node {
}
