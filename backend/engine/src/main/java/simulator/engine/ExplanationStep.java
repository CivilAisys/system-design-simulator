package simulator.engine;

import java.util.List;

/**
 * 計算說明的一步（spec 4.9），例如「使用率 ρ = {λ} ÷ ({c} × {μ})」。
 * {@code formula} 裡用大括號標出的符號是代入值，對應 {@code terms} 裡同名的項目，依出現順序排列。
 *
 * @param group 步驟所屬的分組標題，例如「到達量」「最熱那台」；同一組的步驟相鄰
 * @param value 這一步的結果；沒有定義時為 null（例如過載時的延遲）
 * @param unit {@code rps}、{@code ms}、{@code %}（0–1 的比例，顯示成百分比），沒有單位時為 null
 */
public record ExplanationStep(String group, String label, String formula, List<ExplanationTerm> terms, Double value,
        String unit) {
}
