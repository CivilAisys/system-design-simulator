package simulator.engine;

/**
 * 流量來源：每秒送出 {@code rps} 個請求，其中 {@code readRatio} 是 read。
 * {@code readResponseBytes}、{@code writeRequestBytes} 只用來估算使用者端頻寬（spec 4.7）。
 */
public record ClientNode(String id, String name, NodeHealth health, double rps, double readRatio,
        double readResponseBytes, double writeRequestBytes) implements Node {

    public static final double DEFAULT_READ_RESPONSE_BYTES = 10_000;
    public static final double DEFAULT_WRITE_REQUEST_BYTES = 1_000;

    /** 回應和上傳的大小用預設值。 */
    public ClientNode(String id, String name, NodeHealth health, double rps, double readRatio) {
        this(id, name, health, rps, readRatio, DEFAULT_READ_RESPONSE_BYTES, DEFAULT_WRITE_REQUEST_BYTES);
    }
}
