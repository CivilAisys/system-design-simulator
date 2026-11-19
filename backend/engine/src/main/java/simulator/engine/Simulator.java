package simulator.engine;

/**
 * Simulator：接收一份拓撲，回傳完整的 Simulation result。這是 {@code engine} 模組的公開入口，
 * 另一個是建在它上面的負載掃描 {@link LoadSweep}。
 * 每次呼叫都是獨立計算，不保留狀態。
 * 違反驗證規則（spec 4.5）時回傳 {@code valid = false} 的結果；
 * 節點或邊的 id 重複時丟 {@link TopologyFormatException}，因為錯誤沒辦法指到哪一個。
 */
public interface Simulator {
    SimulationResult simulate(Topology topology);
}
