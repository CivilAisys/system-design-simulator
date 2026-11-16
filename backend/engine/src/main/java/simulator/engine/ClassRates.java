package simulator.engine;

/** 依 request class 分開的每秒請求數。 */
public record ClassRates(double read, double write) {

    public static final ClassRates ZERO = new ClassRates(0, 0);

    /** read 或 write 的值。 */
    public double of(boolean read) {
        return read ? this.read : write;
    }

    public double total() {
        return read + write;
    }

    public ClassRates plus(ClassRates other) {
        return new ClassRates(read + other.read, write + other.write);
    }

    public ClassRates times(double factor) {
        return new ClassRates(read * factor, write * factor);
    }
}
