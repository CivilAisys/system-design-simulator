package simulator.engine;

/** 計算說明的一步在哪一種模式顯示（spec 4.9）：預設的白話，或打開「看公式」之後。 */
public enum ExplanationView {
    /** 兩種模式都顯示：白話一句，看公式時底下多一行公式。 */
    BOTH,
    /** 只在白話模式，例如排隊合併成的那一步。 */
    PLAIN,
    /** 只在看公式時，例如 Erlang C 的中間值。 */
    FORMULA
}
