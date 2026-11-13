package simulator.api;

import simulator.engine.TopologyFormatException;

/** 必填欄位缺漏時丟 {@link TopologyFormatException}，由 controller 回 400。 */
final class Required {

    private Required() {
    }

    static <T> T of(T value, String field) {
        if (value == null) {
            throw new TopologyFormatException("Missing required field " + field);
        }
        return value;
    }
}
