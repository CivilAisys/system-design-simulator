package simulator.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import simulator.engine.Simulator;

/** 只做 JSON ↔ engine 模型的轉換，計算全部交給 {@link Simulator}。 */
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

    @ExceptionHandler(IllegalArgumentException.class)
    ProblemDetail badRequest(IllegalArgumentException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }
}
