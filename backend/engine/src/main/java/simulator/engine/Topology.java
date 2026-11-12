package simulator.engine;

import java.util.List;

public record Topology(List<Node> nodes, List<Edge> edges) {
    public Topology {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
    }
}
