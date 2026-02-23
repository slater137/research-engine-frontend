import { useMemo, useState } from "react";
import GraphCanvas from "./GraphCanvas.jsx";

function normalizeBackendUrl(rawUrl) {
  const trimmed = `${rawUrl || ""}`.trim();
  if (!trimmed) {
    return "http://localhost:3000";
  }

  const withoutTrailingSlash = trimmed.replace(/\/$/, "");
  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }

  return `https://${withoutTrailingSlash.replace(/^\/+/, "")}`;
}

const BACKEND_URL = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL || "http://localhost:3000");

function toDisplayText(value, fallback = "Unknown") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return value;
}

export default function App() {
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(2);
  const [limit, setLimit] = useState(20);
  const [graph, setGraph] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const selectedNode = useMemo(() => {
    if (!graph?.nodes || !selectedNodeId) {
      return null;
    }

    return graph.nodes.find((node) => node.id === selectedNodeId) || null;
  }, [graph, selectedNodeId]);
  const isCenterSelected =
    !!selectedNode && selectedNode.id === graph?.meta?.centerWorkId;
  const relationLabel =
    selectedNode?.side === "center"
      ? "Center paper"
      : selectedNode?.side === "backward"
        ? "Reference (backward)"
        : selectedNode?.side === "forward"
          ? "Citation (forward)"
          : selectedNode?.side === "both"
            ? "Reference and citation"
            : "Unknown";

  function snapshotCurrentView() {
    if (!graph) {
      return null;
    }

    return {
      graph,
      selectedNodeId,
      depth,
      limit,
      query
    };
  }

  async function resolveQuery(nextQuery) {
    const response = await fetch(`${BACKEND_URL}/resolve?q=${encodeURIComponent(nextQuery)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Resolve failed");
    }

    return payload;
  }

  async function fetchGraph(workId, nextDepth, nextLimit) {
    const params = new URLSearchParams({
      workId,
      depth: String(nextDepth),
      limit: String(nextLimit)
    });

    const response = await fetch(`${BACKEND_URL}/graph?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Graph fetch failed");
    }

    return payload;
  }

  async function loadByWorkId(workId, options = {}) {
    const { pushHistory = false } = options;
    const snapshot = snapshotCurrentView();

    try {
      setLoading(true);
      setError("");

      const nextGraph = await fetchGraph(workId, depth, limit);
      if (pushHistory && snapshot) {
        setHistory((prev) => [...prev, snapshot]);
      }
      setGraph(nextGraph);
      setSelectedNodeId(nextGraph.meta.centerWorkId);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function onSearch(event) {
    event.preventDefault();
    if (!query.trim()) {
      setError("Enter a paper title, DOI, OpenAlex work ID, or URL.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const resolved = await resolveQuery(query.trim());
      const snapshot = snapshotCurrentView();
      const nextGraph = await fetchGraph(resolved.id, depth, limit);
      if (snapshot) {
        setHistory((prev) => [...prev, snapshot]);
      }
      setGraph(nextGraph);
      setSelectedNodeId(nextGraph.meta.centerWorkId);
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setLoading(false);
    }
  }

  async function onExpandNode() {
    if (!selectedNode?.id) {
      return;
    }

    await loadByWorkId(selectedNode.id, { pushHistory: true });
  }

  function onBack() {
    if (!history.length) {
      return;
    }

    const previous = history[history.length - 1];
    setHistory((prev) => prev.slice(0, prev.length - 1));
    setGraph(previous.graph);
    setSelectedNodeId(previous.selectedNodeId);
    setDepth(previous.depth);
    setLimit(previous.limit);
    setQuery(previous.query);
    setError("");
  }

  return (
    <div className="app-shell">
      <header className="control-bar">
        <form className="search-form" onSubmit={onSearch}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="search-input"
            placeholder="Paste title, DOI, OpenAlex work ID, or URL"
          />
          <label className="select-wrap">
            Depth
            <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <label className="select-wrap">
            Limit
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </label>
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? "Loading..." : "Search"}
          </button>
          <button type="button" className="secondary-btn" onClick={onBack} disabled={!history.length || loading}>
            Back
          </button>
        </form>
      </header>

      <main className="graph-wrap">
        {graph ? (
          <>
            <GraphCanvas graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
            <div className="graph-direction-hints" aria-hidden="true">
              <span className="direction-left">References (older)</span>
              <span className="direction-right">Cited by (newer)</span>
            </div>
            <div className="graph-legend" aria-hidden="true">
              <span><i className="legend-dot center" />Center</span>
              <span><i className="legend-dot backward" />Backward</span>
              <span><i className="legend-dot forward" />Forward</span>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h1>Research Engine</h1>
            <p>Search for a paper to render backward references and forward citations.</p>
          </div>
        )}

        <aside className="info-panel">
          <h2>Node Info</h2>
          {selectedNode ? (
            <div className="panel-content">
              <p><strong>Title:</strong> {toDisplayText(selectedNode.title)}</p>
              <p><strong>Authors:</strong> {selectedNode.authors?.join(", ") || "Unknown"}</p>
              <p><strong>Year:</strong> {toDisplayText(selectedNode.year)}</p>
              <p><strong>Role:</strong> {relationLabel}</p>
              <p><strong>Venue:</strong> {toDisplayText(selectedNode.venue)}</p>
              <p><strong>Cited by:</strong> {toDisplayText(selectedNode.cited_by_count, 0)}</p>
              <p>
                <strong>OpenAlex:</strong>{" "}
                <a href={selectedNode.openalex_url} target="_blank" rel="noreferrer">
                  View Work
                </a>
              </p>
              <button
                type="button"
                className="primary-btn expand-btn"
                onClick={onExpandNode}
                disabled={loading || isCenterSelected}
              >
                Expand node
              </button>
            </div>
          ) : (
            <p>Select a node in the graph.</p>
          )}

          {error ? <p className="error-message">{error}</p> : null}
        </aside>
      </main>
    </div>
  );
}
