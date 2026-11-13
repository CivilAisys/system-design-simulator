package simulator.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * spec 4.5 的驗證規則：收集所有錯誤，每個錯誤附上有問題的節點或邊。
 * 錯誤依 NO_CLIENT、各節點、各邊排列，節點和邊依輸入順序。
 * id 重複是格式錯誤（錯誤沒辦法指到哪一個），丟 IllegalArgumentException。
 */
final class TopologyValidator {

    private final Topology topology;
    private final Map<String, Node> nodes = new HashMap<>();
    private final List<ValidationError> errors = new ArrayList<>();

    private TopologyValidator(Topology topology) {
        this.topology = topology;
        for (Node node : topology.nodes()) {
            if (nodes.putIfAbsent(node.id(), node) != null) {
                throw new IllegalArgumentException("Duplicate node id " + node.id());
            }
        }
        var edgeIds = new HashSet<String>();
        for (Edge edge : topology.edges()) {
            if (!edgeIds.add(edge.id())) {
                throw new IllegalArgumentException("Duplicate edge id " + edge.id());
            }
        }
    }

    static List<ValidationError> validate(Topology topology) {
        var validator = new TopologyValidator(topology);
        validator.check();
        return List.copyOf(validator.errors);
    }

    private void check() {
        if (topology.nodes().stream().noneMatch(ClientNode.class::isInstance)) {
            errors.add(new ValidationError("NO_CLIENT", "拓撲至少要有一個 Client", null, null));
        }
        // 兩端不存在的邊只報 UNKNOWN_NODE，不參與其他規則
        List<Edge> known = topology.edges().stream()
                .filter(edge -> nodes.containsKey(edge.source()) && nodes.containsKey(edge.target()))
                .toList();
        var graph = TopologyGraph.of(new Topology(topology.nodes(), known));
        Set<String> onCycles = graph.nodesOnCycles();
        for (Node node : topology.nodes()) {
            checkNode(node, graph, onCycles.contains(node.id()));
        }
        var pairs = new HashSet<String>();
        for (Edge edge : topology.edges()) {
            checkEdge(edge, pairs);
        }
    }

    private void checkNode(Node node, TopologyGraph graph, boolean onCycle) {
        checkParams(node);
        List<Edge> outgoing = graph.outgoing(node.id());
        String name = name(node.id());
        if (onCycle) {
            nodeError(node, "CYCLE_DETECTED", name + " 在環上，請求會無限循環");
        }
        switch (node) {
            case ClientNode client -> {
                if (graph.hasIncoming(node.id())) {
                    nodeError(node, "CLIENT_HAS_INPUT", "Client " + name + " 不能有上游連線");
                }
                checkSplit(node, outgoing);
            }
            case LoadBalancerNode lb -> checkSplit(node, outgoing);
            case ServiceNode service -> {
            }
            case CacheNode cache -> {
                if (outgoing.size() != 1) {
                    nodeError(node, "CACHE_DOWNSTREAM_COUNT",
                            "Cache " + name + " 必須剛好連到一個下游，目前有 " + outgoing.size() + " 個");
                }
            }
            case DatabaseNode database -> {
                if (!outgoing.isEmpty()) {
                    nodeError(node, "DATABASE_HAS_OUTPUT", "Database " + name + " 不能有下游連線");
                }
            }
        }
    }

    /** Client／LB 依 weight 比例分流，至少要有一個下游。 */
    private void checkSplit(Node node, List<Edge> outgoing) {
        if (outgoing.isEmpty()) {
            nodeError(node, "NO_DOWNSTREAM", name(node.id()) + " 沒有下游，請求沒有地方送");
        }
    }

    private void checkEdge(Edge edge, Set<String> pairs) {
        List<String> unknown = Stream.of(edge.source(), edge.target()).filter(id -> !nodes.containsKey(id)).toList();
        if (!unknown.isEmpty()) {
            edgeError(edge, "UNKNOWN_NODE", "連線 " + edge.id() + " 連到不存在的節點 " + String.join("、", unknown));
            return;
        }
        if (!pairs.add(edge.source() + "\u0000" + edge.target())) {
            edgeError(edge, "DUPLICATE_EDGE", "連線 " + describe(edge) + " 重複，同一對節點只能有一條連線");
        }
        checkParams(edge, nodes.get(edge.source()));
    }

