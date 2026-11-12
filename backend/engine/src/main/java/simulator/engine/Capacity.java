package simulator.engine;

/** 可處理請求的節點共用的處理能力參數（M/M/c）。 */
public record Capacity(int instances, int concurrency, double serviceTimeMs) {

    /** 總 worker 數 c = instances × concurrency。 */
    public int workers() {
        return instances * concurrency;
    }

    /** 每個 worker 的服務率 μ（req/s）。 */
    public double serviceRate() {
        return 1000.0 / serviceTimeMs;
    }

    /** 容量 c × μ（req/s）。 */
    public double rps() {
        return workers() * serviceRate();
    }
}
