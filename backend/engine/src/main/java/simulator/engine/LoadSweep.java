package simulator.engine;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * 負載掃描（spec 4.10）：所有 Client 的 rps 一起乘上倍率 k，從 0 掃到 {@code maxMultiplier}，
 * 每一點都用 {@link Simulator} 算一次，再用二分搜尋找出第一個節點到 ρ 0.7 和第一個節點過載的倍率。
 * 只改 Client 的 rps，拓撲的其他參數都不動。
 */
public final class LoadSweep {

    /** 均分的點數（含 k = 0 和上限）。 */
    public static final int POINTS = 40;
    /** 上限倍率最多 10 倍。 */
    public static final double MAX_MULTIPLIER = 10;
    // 每次把範圍減半：30 次之後誤差是上限的 2⁻³⁰，遠小於 0.1%
    private static final int BISECTION_STEPS = 30;

    private final Simulator simulator;

    public LoadSweep(Simulator simulator) {
        this.simulator = simulator;
    }

    /**
     * 拓撲本身有驗證錯誤時回傳 {@code valid = false}，不掃描。放大後超出參數範圍（例如 rps 超過上限）的點略過。
     *
     * @throws IllegalArgumentException {@code maxMultiplier} 不在 (0, 10] 之內
     */
    public SweepResult sweep(Topology topology, double maxMultiplier) {
        if (!(maxMultiplier > 0 && maxMultiplier <= MAX_MULTIPLIER)) {
            throw new IllegalArgumentException("maxMultiplier must be > 0 and ≤ " + MAX_MULTIPLIER);
        }
        SimulationResult current = simulator.simulate(topology);
        if (!current.valid()) {
            return SweepResult.invalid(current.errors());
        }
        double currentRps = current.summary().offeredRps();
        List<SweepPoint> points = new ArrayList<>();
        for (int i = 0; i < POINTS; i++) {
            point(topology, maxMultiplier * i / (POINTS - 1), currentRps).ifPresent(points::add);
        }
        SweepThreshold warn = threshold(topology, maxMultiplier, Status.WARN_AT, currentRps);
        SweepThreshold overload = threshold(topology, maxMultiplier, Status.OVERLOADED_AT, currentRps);
        // 門檻那一點也加進曲線，曲線的轉折才會落在正確的位置
        for (SweepThreshold threshold : new SweepThreshold[] {warn, overload}) {
            if (threshold != null && points.stream().noneMatch(p -> p.multiplier() == threshold.multiplier())) {
                point(topology, threshold.multiplier(), currentRps).ifPresent(points::add);
            }
        }
        points.sort(Comparator.comparingDouble(SweepPoint::multiplier));
        return new SweepResult(true, List.of(), currentRps, List.copyOf(points), warn, overload);
    }

    private Optional<SweepPoint> point(Topology topology, double multiplier, double currentRps) {
        SimulationResult result = simulator.simulate(scaled(topology, multiplier));
        if (!result.valid()) {
            return Optional.empty();
        }
        Summary summary = result.summary();
        // 各 Client 依 read 或 write 的請求數加權平均；任一 Client 沒有定義時為 null（spec 4.3）
        Double read = summary.avgEndToEndMs().read().ms();
        Double write = summary.avgEndToEndMs().write().ms();
        return Optional.of(new SweepPoint(multiplier, currentRps * multiplier, read, write,
                1 - summary.dropRate(), busiest(result)));
    }

    /**
     * 最大 ρ 第一次到 {@code utilization} 的倍率：每個節點的 λ 隨 k 不會減少，所以最大 ρ 也不會減少，可以二分搜尋。
     * 上限時都還沒到就是 null。
     */
    private SweepThreshold threshold(Topology topology, double maxMultiplier, double utilization, double currentRps) {
        BusiestNode atMax = busiest(topology, maxMultiplier);
        if (atMax == null || atMax.utilization() < utilization) {
            return null;
        }
        double low = 0;
        double high = maxMultiplier;
        BusiestNode crossed = atMax;
        for (int i = 0; i < BISECTION_STEPS; i++) {
            double middle = (low + high) / 2;
            BusiestNode node = busiest(topology, middle);
            if (node != null && node.utilization() >= utilization) {
                high = middle;
                crossed = node;
            } else {
                low = middle;
            }
        }
        return new SweepThreshold(high, currentRps * high, crossed.nodeId());
    }

    private BusiestNode busiest(Topology topology, double multiplier) {
        SimulationResult result = simulator.simulate(scaled(topology, multiplier));
        return result.valid() ? busiest(result) : null;
    }

    /** ρ 最高的節點，和 {@code bottleneckNodeId} 同一組候選（未連線的不算）；沒有候選時為 null。 */
    private static BusiestNode busiest(SimulationResult result) {
        String id = result.summary().bottleneckNodeId();
        return id == null ? null : new BusiestNode(id, result.nodes().get(id).utilization());
    }

    /** 所有 Client 的 rps 乘上 {@code multiplier}，其他節點和邊不變。 */
    private static Topology scaled(Topology topology, double multiplier) {
        List<Node> nodes = topology.nodes().stream()
                .map(node -> node instanceof ClientNode client ? (Node) new ClientNode(client.id(), client.name(),
                        client.health(), client.rps() * multiplier, client.readRatio(), client.readResponseBytes(),
                        client.writeRequestBytes()) : node)
                .toList();
        return new Topology(nodes, topology.edges());
    }
}
