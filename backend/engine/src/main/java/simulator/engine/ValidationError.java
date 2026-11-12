package simulator.engine;

/** 拓撲驗證錯誤，附上有問題的 {@code nodeId} 或 {@code edgeId}（另一個為 null）。 */
public record ValidationError(String code, String message, String nodeId, String edgeId) {
}
