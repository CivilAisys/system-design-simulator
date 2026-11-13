package simulator.engine;

/**
 * Simulator：接收一份拓撲，回傳完整的 Simulation result。這是 {@code engine} 模組唯一的公開入口。
 * 每次呼叫都是獨立計算，不保留狀態。
 * 違反驗證規則（spec 4.5）時回傳 {@code valid = false} 的結果；
 * 節點或邊的 id 重複時丟 IllegalArgumentException，因為錯誤沒辦法指到哪一個。
 */
public interface Simulator {
    SimulationResult simulate(Topology topology);
}
