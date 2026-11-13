package simulator.engine;

/** 依 request class 分開的端到端延遲。 */
public record ClassLatencies(EndToEndLatency read, EndToEndLatency write) {

    EndToEndLatency of(boolean read) {
        return read ? this.read : write;
    }
}
