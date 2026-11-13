package simulator.engine;

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
            var result = new NodeResult(arrival, cap, lambda - cap, null, null, cap, rho, null, null, Status.OVERLOADED);
            return new Outcome(result, processed);
        }

        double waitSec = erlangC(c, lambda / mu) / (cap - lambda);
        double queueMs = waitSec * 1000.0;
        var result = new NodeResult(arrival, lambda, 0, null, null, cap, rho, queueMs, queueMs + params.serviceTimeMs(),
                Status.of(rho));
        return new Outcome(result, arrival);
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
