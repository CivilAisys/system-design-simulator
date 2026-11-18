package simulator.engine;

/** 設定了 hotShare 的 Cache（spec 4.2.2）：最熱的那台，和其他台合起來的結果。只有一台時沒有其他台，{@code others} 為 null。 */
public record HotSpot(InstanceResult hottest, InstanceResult others) {
}
