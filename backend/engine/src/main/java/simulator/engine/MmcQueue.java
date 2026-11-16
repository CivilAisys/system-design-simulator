package simulator.engine;

import java.util.ArrayList;
import java.util.List;

/** 單一節點的 M/M/c 穩態計算（spec 4.2）。 */
final class MmcQueue {

    private MmcQueue() {
    }

    /** 計算節點結果，並回傳實際處理完、要往下游送的流量。 */
    static Outcome solve(CapacityParams params, ClassRates arrival) {
        long c = params.workers();
        double mu = params.serviceRate();
        double cap = params.capacityRps();
        double lambda = arrival.total();
        double rho = lambda / cap;

        if (rho >= 1.0) {
            ClassRates processed = arrival.times(cap / lambda);
            var result = new NodeResult(arrival, cap, lambda - cap, 0, null, null, cap, rho, null, null,
                    Status.OVERLOADED, null);
            return new Outcome(result, processed);
        }

        double waitSec = erlangC(c, lambda / mu) / (cap - lambda);
        double queueMs = waitSec * 1000.0;
        var result = new NodeResult(arrival, lambda, 0, 0, null, null, cap, rho, queueMs,
                queueMs + params.serviceTimeMs(), Status.of(rho), null);
        return new Outcome(result, arrival);
    }

    /**
     * 分片的節點（spec 4.2.2）：每個 shard 各自是一個 M/M/c，只有「最熱的 shard」和「其他 shard」兩種流量。
     * 節點的 ρ 和狀態取最熱的 shard，處理量和丟棄量加總，延遲依流量加權平均，任一有流量的 shard 過載時為 null。
     * 只有一個 shard 時和沒有分片完全相同。
     */
    static Outcome solve(CapacityParams params, ShardLayout layout, ClassRates arrival) {
        if (layout.count() == 1) {
            return solve(params, arrival);
        }
        int others = layout.count() - 1;
        Outcome hot = solve(params, arrival.times(layout.hottestShare()));
        Outcome other = solve(params, arrival.times(layout.otherShare()));
        NodeResult h = hot.result();
        NodeResult o = other.result();

        ClassRates processed = hot.processed().plus(other.processed().times(others));
        double lambda = arrival.total();
        double hotFlow = h.arrivalRps().total();
        double otherFlow = o.arrivalRps().total() * others;
        // 有流量的 shard 過載時，節點的穩態延遲沒有定義
        boolean undefined = h.avgLatencyMs() == null || (otherFlow > 0 && o.avgLatencyMs() == null);
        Double queueMs = undefined ? null : weighted(h.avgQueueMs(), hotFlow, o.avgQueueMs(), otherFlow, lambda);
        Double latencyMs = undefined ? null
                : weighted(h.avgLatencyMs(), hotFlow, o.avgLatencyMs(), otherFlow, lambda);

        List<ShardResult> shards = new ArrayList<>();
        shards.add(shard(h));
        for (int i = 0; i < others; i++) {
            shards.add(shard(o));
        }
        var result = new NodeResult(arrival, h.throughputRps() + o.throughputRps() * others,
                h.droppedRps() + o.droppedRps() * others, 0, null, null, params.capacityRps() * layout.count(),
                h.utilization(), queueMs, latencyMs, h.status(), List.copyOf(shards));
        return new Outcome(result, processed);
    }

    /** 依流量加權平均；沒有流量時用最熱 shard 的值（等於處理時間）。 */
    private static double weighted(double hot, double hotFlow, double other, double otherFlow, double total) {
        return total > 0 ? (hot * hotFlow + other * otherFlow) / total : hot;
    }

    private static ShardResult shard(NodeResult result) {
        return new ShardResult(result.arrivalRps(), result.throughputRps(), result.droppedRps(), result.utilization(),
                result.avgLatencyMs(), result.status());
    }

    /**
     * 等待機率 P_wait。c 可能上百，直接算 a^c / c! 會溢位，
     * 所以用 Erlang B 遞迴再轉成 Erlang C。
     */
    static double erlangC(long c, double offeredLoad) {
        double b = 1.0;
        for (long k = 1; k <= c && b > 0; k++) {
            // b 下溢成 0 之後永遠是 0，提早結束，避免 c 很大時空轉
            b = offeredLoad * b / (k + offeredLoad * b);
        }
        return c * b / (c - offeredLoad * (1 - b));
    }

    record Outcome(NodeResult result, ClassRates processed) {
    }
}
