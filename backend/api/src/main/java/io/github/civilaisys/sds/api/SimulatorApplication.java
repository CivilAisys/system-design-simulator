package io.github.civilaisys.sds.api;

import io.github.civilaisys.sds.engine.Simulator;
import io.github.civilaisys.sds.engine.SteadyStateSimulator;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.servers.Server;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class SimulatorApplication {

    public static void main(String[] args) {
        SpringApplication.run(SimulatorApplication.class, args);
    }

    @Bean
    Simulator simulator() {
        return new SteadyStateSimulator();
    }

    @Bean
    OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("System Design Simulator API").version("v1"))
                .addServersItem(new Server().url("/"));
    }
}
