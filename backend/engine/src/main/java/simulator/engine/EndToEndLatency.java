package simulator.engine;

import java.util.List;

/**
 * 一個 request class 的端到端延遲（spec 4.3）。
 *
 * @param ms 平均延遲；無定義時為 null，原因見 {@code undefinedReason}
 * @param approximate 路徑上有平行呼叫多個下游，平均值的最大值會低估真實延遲；{@code ms} 為 null 時一定是 false
 * @param overloadedNodeIds 這個 class 實際會走到、而且過載的節點，依輸入順序
 * @param undefinedReason {@code ms} 為 null 的原因；有值時為 null
 */
public record EndToEndLatency(Double ms, boolean approximate, List<String> overloadedNodeIds,
        UndefinedReason undefinedReason) {

    static EndToEndLatency of(double ms, boolean approximate) {
        return new EndToEndLatency(ms, approximate, List.of(), null);
    }

    static EndToEndLatency undefined(UndefinedReason reason, List<String> overloadedNodeIds) {
        return new EndToEndLatency(null, false, overloadedNodeIds, reason);
    }
}
