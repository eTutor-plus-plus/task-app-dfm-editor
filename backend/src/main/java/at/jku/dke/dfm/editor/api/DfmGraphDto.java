package at.jku.dke.dfm.editor.api;

import java.util.List;

public record DfmGraphDto(List<Node> nodes, List<Edge> edges) {
    public enum NodeType {
        FACT, DIMENSION, LEVEL, DESCRIPTIVE
    }

    public record Node(String id, String label, NodeType type, boolean optional, List<String> details) {
    }

    public record Edge(String source, String target, String connectionType, boolean optional) {
    }
}
