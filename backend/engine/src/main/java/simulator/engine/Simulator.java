package simulator.engine;

/**
 * Simulator：接收一份拓撲，回傳完整的 Simulation result。這是 {@code engine} 模組唯一的公開入口。
 * 每次呼叫都是獨立計算，不保留狀態。
 */
public interface Simulator {
    SimulationResult simulate(Topology topology);
}
