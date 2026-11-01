package at.jku.dke.dfm.editor.api;

import at.jku.dke.dfm.core.graph.DfmGraphBuilder;
import at.jku.dke.dfm.core.graph.NodeKind;
import at.jku.dke.dfm.core.models.ast.AbstractElement;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class DfmGraphMapper {
    private final DfmGraphBuilder graphBuilder = new DfmGraphBuilder();

    public DfmGraphDto map(List<AbstractElement> elements) {
        var graph = graphBuilder.build(elements);
        var nodes = graph.nodes().stream()
            .map(node -> new DfmGraphDto.Node(node.id(), node.label(), toNodeType(node.kind()),
                node.optional(), node.details()))
            .toList();
        var edges = graph.edges().stream()
            .map(edge -> new DfmGraphDto.Edge(edge.source(), edge.target(), edge.connectionType().name(),
                edge.optional()))
            .toList();
        return new DfmGraphDto(nodes, edges);
    }

    private DfmGraphDto.NodeType toNodeType(NodeKind kind) {
        return switch (kind) {
            case FACT -> DfmGraphDto.NodeType.FACT;
            case LEVEL -> DfmGraphDto.NodeType.LEVEL;
            case DESCRIPTIVE -> DfmGraphDto.NodeType.DESCRIPTIVE;
        };
    }
}
