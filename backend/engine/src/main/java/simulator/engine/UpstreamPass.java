package simulator.engine;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 依拓撲排序由下游往上游，替每個節點的 read 與 write 各算一個值。
 * 算一個節點時，它所有下游在同一個 class 的值都已經算好。
 */
final class UpstreamPass<T> {

    interface Step<T> {
        /** {@code downstream} 是同一個 class 已經算好的值，以節點 id 為 key。 */
        T compute(Node node, boolean read, Map<String, T> downstream);
    }

    private final Map<String, T> readValues = new HashMap<>();
    private final Map<String, T> writeValues = new HashMap<>();

    /** {@code order} 是拓撲排序。 */
    UpstreamPass(List<Node> order, Step<T> step) {
        for (Node node : order.reversed()) {
            readValues.put(node.id(), step.compute(node, true, readValues));
            writeValues.put(node.id(), step.compute(node, false, writeValues));
        }
    }

    T get(String nodeId, boolean read) {
        return (read ? readValues : writeValues).get(nodeId);
    }
}
