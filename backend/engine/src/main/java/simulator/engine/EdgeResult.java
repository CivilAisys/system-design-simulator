package simulator.engine;

/**
 * {@code backlogRps} 只有 Message Queue 的下游邊（consumer group）會大於 0：
 * consumer 處理不完的訊息留在 queue 裡，backlog 每秒增加的筆數（spec 4.2.4）。
 * {@code bandwidth} 只有 Client 的邊有（spec 4.7），其他邊為 null。
 */
public record EdgeResult(ClassRates rps, double backlogRps, Bandwidth bandwidth) {

    public EdgeResult(ClassRates rps) {
        this(rps, 0, null);
    }

    public EdgeResult withBacklog(double backlogRps) {
        return new EdgeResult(rps, backlogRps, bandwidth);
    }
}
