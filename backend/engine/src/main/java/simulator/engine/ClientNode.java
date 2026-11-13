package simulator.engine;

/** 流量來源：每秒送出 {@code rps} 個請求，其中 {@code readRatio} 是 read。 */
public record ClientNode(String id, String name, NodeHealth health, double rps, double readRatio) implements Node {
}
