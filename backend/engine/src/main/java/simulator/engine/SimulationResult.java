package simulator.engine;

import java.util.List;
import java.util.Map;

/** 一次 Run 的完整結果。{@code nodes}、{@code edges} 以 id 為 key，順序與輸入相同。 */
public record SimulationResult(
        boolean valid,
        List<ValidationError> errors,
        Map<String, NodeResult> nodes,
        Map<String, EdgeResult> edges,
        Summary summary) {
}
