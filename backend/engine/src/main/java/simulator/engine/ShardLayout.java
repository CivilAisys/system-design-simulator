package simulator.engine;

/**
 * 分片配置（spec 4.2.2）：資料切成 {@code count} 份，每個 shard 都套用節點的處理能力參數。
 * 最熱的 shard 分到 {@code hotShare} 的流量（null 時平均分配，1/N），其他 shard 平分剩下的。
 */
public record ShardLayout(int count, Double hotShare) {

    /** 沒有分片。 */
    public static final ShardLayout SINGLE = new ShardLayout(1, null);

    /** 最熱的 shard 分到的流量比例。 */
    public double hottestShare() {
        return hotShare != null ? hotShare : 1.0 / count;
    }

    /** 其他每個 shard 分到的流量比例；只有一個 shard 時為 0。 */
    public double otherShare() {
        return count > 1 ? (1 - hottestShare()) / (count - 1) : 0;
    }
}
