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
 */
final class TopologyValidator {

    private final Topology topology;
    private final TopologyGraph graph;
    // 上下游數量也算進另一端不存在的邊：畫布上看得到這條邊，那條邊已經報 UNKNOWN_NODE，節點不能再多報一次
    private final Map<String, Integer> downstreams = new HashMap<>();
    private final Map<String, Integer> upstreams = new HashMap<>();
    private final List<ValidationError> errors = new ArrayList<>();

    private TopologyValidator(Topology topology, TopologyGraph graph) {
        this.topology = topology;
        this.graph = graph;
        for (Edge edge : topology.edges()) {
            downstreams.merge(edge.source(), 1, Integer::sum);
            upstreams.merge(edge.target(), 1, Integer::sum);
        }
    }

    /** {@code graph} 是同一份 {@code topology} 建出來的圖。 */
    static List<ValidationError> validate(Topology topology, TopologyGraph graph) {
        var validator = new TopologyValidator(topology, graph);
        validator.check();
        return List.copyOf(validator.errors);
    }

    private void check() {
        if (topology.nodes().stream().noneMatch(ClientNode.class::isInstance)) {
            errors.add(new ValidationError("NO_CLIENT", "拓撲至少要有一個 Client", null, null));
        }
        Set<String> onCycles = graph.nodesOnCycles();
        for (Node node : topology.nodes()) {
            checkNode(node, onCycles.contains(node.id()));
        }
        var pairs = new HashSet<String>();
        for (Edge edge : topology.edges()) {
            checkEdge(edge, pairs);
        }
    }

    private void checkNode(Node node, boolean onCycle) {
        checkParams(node);
        String name = name(node.id());
        int downstream = downstreams.getOrDefault(node.id(), 0);
        if (onCycle) {
            nodeError(node, "CYCLE_DETECTED", name + " 在環上，請求會無限循環");
        }
        if (node instanceof ClientNode && upstreams.containsKey(node.id())) {
            nodeError(node, "CLIENT_HAS_INPUT", "Client " + name + " 不能有上游連線");
        }
        if (TopologyGraph.splitsByWeight(node)) {
            if (downstream == 0) {
                nodeError(node, "NO_DOWNSTREAM", name + " 沒有下游，請求沒有地方送");
            }
            checkWeightSum(node);
        }
        if (node instanceof CacheNode && downstream != 1) {
            nodeError(node, "CACHE_DOWNSTREAM_COUNT",
                    "Cache " + name + " 必須剛好連到一個下游，目前有 " + downstream + " 個");
        }
        if (node instanceof DatabaseNode && downstream > 0) {
            nodeError(node, "DATABASE_HAS_OUTPUT", "Database " + name + " 不能有下游連線");
        }
    }

    /**
     * 每條 weight 都合法時，總和還可能溢位成無限大，各邊的比例會變成 0、下游收不到流量。
     * 有不合法的 weight 時那條邊已經報錯，不再報總和。
     */
    private void checkWeightSum(Node node) {
        List<Edge> edges = graph.outgoing(node.id());
        if (edges.stream().allMatch(edge -> isPositive(edge.weight()))
                && Double.isInfinite(edges.stream().mapToDouble(Edge::weight).sum())) {
            nodeError(node, "INVALID_PARAM", name(node.id()) + " 的下游連線 weight 總和太大，無法計算比例");
        }
    }

    private void checkEdge(Edge edge, Set<String> pairs) {
        List<String> unknown = Stream.of(edge.source(), edge.target()).filter(id -> !graph.contains(id)).toList();
        if (!unknown.isEmpty()) {
            edgeError(edge, "UNKNOWN_NODE", "連線 " + edge.id() + " 連到不存在的節點 " + String.join("、", unknown));
            return;
        }
        if (!pairs.add(edge.source() + "\u0000" + edge.target())) {
            edgeError(edge, "DUPLICATE_EDGE", "連線 " + describe(edge) + " 重複，同一對節點只能有一條連線");
        }
        checkParams(edge, graph.node(edge.source()));
    }

    /** 參數範圍（spec 3.2、4.5）。 */
    private void checkParams(Node node) {
        String where = name(node.id());
        Consumer<String> report = message -> nodeError(node, "INVALID_PARAM", message);
        switch (node) {
            case ClientNode client -> {
                requireAtLeast(client.rps(), 0, where, "rps", report);
                requireRatio(client.readRatio(), where, "readRatio", report);
            }
            case LoadBalancerNode lb -> checkCapacityParams(lb.capacityParams(), where, report);
            case ServiceNode service -> checkCapacityParams(service.capacityParams(), where, report);
            case CacheNode cache -> {
                checkCapacityParams(cache.capacityParams(), where, report);
                requireRatio(cache.hitRatio(), where, "hitRatio", report);
            }
            case DatabaseNode database -> checkCapacityParams(database.capacityParams(), where, report);
        }
    }

    private static void checkCapacityParams(CapacityParams params, String where, Consumer<String> report) {
        requireAtLeast(params.instances(), 1, where, "instances", report);
        requireAtLeast(params.concurrency(), 1, where, "concurrency", report);
        requirePositive(params.serviceTimeMs(), where, "serviceTimeMs", report);
    }

    /** 只檢查對這個起點有意義的欄位，其他欄位計算時忽略（spec 3.4）。 */
    private void checkParams(Edge edge, Node source) {
        String where = "連線 " + describe(edge);
        Consumer<String> report = message -> edgeError(edge, "INVALID_PARAM", message);
        requireAtLeast(edge.latencyMs(), 0, where, "latencyMs", report);
        if (TopologyGraph.splitsByWeight(source)) {
            // weight 為 0 的下游收不到流量，等於沒有接
            requirePositive(edge.weight(), where, "weight", report);
        } else if (source instanceof ServiceNode) {
            requireAtLeast(edge.callsPerRequest(), 1, where, "callsPerRequest", report);
        }
    }

    // 以下檢查都把 NaN 和無限大當成不合法

    private static void requireAtLeast(double value, double min, String where, String param,
            Consumer<String> report) {
        if (!(value >= min) || Double.isInfinite(value)) {
            report.accept(invalid(where, param, "≥ " + number(min), value));
        }
    }

    private static void requirePositive(double value, String where, String param, Consumer<String> report) {
        if (!isPositive(value)) {
            report.accept(invalid(where, param, "> 0", value));
        }
    }

    private static boolean isPositive(double value) {
        return value > 0 && !Double.isInfinite(value);
    }

    private static void requireRatio(double value, String where, String param, Consumer<String> report) {
        if (!(value >= 0 && value <= 1)) {
            report.accept(invalid(where, param, "介於 0 和 1 之間", value));
        }
    }

    private static String invalid(String where, String param, String expected, double actual) {
        return where + " 的 " + param + " 必須 " + expected + "，目前是 " + number(actual);
    }

    /** 整數不顯示小數點（1 而不是 1.0）；超出 long 能精確表示的範圍時照 double 顯示，例如 -1.0E20。 */
    private static String number(double value) {
        return value == Math.rint(value) && Math.abs(value) < 1e15 ? String.valueOf((long) value)
                : String.valueOf(value);
    }

    private String name(String nodeId) {
        Node node = graph.node(nodeId);
        return "「" + (node == null ? nodeId : node.name()) + "」";
    }

    private String describe(Edge edge) {
        return name(edge.source()) + " → " + name(edge.target());
    }

    private void nodeError(Node node, String code, String message) {
        errors.add(new ValidationError(code, message, node.id(), null));
    }

    private void edgeError(Edge edge, String code, String message) {
        errors.add(new ValidationError(code, message, null, edge.id()));
    }
}
