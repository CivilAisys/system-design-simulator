package simulator.engine;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * 負載掃描（spec 4.10）：所有 Client 的 rps 一起乘上倍率 k，從 0 掃到 {@code maxMultiplier}，
 * 每一點都用 {@link Simulator} 算一次，再用二分搜尋找出第一個節點到 ρ 0.7 和第一個節點過載的倍率，並在過載前加密取樣。
 * 只改 Client 的 rps，拓撲的其他參數都不動。和 {@link Simulator} 一樣是 engine 模組的公開入口。
 */
public final class LoadSweep {

    /** 均分的點數（含 k = 0 和上限）。 */
    static final int POINTS = 40;
    /** 上限倍率最多 10 倍。 */
    static final double MAX_MULTIPLIER = 10;
    // 二分搜尋到區間寬度小於右端的 0.01% 為止，門檻的相對誤差遠小於 0.1%
    private static final double RELATIVE_PRECISION = 1e-4;
    // 保險用的上限：門檻很小（例如 1e-8）時也只要幾十次
    private static final int MAX_BISECTION_STEPS = 200;
    /** 過載前加密取樣的位置（過載倍率的幾倍）：c 很大時延遲只在最後 1% 急升，均分點會整段錯過。 */
    static final double[] BEFORE_OVERLOAD = {0.9, 0.95, 0.98, 0.99, 0.995, 0.999};
    // k = 0 的延遲用最大 ρ 不超過這個值的小倍率去算，排隊時間只剩處理時間的十億分之一左右
    private static final double IDLE_UTILIZATION = 1e-9;
    private static final int MAX_IDLE_STEPS = 10;

    private final Simulator simulator;

    public LoadSweep(Simulator simulator) {
        this.simulator = simulator;
    }

    /**
     * 拓撲本身有驗證錯誤時回傳 {@code valid = false}，不掃描。放大後超出參數範圍（例如 rps 超過上限）的點略過，
     * 門檻也只在算得出來的範圍內找。
     *
     * @throws IllegalArgumentException {@code maxMultiplier} 不在 (0, 10] 之內
     */
    public SweepResult sweep(Topology topology, double maxMultiplier) {
        if (!(maxMultiplier > 0 && maxMultiplier <= MAX_MULTIPLIER)) {
            throw new IllegalArgumentException("maxMultiplier must be > 0 and ≤ " + (int) MAX_MULTIPLIER);
        }
        SimulationResult current = simulator.simulate(topology);
        if (!current.valid()) {
            return SweepResult.invalid(current.errors());
        }
        double currentRps = current.summary().offeredRps();
        List<SweepPoint> grid = new ArrayList<>();
        for (int i = 0; i < POINTS; i++) {
            point(topology, maxMultiplier * i / (POINTS - 1), currentRps).ifPresent(grid::add);
        }
        if (currentRps > 0) {
            grid.set(0, withIdleLatency(grid.getFirst(), topology, currentRps));
        }
        List<SweepPoint> points = new ArrayList<>(grid);
        SweepThreshold warn = threshold(topology, grid, Status.WARN_AT, currentRps, points);
        SweepThreshold overload = threshold(topology, grid, Status.OVERLOADED_AT, currentRps, points);
        if (overload != null) {
            for (double fraction : BEFORE_OVERLOAD) {
                double multiplier = overload.multiplier() * fraction;
                // 比過載的倍率小，rps 也比算得出來的點小，一定算得出來
                if (points.stream().noneMatch(p -> p.multiplier() == multiplier)) {
                    points.add(point(topology, multiplier, currentRps).orElseThrow());
                }
            }
        }
        points.sort(Comparator.comparingDouble(SweepPoint::multiplier));
        return new SweepResult(true, List.of(), currentRps, List.copyOf(points), warn, overload);
    }

