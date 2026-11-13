package simulator.engine;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * spec 4.5 的驗證規則：收集所有錯誤，每個錯誤附上有問題的節點或邊。
 * 錯誤依 NO_CLIENT、各節點、各邊排列，節點和邊依輸入順序。
 */
final class TopologyValidator {

    // 參數上限（spec 4.5）：超過時 Run 太慢或結果溢位成 Infinity。前端 params.ts 用同一組數值
    static final double MAX_RPS = 1e12;
    static final long MAX_WORKERS = 1_000_000;
    static final double MIN_SERVICE_TIME_MS = 1e-6;
    static final double MAX_SERVICE_TIME_MS = 1e7;
    static final double MAX_LATENCY_MS = 1e7;
    static final int MAX_CALLS_PER_REQUEST = 10_000;
    static final double MAX_WEIGHT = 1e6;

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
        if (TopologyGraph.splitsByWeight(node) && downstream == 0) {
            nodeError(node, "NO_DOWNSTREAM", name + " 沒有下游，請求沒有地方送");
        }
        if (node instanceof CacheNode && downstream != 1) {
            nodeError(node, "CACHE_DOWNSTREAM_COUNT",
                    "Cache " + name + " 必須剛好連到一個下游，目前有 " + downstream + " 個");
        }
        if (node instanceof DatabaseNode && downstream > 0) {
            nodeError(node, "DATABASE_HAS_OUTPUT", "Database " + name + " 不能有下游連線");
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
                requireBetween(client.rps(), 0, MAX_RPS, where, "rps", report);
                requireBetween(client.readRatio(), 0, 1, where, "readRatio", report);
            }
            case LoadBalancerNode lb -> checkCapacityParams(lb.capacityParams(), where, report);
            case ServiceNode service -> checkCapacityParams(service.capacityParams(), where, report);
            case CacheNode cache -> {
                checkCapacityParams(cache.capacityParams(), where, report);
                requireBetween(cache.hitRatio(), 0, 1, where, "hitRatio", report);
            }
            case DatabaseNode database -> checkCapacityParams(database.capacityParams(), where, report);
        }
    }

    private static void checkCapacityParams(CapacityParams params, String where, Consumer<String> report) {
        requireAtLeast(params.instances(), 1, where, "instances", report);
        requireAtLeast(params.concurrency(), 1, where, "concurrency", report);
        // 上限看乘積：worker 數決定 Erlang C 的計算量，各自檢查擋不住 40000 × 50000
        if (params.instances() >= 1 && params.concurrency() >= 1 && params.workers() > MAX_WORKERS) {
            report.accept(invalid(where, "instances × concurrency", "≤ " + bound(MAX_WORKERS), params.workers()));
        }
        requireBetween(params.serviceTimeMs(), MIN_SERVICE_TIME_MS, MAX_SERVICE_TIME_MS, where, "serviceTimeMs",
                report);
    }

    /** 只檢查對這個起點有意義的欄位，其他欄位計算時忽略（spec 3.4）。 */
    private void checkParams(Edge edge, Node source) {
        String where = "連線 " + describe(edge);
        Consumer<String> report = message -> edgeError(edge, "INVALID_PARAM", message);
        requireBetween(edge.latencyMs(), 0, MAX_LATENCY_MS, where, "latencyMs", report);
        if (TopologyGraph.splitsByWeight(source)) {
            // weight 為 0 的下游收不到流量，等於沒有接
            if (!(edge.weight() > 0 && edge.weight() <= MAX_WEIGHT)) {
                report.accept(invalid(where, "weight", "> 0 且 ≤ " + bound(MAX_WEIGHT), edge.weight()));
            }
        } else if (source instanceof ServiceNode) {
            requireBetween(edge.callsPerRequest(), 1, MAX_CALLS_PER_REQUEST, where, "callsPerRequest", report);
        }
    }

    // 以下檢查都把 NaN 和無限大當成不合法

    private static void requireAtLeast(double value, double min, String where, String param,
            Consumer<String> report) {
        if (!(value >= min) || Double.isInfinite(value)) {
            report.accept(invalid(where, param, "≥ " + bound(min), value));
        }
    }

    private static void requireBetween(double value, double min, double max, String where, String param,
            Consumer<String> report) {
        if (!(value >= min && value <= max)) {
            report.accept(invalid(where, param, "介於 " + bound(min) + " 和 " + bound(max) + " 之間", value));
        }
    }

    private static String invalid(String where, String param, String expected, double actual) {
        return where + " 的 " + param + " 必須 " + expected + "，目前是 " + number(actual);
    }

    /** 合法範圍的邊界，例如 0.000001、1,000,000。前端的範圍說明用同樣的寫法 */
    private static String bound(double value) {
        return new DecimalFormat("#,##0.######", DecimalFormatSymbols.getInstance(Locale.ROOT)).format(value);
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
