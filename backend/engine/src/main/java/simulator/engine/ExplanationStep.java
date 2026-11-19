package simulator.engine;

import java.util.List;

/**
 * 計算說明的一步（spec 4.9），例如「使用率 ρ = {λ} ÷ ({c} × {μ})」。
 * {@code formula} 裡用大括號標出的符號是代入值，對應 {@code terms} 裡同名的項目，依出現順序排列；
 * 只有白話用到的代入值接在後面。
 *
 * @param group 步驟所屬的分組標題，例如「進來多少」「最熱那台」；同一組的步驟相鄰
 * @param value 這一步的結果；沒有定義時為 null（例如過載時的延遲）
 * @param unit {@code rps}、{@code ms}、{@code %}（0–1 的比例，顯示成百分比），沒有單位時為 null
 * @param plain 白話的一句，例如「每秒能處理 {=} = {c} × {μ}」：{@code {符號}} 代入值、{@code {=}} 這一步的結果、
 *     {@code {@符號}} 那個代入值來自的節點名稱。只在看公式顯示的步驟為 null
 * @param view 在哪一種模式顯示
 * @param requestClass read、write 各算一次的步驟是 {@link RequestClass#READ} 或 {@link RequestClass#WRITE}，
 *     前端在兩者相同時合成一行；其他為 null
 */
public record ExplanationStep(String group, String label, String formula, List<ExplanationTerm> terms, Double value,
        String unit, String plain, ExplanationView view, RequestClass requestClass) {

    /** 這一步是 read 或 write 的。 */
    ExplanationStep forClass(boolean read) {
        return new ExplanationStep(group, label, formula, terms, value, unit, plain, view,
                read ? RequestClass.READ : RequestClass.WRITE);
    }

    /** 只在白話模式顯示。 */
    ExplanationStep plainOnly() {
        return new ExplanationStep(group, label, formula, terms, value, unit, plain, ExplanationView.PLAIN,
                requestClass);
    }

    /** 只在看公式時顯示，沒有白話。 */
    ExplanationStep formulaOnly() {
        return new ExplanationStep(group, label, formula, terms, value, unit, null, ExplanationView.FORMULA,
                requestClass);
    }
}
