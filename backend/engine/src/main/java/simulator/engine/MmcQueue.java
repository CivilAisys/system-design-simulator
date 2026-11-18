package simulator.engine;

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
                    Status.OVERLOADED, null, List.of());
            return new Outcome(result, processed);
        }

        double waitSec = erlangC(c, lambda / mu) / (cap - lambda);
        double queueMs = waitSec * 1000.0;
        var result = new NodeResult(arrival, lambda, 0, 0, null, null, cap, rho, queueMs,
                queueMs + params.serviceTimeMs(), Status.of(rho), null, List.of());
        return new Outcome(result, arrival);
    }

    /**
     * 有熱點的 Cache（spec 4.2.2）：最熱的那台單獨是一個 M/M/c（c = concurrency），分到 {@code hotShare} 的流量；
     * 其他 instances − 1 台共用一條佇列，處理剩下的流量。節點的 ρ 和狀態取 ρ 較高的一邊，處理量和丟棄量加總，
     * 延遲依流量加權平均，任一邊有流量且過載時為 null。{@code hotShare} 為 null 時所有機器共用一條佇列；
     * 有值時 instances 至少 2（TopologyValidator 檢查）。
     */
    static Outcome solve(CapacityParams params, Double hotShare, ClassRates arrival) {
        if (hotShare == null) {
            return solve(params, arrival);
        }
        Outcome hot = solve(params.withInstances(1), arrival.times(hotShare));
        Outcome rest = solve(params.withInstances(params.instances() - 1), arrival.times(1 - hotShare));
        NodeResult h = hot.result();
        NodeResult o = rest.result();
        NodeResult busiest = o.utilization() > h.utilization() ? o : h;
        double hotFlow = h.arrivalRps().total();
        double otherFlow = o.arrivalRps().total();
        double lambda = arrival.total();
        // 有流量的那一邊過載時，節點的穩態延遲沒有定義
        boolean undefined = (hotFlow > 0 && h.avgLatencyMs() == null) || (otherFlow > 0 && o.avgLatencyMs() == null);
        Double queueMs = undefined ? null : weighted(h.avgQueueMs(), hotFlow, o.avgQueueMs(), otherFlow, lambda);
        Double latencyMs = undefined ? null
                : weighted(h.avgLatencyMs(), hotFlow, o.avgLatencyMs(), otherFlow, lambda);
        var result = new NodeResult(arrival, h.throughputRps() + o.throughputRps(),
                h.droppedRps() + o.droppedRps(), 0, null, null, params.capacityRps(), busiest.utilization(), queueMs,
                latencyMs, busiest.status(), new HotSpot(InstanceResult.of(h), InstanceResult.of(o)), List.of());
        return new Outcome(result, hot.processed().plus(rest.processed()));
    }

    /** 依流量加權平均；沒有流量時用最熱那台的值（等於處理時間）。 */
    private static double weighted(Double hot, double hotFlow, Double other, double otherFlow, double total) {
        if (total <= 0) {
            return hot;
        }
        double sum = hotFlow > 0 ? hot * hotFlow : 0;
        return (sum + (otherFlow > 0 ? other * otherFlow : 0)) / total;
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
