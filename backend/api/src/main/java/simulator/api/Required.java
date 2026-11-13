package simulator.api;

/** 必填欄位缺漏時丟 IllegalArgumentException，由 controller 回 400。 */
final class Required {

    private Required() {
    }

    static <T> T of(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException("Missing required field " + field);
        }
        return value;
    }
}
