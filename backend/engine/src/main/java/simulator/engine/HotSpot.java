package simulator.engine;

/** 設定了 hotShare 的 Cache（spec 4.2.2）：最熱的那台，和其他台合起來的結果。 */
public record HotSpot(InstanceResult hottest, InstanceResult others) {
}
