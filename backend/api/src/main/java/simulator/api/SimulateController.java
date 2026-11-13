package simulator.api;

import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import simulator.engine.Simulator;
import simulator.engine.TopologyFormatException;

/**
 * 只做 JSON ↔ {@code engine} 模組型別的轉換，計算全部交給 {@link Simulator}。
 * 格式錯誤（spec 4.5）回 400；其他例外是程式錯誤，交給 Spring 回 500。
 */
@RestController
@RequestMapping("/api/v1")
class SimulateController {

    private final Simulator simulator;

    SimulateController(Simulator simulator) {
        this.simulator = simulator;
    }

    @PostMapping("/simulate")
    SimulationResponse simulate(@RequestBody TopologyDto topology) {
        return SimulationResponse.from(simulator.simulate(topology.toTopology()));
    }

    @ExceptionHandler(TopologyFormatException.class)
    ProblemDetail badRequest(TopologyFormatException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    /** JSON 解析失敗或欄位型別不符（{@link SimulatorApplication#strictJsonCoercion} 關掉了型別轉換）。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ProblemDetail unreadable(HttpMessageNotReadableException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, unreadableMessage(e.getCause()));
    }

    // 不直接用 Jackson 的訊息：裡面有 Java 類別名稱，前端使用者看不懂
    private static String unreadableMessage(Throwable cause) {
        if (!(cause instanceof JsonMappingException mapping) || mapping.getPath().isEmpty()) {
            return "Malformed JSON";
        }
        String field = mapping.getPath().stream()
                .map(ref -> ref.getFieldName() != null ? "." + ref.getFieldName() : "[" + ref.getIndex() + "]")
                .collect(Collectors.joining())
                .substring(1);
        String expected = cause instanceof MismatchedInputException mismatch ? expected(mismatch.getTargetType()) : null;
        return "Invalid value for " + field + (expected != null ? ", expected " + expected : "");
    }

    private static String expected(Class<?> type) {
        if (type == null) {
            return null;
        }
        if (type == Integer.class || type == int.class) {
            return "an integer";
        }
        if (type == Double.class || type == double.class) {
            return "a number";
        }
        if (type == String.class) {
            return "a string";
        }
        if (type.isEnum()) {
            return "one of " + Arrays.stream(type.getEnumConstants()).map(Object::toString).toList();
        }
        if (List.class.isAssignableFrom(type)) {
            return "an array";
        }
        return null;
    }
}
