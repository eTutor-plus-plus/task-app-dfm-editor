package at.jku.dke.dfm.editor.api;

import at.jku.dke.dfm.core.parser.DfmParser;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dfm")
public class DfmVisualizationController {
    private final DfmGraphMapper graphMapper;

    public DfmVisualizationController(DfmGraphMapper graphMapper) {
        this.graphMapper = graphMapper;
    }

    @PostMapping(value = "/parse", consumes = MediaType.TEXT_PLAIN_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public DfmGraphDto parse(@RequestBody String source) {
        return graphMapper.map(new DfmParser().parse(source));
    }
}
