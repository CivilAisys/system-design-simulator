package simulator.engine;

/**
 * 可處理請求的節點共用的處理能力參數（M/M/c，spec 3.2）。
 * 由這些參數推導出 Capacity（最大 req/s），見 {@link #capacityRps()}。
 */
public record CapacityParams(int instances, int concurrency, double serviceTimeMs) {

    /** 總 worker 數 c = instances × concurrency。 */
    public long workers() {
        return (long) instances * concurrency;
    }

    /** 每個 worker 的服務率 μ（req/s）。 */
    public double serviceRate() {
        return 1000.0 / serviceTimeMs;
    }

    /** Capacity（容量）c × μ：每秒最多能處理的請求數。 */
    public double capacityRps() {
        return workers() * serviceRate();
    }
}