    /**
     * 最大 ρ 第一次到 {@code level} 的倍率。每個節點的 λ 隨 k 不會減少，所以最大 ρ 也不會減少：
     * 先在均分的點裡找出跨過去的那一段，再在那一段裡二分搜尋，找到的那一點加進 {@code points}，曲線的轉折才會準。
     * 範圍內都沒到就是 null。
     */
    private SweepThreshold threshold(Topology topology, List<SweepPoint> grid, double level, double currentRps,
            List<SweepPoint> points) {
        int first = 0;
        while (first < grid.size() && !reaches(grid.get(first), level)) {
            first++;
        }
        if (first == grid.size()) {
            return null;
        }
        // k = 0 時沒有流量，ρ 是 0，所以第一個到達的點前面一定還有一點
        double low = grid.get(first - 1).multiplier();
        SweepPoint crossed = grid.get(first);
        for (int i = 0; i < MAX_BISECTION_STEPS; i++) {
            double high = crossed.multiplier();
            if (high - low <= high * RELATIVE_PRECISION) {
                break;
            }
            double middle = (low + high) / 2;
            // 兩端都算得出來，中間的 rps 介於兩端之間，也算得出來
            SweepPoint point = point(topology, middle, currentRps).orElseThrow();
            if (reaches(point, level)) {
                crossed = point;
            } else {
                low = middle;
            }
        }
        SweepPoint found = crossed;
        if (points.stream().noneMatch(p -> p.multiplier() == found.multiplier())) {
            points.add(found);
        }
        return new SweepThreshold(found.multiplier(), found.totalRps(), found.busiest().nodeId());
    }

    /**
     * k = 0 沒有流量，延遲本來沒有定義；改用 k → 0 的極限，也就是每個節點都不用排隊時的延遲，曲線才不會開頭斷一截。
     * 各 Client 的權重照目前 rps 的比例。在最大 ρ 不超過 {@link #IDLE_UTILIZATION} 的小倍率算一次：
     * 流量很小時沒有 Rate Limiter 擋、也沒有節點過載，ρ 跟 k 成正比，所以照比例縮一次通常就夠；
     * 小倍率時就已經過載的（例如 rps 極大），再縮幾次。
     */
    private SweepPoint withIdleLatency(SweepPoint zero, Topology topology, double currentRps) {
        double multiplier = IDLE_UTILIZATION;
        for (int i = 0; i < MAX_IDLE_STEPS; i++) {
            Optional<SweepPoint> idle = point(topology, multiplier, currentRps);
            if (idle.isEmpty()) {
                return zero;
            }
            double utilization = idle.get().busiest() == null ? 0 : idle.get().busiest().utilization();
            if (utilization <= IDLE_UTILIZATION) {
                return new SweepPoint(zero.multiplier(), zero.totalRps(), idle.get().readMs(), idle.get().writeMs(),
                        zero.successRate(), zero.busiest());
            }
            // 縮到目標的一半，留一點浮點誤差的餘裕
            multiplier *= IDLE_UTILIZATION / utilization / 2;
        }
        return zero;
    }

    private static boolean reaches(SweepPoint point, double level) {
        return point.busiest() != null && point.busiest().utilization() >= level;
    }

    /** 放大 {@code multiplier} 倍算一次；放大後超出參數範圍時是 empty。 */
    private Optional<SweepPoint> point(Topology topology, double multiplier, double currentRps) {
        SimulationResult result = simulator.simulate(scaled(topology, multiplier));
        if (!result.valid()) {
            return Optional.empty();
        }
        Summary summary = result.summary();
        // ρ 最高的節點，和 bottleneckNodeId 同一組候選（未連線的不算）；沒有候選時為 null
        String id = summary.bottleneckNodeId();
        BusiestNode busiest = id == null ? null : new BusiestNode(id, result.nodes().get(id).utilization());
        // 各 Client 依 read 或 write 的請求數加權平均；任一 Client 沒有定義時為 null（spec 4.3）
        return Optional.of(new SweepPoint(multiplier, currentRps * multiplier, summary.avgEndToEndMs().read().ms(),
                summary.avgEndToEndMs().write().ms(), 1 - summary.dropRate(), busiest));
    }

    /** 所有 Client 的 rps 乘上 {@code multiplier}，其他節點和邊不變。 */
    private static Topology scaled(Topology topology, double multiplier) {
        List<Node> nodes = topology.nodes().stream()
                .map(node -> node instanceof ClientNode client ? client.withRps(client.rps() * multiplier) : node)
                .toList();
        return new Topology(nodes, topology.edges());
    }
}
