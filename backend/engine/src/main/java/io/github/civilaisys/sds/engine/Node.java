package io.github.civilaisys.sds.engine;

/** 拓撲中的一個元件。只描述參數，計算行為在 {@link Simulator} 的實作裡。 */
public sealed interface Node permits ClientNode, ServiceNode, DatabaseNode {
    String id();

    String name();

    NodeState state();
}
