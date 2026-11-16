package simulator.engine;

/**
 * 使用者端頻寬（bytes/s，spec 4.7）：{@code egress} 是 read 回應送給使用者的流量，
 * {@code ingress} 是 write 從使用者上傳的流量。
 */
public record Bandwidth(double egressBytesPerSec, double ingressBytesPerSec) {

    public static final Bandwidth ZERO = new Bandwidth(0, 0);

    public Bandwidth plus(Bandwidth other) {
        return new Bandwidth(egressBytesPerSec + other.egressBytesPerSec,
                ingressBytesPerSec + other.ingressBytesPerSec);
    }
}
