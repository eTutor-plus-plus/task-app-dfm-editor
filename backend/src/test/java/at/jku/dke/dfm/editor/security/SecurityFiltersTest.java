package at.jku.dke.dfm.editor.security;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "dfm.editor.max-request-bytes=100")
@AutoConfigureMockMvc
class SecurityFiltersTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void rejectsOversizedBody() throws Exception {
        mockMvc.perform(post("/api/dfm/parse").contentType(MediaType.TEXT_PLAIN).content("x".repeat(101)))
            .andExpect(status().isPayloadTooLarge());
    }

    @Test
    void addsSecurityHeaders() throws Exception {
        mockMvc.perform(post("/api/dfm/parse").contentType(MediaType.TEXT_PLAIN).content("x".repeat(101)))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().exists("Content-Security-Policy"));
    }
}
