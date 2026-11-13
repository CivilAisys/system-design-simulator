package simulator.engine;

/** 依 request class 分開的平均延遲（ms）。null 代表無定義，例如路徑上有節點過載（spec 4.3）。 */
public record ClassLatencies(Double read, Double write) {

    Double of(boolean read) {
        return read ? this.read : write;
    }
}
