package simulator.engine;

import java.util.List;
import java.util.Map;

/**
 * 一次 Run 的完整結果。{@code nodes}、{@code edges} 以 id 為 key，順序與輸入相同。
 * 驗證失敗時不做任何計算：{@code nodes}、{@code edges} 為空，{@code summary} 為 null。
 */
public record SimulationResult(
        boolean valid,
        List<ValidationError> errors,
        Map<String, NodeResult> nodes,
        Map<String, EdgeResult> edges,
        Summary summary) {

    static SimulationResult invalid(List<ValidationError> errors) {
        return new SimulationResult(false, errors, Map.of(), Map.of(), null);
    }
}
