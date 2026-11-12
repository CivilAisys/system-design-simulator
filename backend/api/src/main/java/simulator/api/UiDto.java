package simulator.api;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;

/** 節點在畫布上的位置。 */
@Schema(name = "NodeUi")
public record UiDto(
        @Schema(requiredMode = REQUIRED) double x,
        @Schema(requiredMode = REQUIRED) double y) {
}
