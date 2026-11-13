package simulator.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import simulator.engine.Simulator;

/** Simulator 內部丟出的例外是程式錯誤，不能被當成使用者的格式錯誤回 400。用真的 server 才看得到 500。 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SimulateErrorStatusTest {

    @Autowired
    private TestRestTemplate rest;

    @MockitoBean
    private Simulator simulator;

    @Test
    void simulatorBugIsServerError() throws IOException {
        when(simulator.simulate(any())).thenThrow(new IllegalArgumentException("bug inside the simulator"));

        ResponseEntity<String> response = rest.postForEntity("/api/v1/simulate", json(straightTopology()),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    private String straightTopology() throws IOException {
        try (InputStream in = getClass().getResourceAsStream("/straight-topology.json")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static HttpEntity<String> json(String body) {
        var headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
