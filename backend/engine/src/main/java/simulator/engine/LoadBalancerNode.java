package simulator.engine;

/** 分流：依各條出邊的 {@code weight} 比例把處理量分給下游。 */
public record LoadBalancerNode(String id, String name, NodeHealth health, CapacityParams capacityParams)
        implements Node {
}