    /** 參數範圍（spec 3.2、4.5）。 */
    private void checkParams(Node node) {
        String where = name(node.id());
        switch (node) {
            case ClientNode client -> {
                requireAtLeast(client.rps(), 0, where, "rps", message -> nodeError(node, message));
                requireBetween(client.readRatio(), where, "readRatio", message -> nodeError(node, message));
            }
            case LoadBalancerNode lb -> checkCapacityParams(node, lb.capacityParams());
            case ServiceNode service -> checkCapacityParams(node, service.capacityParams());
            case CacheNode cache -> {
                checkCapacityParams(node, cache.capacityParams());
                requireBetween(cache.hitRatio(), where, "hitRatio", message -> nodeError(node, message));
            }
            case DatabaseNode database -> checkCapacityParams(node, database.capacityParams());
        }
    }

    private void checkCapacityParams(Node node, CapacityParams params) {
        String where = name(node.id());
        requireAtLeast(params.instances(), 1, where, "instances", message -> nodeError(node, message));
        requireAtLeast(params.concurrency(), 1, where, "concurrency", message -> nodeError(node, message));
        requirePositive(params.serviceTimeMs(), where, "serviceTimeMs", message -> nodeError(node, message));
    }

    /** 只檢查對這個起點有意義的欄位，其他欄位計算時忽略（spec 3.4）。 */
    private void checkParams(Edge edge, Node source) {
        String where = "連線 " + describe(edge);
        requireAtLeast(edge.latencyMs(), 0, where, "latencyMs", message -> edgeError(edge, message));
        switch (source) {
            case ClientNode client -> requirePositive(edge.weight(), where, "weight",
                    message -> edgeError(edge, message));
            case LoadBalancerNode lb -> requirePositive(edge.weight(), where, "weight",
                    message -> edgeError(edge, message));
            case ServiceNode service -> requireAtLeast(edge.callsPerRequest(), 1, where, "callsPerRequest",
                    message -> edgeError(edge, message));
            case CacheNode cache -> {
            }
            case DatabaseNode database -> {
            }
        }
    }

    private static void requireAtLeast(double value, double min, String where, String param,
            Consumer<String> report) {
        if (!isAtLeast(value, min)) {
            report.accept(invalid(where, param, "≥ " + number(min), value));
        }
    }

    /** NaN 和無限大都不合法。 */
    private static boolean isAtLeast(double value, double min) {
        return value >= min && !Double.isInfinite(value);
    }

    /** weight 為 0 的下游收不到流量，等於沒有接；全部為 0 時無法分流。 */
    private static void requirePositive(double value, String where, String param, Consumer<String> report) {
        if (!(value > 0) || Double.isInfinite(value)) {
            report.accept(invalid(where, param, "> 0", value));
        }
    }

    private static void requireBetween(double value, String where, String param,
            Consumer<String> report) {
        if (!(value >= 0 && value <= 1)) {
            report.accept(invalid(where, param, "介於 0 和 1 之間", value));
        }
    }

    private static String invalid(String where, String param, String expected, double actual) {
        return where + " 的 " + param + " 必須 " + expected + "，目前是 " + number(actual);
    }

    /** 整數不顯示小數點：1 而不是 1.0。 */
    private static String number(double value) {
        return value == Math.rint(value) && !Double.isInfinite(value) ? String.valueOf((long) value)
                : String.valueOf(value);
    }

    private String name(String nodeId) {
        Node node = nodes.get(nodeId);
        return "「" + (node == null ? nodeId : node.name()) + "」";
    }

    private String describe(Edge edge) {
        return name(edge.source()) + " → " + name(edge.target());
    }

    private void nodeError(Node node, String message) {
        nodeError(node, "INVALID_PARAM", message);
    }

    private void nodeError(Node node, String code, String message) {
        errors.add(new ValidationError(code, message, node.id(), null));
    }

    private void edgeError(Edge edge, String message) {
        edgeError(edge, "INVALID_PARAM", message);
    }

    private void edgeError(Edge edge, String code, String message) {
        errors.add(new ValidationError(code, message, null, edge.id()));
    }
}
