package simulator.engine;

/**
 * 計算說明裡的一個代入值（spec 4.9）。
 *
 * @param symbol 公式裡大括號中的符號
 * @param value 代入的值；沒有定義時為 null（例如下游過載時的端到端延遲）
 * @param unit 同 {@link ExplanationStep#unit()}
 * @param nodeId 這個值來自另一個節點時（上游送來的量、下游的成功率或延遲），是那個節點的 id；其他時候為 null
 */
public record ExplanationTerm(String symbol, Double value, String unit, String nodeId) {
}
