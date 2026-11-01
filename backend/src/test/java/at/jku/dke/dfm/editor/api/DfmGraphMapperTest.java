package at.jku.dke.dfm.editor.api;

import at.jku.dke.dfm.core.parser.DfmParser;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DfmGraphMapperTest {
    @Test
    void mapsFactDimensionsAndHierarchyConnectionsToGraph() {
        var elements = new DfmParser().parse("""
            fact Sales { Revenue; {descriptive} Salesperson; };
            dimension Time { Day = Month -> Year; };
            Sales - Time;
            """);

        var graph = new DfmGraphMapper().map(elements);

        assertEquals(5, graph.nodes().size());
        assertEquals(4, graph.edges().size());
        assertFalse(graph.nodes().stream().anyMatch(node -> node.type() == DfmGraphDto.NodeType.DIMENSION));
        assertTrue(hasEdge(graph, "Sales", "Day"));
        assertTrue(graph.edges().stream().anyMatch(edge -> edge.connectionType().equals("MULTIPLE")));
        assertTrue(graph.edges().stream().anyMatch(edge -> edge.connectionType().equals("CONVERGENCE")));
        assertTrue(graph.nodes().stream().anyMatch(node -> node.type() == DfmGraphDto.NodeType.FACT
            && node.details().contains("Revenue")));
        assertTrue(graph.nodes().stream().anyMatch(node -> node.label().equals("Salesperson")
            && node.type() == DfmGraphDto.NodeType.DESCRIPTIVE));
    }

    @Test
    void reusesSharedLevelsAcrossHierarchies() {
        var elements = new DfmParser().parse("""
            fact Sales { Revenue; };
            dimension Product { product - category; product - brand; };
            Sales - Product;
            """);

        var graph = new DfmGraphMapper().map(elements);

        assertEquals(1, graph.nodes().stream().filter(node -> node.label().equals("product")).count());
        assertEquals(4, graph.nodes().size());
        assertEquals(3, graph.edges().size());
    }

    @Test
    void connectsFactOnlyToFirstHierarchy() {
        var elements = new DfmParser().parse("""
            fact Sales { Revenue; };
            dimension Product { product - category; brand - label; };
            Sales - Product;
            """);

        var graph = new DfmGraphMapper().map(elements);

        assertTrue(hasEdge(graph, "Sales", "product"));
        assertFalse(hasEdge(graph, "Sales", "brand"));
    }

    @Test
    void keepsSameNamedLevelsSeparateBetweenDimensions() {
        var elements = new DfmParser().parse("""
            fact Purchase { quantity; };
            dimension Payment { paymentDateTime - day - month - year; };
            dimension PurchaseDateTime {
                purchaseDateTime - day - month -> year;
                purchaseDateTime - day - calendarWeek -> year;
            };
            Purchase - Payment;
            Purchase - PurchaseDateTime;
            """);

        var graph = new DfmGraphMapper().map(elements);
        var monthToYear = graph.edges().stream()
            .filter(edge -> "month".equals(label(graph, edge.source()))
                && "year".equals(label(graph, edge.target())))
            .toList();

        assertEquals(2, graph.nodes().stream().filter(node -> node.label().equals("month")).count());
        assertEquals(2, graph.nodes().stream().filter(node -> node.label().equals("year")).count());
        assertEquals(2, monthToYear.size());
        assertTrue(monthToYear.stream().anyMatch(edge -> edge.connectionType().equals("SIMPLE")));
        assertTrue(monthToYear.stream().anyMatch(edge -> edge.connectionType().equals("CONVERGENCE")));
    }

    private static boolean hasEdge(DfmGraphDto graph, String sourceLabel, String targetLabel) {
        return graph.edges().stream().anyMatch(edge ->
            sourceLabel.equals(label(graph, edge.source())) && targetLabel.equals(label(graph, edge.target())));
    }

    private static String label(DfmGraphDto graph, String id) {
        return graph.nodes().stream()
            .filter(node -> node.id().equals(id))
            .map(DfmGraphDto.Node::label)
            .findFirst()
            .orElse(null);
    }
}
