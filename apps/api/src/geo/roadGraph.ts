import type { LatLon, OsmWay } from "../domain/types.js";
import { distanceM } from "./distance.js";

type Edge = { to: string; lengthM: number; wayName: string | null };

/**
 * Small in-process road graph (P5) built from the OSM ways within ~500 m of one
 * home. Small enough that plain Dijkstra over an array is fast.
 */
export class RoadGraph {
  private readonly nodes = new Map<string, LatLon>();
  private readonly edges = new Map<string, Edge[]>();

  constructor(ways: OsmWay[]) {
    for (const way of ways) {
      for (let i = 0; i < way.nodes.length; i++) {
        const node = way.nodes[i]!;
        this.nodes.set(node.id, node.location);
        const prev = way.nodes[i - 1];
        if (prev) {
          const lengthM = distanceM(prev.location, node.location);
          this.addEdge(prev.id, { to: node.id, lengthM, wayName: way.name });
          this.addEdge(node.id, { to: prev.id, lengthM, wayName: way.name });
        }
      }
    }
  }

  private addEdge(from: string, edge: Edge) {
    const list = this.edges.get(from);
    if (list) list.push(edge);
    else this.edges.set(from, [edge]);
  }

  get size(): number {
    return this.nodes.size;
  }

  nearestNode(point: LatLon): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, loc] of this.nodes) {
      const d = distanceM(point, loc);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Shortest path as the list of edges walked, or null if unreachable. */
  shortestPath(fromId: string, toId: string): Edge[] | null {
    if (fromId === toId) return [];
    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, { node: string; edge: Edge }>();
    const done = new Set<string>();
    while (true) {
      let current: string | null = null;
      let currentD = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < currentD) {
          current = id;
          currentD = d;
        }
      }
      if (current === null) return null;
      if (current === toId) break;
      done.add(current);
      for (const edge of this.edges.get(current) ?? []) {
        const nd = currentD + edge.lengthM;
        if (nd < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nd);
          prev.set(edge.to, { node: current, edge });
        }
      }
    }
    const path: Edge[] = [];
    let at = toId;
    while (at !== fromId) {
      const step = prev.get(at)!;
      path.unshift(step.edge);
      at = step.node;
    }
    return path;
  }

  /**
   * The road line between two points, following the shortest path through the
   * graph and starting/ending at the nearest road nodes. `reachable: false`
   * when the graph is empty or the two points aren't connected.
   */
  roadLine(from: LatLon, to: LatLon): { reachable: true; line: LatLon[] } | { reachable: false } {
    const a = this.nearestNode(from);
    const b = this.nearestNode(to);
    if (a === null || b === null) return { reachable: false };
    const path = this.shortestPath(a, b);
    if (path === null) return { reachable: false };
    return { reachable: true, line: [this.nodes.get(a)!, ...path.map((e) => this.nodes.get(e.to)!)] };
  }

  /**
   * Name of the first named street on the shortest path between two points.
   * Returns `{ reachable: false }` if no path exists, and `street: null` if the
   * path exists but none of its roads has a name in OSM.
   */
  firstStreet(from: LatLon, to: LatLon): { reachable: boolean; street: string | null } {
    const a = this.nearestNode(from);
    const b = this.nearestNode(to);
    if (a === null || b === null) return { reachable: false, street: null };
    const path = this.shortestPath(a, b);
    if (path === null) return { reachable: false, street: null };
    return { reachable: true, street: path.find((e) => e.wayName)?.wayName ?? null };
  }
}
