export const STUDIO_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Goondan Studio</title>
    <link rel="stylesheet" href="/studio.css" />
  </head>
  <body>
    <div class="studio-shell">
      <aside class="left-panel">
        <div class="brand">
          <div class="brand-kicker">GOONDAN</div>
          <h1>Studio</h1>
        </div>
        <div id="instance-list" class="instance-list"></div>
      </aside>
      <main class="main-panel">
        <header class="top-bar">
          <div class="title-wrap">
            <h2 id="instance-title">인스턴스를 선택하세요</h2>
            <p id="instance-subtitle">runtime event stream</p>
          </div>
          <div class="mode-toggle">
            <button id="mode-graph" class="mode-btn is-active" type="button">Graph</button>
            <button id="mode-flow" class="mode-btn" type="button">Flow</button>
          </div>
        </header>
        <section class="visual-stage">
          <div id="graph-view" class="view is-active"></div>
          <div id="flow-view" class="view"></div>
        </section>
        <section class="detail-panel">
          <h3>Edge History</h3>
          <div id="edge-history" class="edge-history"></div>
        </section>
      </main>
    </div>
    <script type="module" src="/studio.js"></script>
  </body>
</html>
`;

export const STUDIO_CSS = `:root {
  --bg-0: #0b1326;
  --bg-1: #101c3f;
  --bg-2: #13295b;
  --panel: rgba(7, 14, 33, 0.78);
  --panel-strong: rgba(9, 20, 46, 0.94);
  --text: #e7edff;
  --muted: #9fb0dc;
  --line: rgba(145, 167, 226, 0.28);
  --line-active: #73f0d6;
  --node-agent: #ffce6e;
  --node-connector: #8eb8ff;
  --node-default: #b7c9ff;
  --accent: #7cf5de;
  --warn: #ff9f6e;
  --radius: 14px;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  font-family: "Space Grotesk", "IBM Plex Sans KR", "Noto Sans KR", sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at 10% 0%, rgba(124, 245, 222, 0.16), transparent 36%),
    radial-gradient(circle at 95% 20%, rgba(142, 184, 255, 0.22), transparent 42%),
    linear-gradient(132deg, var(--bg-0), var(--bg-1) 48%, var(--bg-2));
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.18;
  background-image:
    linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, 0.22) 25%, transparent 26%),
    linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, 0.22) 25%, transparent 26%);
  background-size: 28px 28px;
}

.studio-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  min-height: 100vh;
}

.left-panel {
  border-right: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(8, 17, 38, 0.94), rgba(8, 17, 38, 0.72));
  backdrop-filter: blur(10px);
  padding: 20px 16px;
  overflow-y: auto;
}

.brand-kicker {
  letter-spacing: 0.24em;
  font-size: 11px;
  color: var(--accent);
}

.brand h1 {
  margin: 6px 0 18px;
  font-size: 30px;
  line-height: 1;
}

.instance-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.instance-btn {
  border: 1px solid var(--line);
  background: rgba(18, 33, 68, 0.55);
  color: var(--text);
  text-align: left;
  padding: 11px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.25s ease, transform 0.2s ease, background 0.2s ease;
}

.instance-btn .status {
  font-size: 12px;
  color: var(--muted);
}

.instance-btn:hover {
  transform: translateX(2px);
  border-color: rgba(124, 245, 222, 0.62);
}

.instance-btn.is-active {
  border-color: var(--accent);
  background: rgba(26, 56, 110, 0.75);
  box-shadow: 0 0 0 1px rgba(124, 245, 222, 0.18) inset;
}

.main-panel {
  padding: 16px;
  display: grid;
  grid-template-rows: auto 1fr 170px;
  gap: 12px;
  min-width: 0;
}

.top-bar {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  backdrop-filter: blur(10px);
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.title-wrap h2 {
  margin: 0;
  font-size: 19px;
}

.title-wrap p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.mode-toggle {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 999px;
  overflow: hidden;
}

.mode-btn {
  border: 0;
  background: rgba(22, 41, 82, 0.62);
  color: var(--muted);
  padding: 7px 15px;
  cursor: pointer;
  font-weight: 600;
}

.mode-btn.is-active {
  background: rgba(124, 245, 222, 0.22);
  color: var(--text);
}

.visual-stage {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel-strong);
  overflow: hidden;
  position: relative;
}

.view {
  display: none;
  width: 100%;
  height: 100%;
  min-height: 320px;
}

.view.is-active {
  display: block;
}

.detail-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 10px 12px;
  overflow: hidden;
}

.detail-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--accent);
}

.edge-history {
  overflow: auto;
  max-height: 118px;
  font-size: 12px;
  line-height: 1.45;
}

.history-item {
  border-bottom: 1px dashed rgba(159, 176, 220, 0.25);
  padding: 5px 0;
}

.history-item:last-child {
  border-bottom: none;
}

.empty {
  color: var(--muted);
  padding: 12px;
}

.graph-wrap,
.flow-wrap {
  width: 100%;
  height: 100%;
}

.graph-svg,
.flow-svg {
  width: 100%;
  height: 100%;
}

.edge {
  stroke: var(--line);
  stroke-width: 2;
  cursor: pointer;
  transition: stroke 0.2s ease, stroke-width 0.2s ease, opacity 0.2s ease;
  opacity: 0.72;
}

.edge.is-active {
  stroke: var(--line-active);
  stroke-width: 3;
  opacity: 1;
}

.edge.is-selected {
  stroke: var(--warn);
}

.node circle {
  stroke: rgba(240, 248, 255, 0.84);
  stroke-width: 1.5;
}

.node text {
  fill: var(--text);
  font-size: 12px;
  text-anchor: middle;
}

.node.kind-agent circle {
  fill: var(--node-agent);
}

.node.kind-connector circle {
  fill: var(--node-connector);
}

.node.kind-other circle {
  fill: var(--node-default);
}

.node.is-active circle {
  filter: drop-shadow(0 0 6px rgba(124, 245, 222, 0.78));
}

.flow-wrap {
  overflow: auto;
}

.flow-label {
  fill: var(--muted);
  font-size: 11px;
}

.flow-event {
  fill: var(--text);
  font-size: 11px;
}

.flow-lane {
  stroke: rgba(142, 184, 255, 0.25);
  stroke-width: 1;
}

.flow-arc {
  stroke: rgba(115, 240, 214, 0.85);
  stroke-width: 2;
  fill: none;
}

.event-particle {
  fill: #ffffff;
  filter: drop-shadow(0 0 6px rgba(124, 245, 222, 0.9));
}

@media (max-width: 920px) {
  .studio-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .left-panel {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    max-height: 210px;
  }

  .main-panel {
    grid-template-rows: auto 1fr 180px;
  }
}
`;

export const STUDIO_JS = `const state = {
  mode: "graph",
  instances: [],
  selectedInstanceKey: null,
  visualization: null,
  selectedEdgeKey: null,
  pollTimer: null,
};

const els = {
  list: document.getElementById("instance-list"),
  title: document.getElementById("instance-title"),
  subtitle: document.getElementById("instance-subtitle"),
  graphView: document.getElementById("graph-view"),
  flowView: document.getElementById("flow-view"),
  edgeHistory: document.getElementById("edge-history"),
  modeGraph: document.getElementById("mode-graph"),
  modeFlow: document.getElementById("mode-flow"),
};

function createSvgEl(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

function setMode(next) {
  state.mode = next;
  const isGraph = next === "graph";
  els.graphView.classList.toggle("is-active", isGraph);
  els.flowView.classList.toggle("is-active", !isGraph);
  els.modeGraph.classList.toggle("is-active", isGraph);
  els.modeFlow.classList.toggle("is-active", !isGraph);
  renderVisualization();
}

function formatTs(iso) {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function eventKey(event) {
  return [event.at, event.source, event.target || "", event.subtype, event.detail].join("|");
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("request failed: " + res.status);
  }
  return await res.json();
}

async function refreshInstances() {
  const payload = await fetchJson("/api/instances");
  state.instances = Array.isArray(payload.items) ? payload.items : [];
  if (!state.selectedInstanceKey && state.instances.length > 0) {
    state.selectedInstanceKey = state.instances[0].key;
  }
  if (
    state.selectedInstanceKey &&
    !state.instances.some((item) => item.key === state.selectedInstanceKey)
  ) {
    state.selectedInstanceKey = state.instances.length > 0 ? state.instances[0].key : null;
  }
  renderInstanceList();
}

async function refreshVisualization() {
  if (!state.selectedInstanceKey) {
    state.visualization = null;
    renderVisualization();
    return;
  }

  const key = encodeURIComponent(state.selectedInstanceKey);
  const payload = await fetchJson("/api/instances/" + key + "/visualization");
  state.visualization = payload;
  renderVisualization();
}

function renderInstanceList() {
  els.list.innerHTML = "";
  if (state.instances.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "실행 중인 인스턴스가 없습니다.";
    els.list.appendChild(empty);
    return;
  }

  for (const item of state.instances) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "instance-btn";
    if (item.key === state.selectedInstanceKey) {
      button.classList.add("is-active");
    }

    const title = document.createElement("div");
    title.textContent = item.key;
    const meta = document.createElement("div");
    meta.className = "status";
    meta.textContent = (item.status || "unknown") + " / " + (item.agent || "orchestrator");

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("click", () => {
      state.selectedInstanceKey = item.key;
      state.selectedEdgeKey = null;
      renderInstanceList();
      void refreshVisualization();
    });
    els.list.appendChild(button);
  }
}

function renderEdgeHistory() {
  els.edgeHistory.innerHTML = "";
  const viz = state.visualization;
  if (!viz || !state.selectedEdgeKey) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "간선을 선택하면 이벤트 이력이 표시됩니다.";
    els.edgeHistory.appendChild(empty);
    return;
  }

  const target = (viz.interactions || []).find((edge) => edge.key === state.selectedEdgeKey);
  if (!target || !Array.isArray(target.history) || target.history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "이력 데이터가 없습니다.";
    els.edgeHistory.appendChild(empty);
    return;
  }

  for (const item of target.history) {
    const row = document.createElement("div");
    row.className = "history-item";
    row.textContent =
      formatTs(item.at) +
      "  " +
      item.direction +
      "  " +
      item.kind +
      "  " +
      (item.detail || "");
    els.edgeHistory.appendChild(row);
  }
}

function renderVisualization() {
  const viz = state.visualization;
  if (!viz) {
    els.title.textContent = "인스턴스를 선택하세요";
    els.subtitle.textContent = "runtime event stream";
    els.graphView.innerHTML = "<div class='empty'>데이터가 없습니다.</div>";
    els.flowView.innerHTML = "<div class='empty'>데이터가 없습니다.</div>";
    renderEdgeHistory();
    return;
  }

  els.title.textContent = viz.instanceKey || "instance";
  const participantCount = Array.isArray(viz.participants) ? viz.participants.length : 0;
  const eventCount = Array.isArray(viz.timeline) ? viz.timeline.length : 0;
  els.subtitle.textContent = "participants " + participantCount + " / events " + eventCount;

  if (state.mode === "graph") {
    renderGraph(viz);
  } else {
    renderFlow(viz);
  }
  renderEdgeHistory();
}

function pickGraphParticipants(participants) {
  const list = participants.filter((item) => item.kind === "agent" || item.kind === "connector");
  if (list.length > 0) {
    return list;
  }
  return participants;
}

function renderGraph(viz) {
  const participants = Array.isArray(viz.participants) ? pickGraphParticipants(viz.participants) : [];
  const interactions = Array.isArray(viz.interactions) ? viz.interactions : [];
  const recentEvents = Array.isArray(viz.recentEvents) ? viz.recentEvents : [];

  if (participants.length === 0) {
    els.graphView.innerHTML = "<div class='empty'>표시할 participant가 없습니다.</div>";
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "graph-wrap";
  const svg = createSvgEl("svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("viewBox", "0 0 1000 600");

  const centerX = 500;
  const centerY = 300;
  const radius = Math.max(170, Math.min(250, 70 + participants.length * 18));
  const positions = new Map();

  participants.forEach((node, index) => {
    const ratio = (Math.PI * 2 * index) / participants.length;
    const x = centerX + Math.cos(ratio) * radius;
    const y = centerY + Math.sin(ratio) * radius;
    positions.set(node.id, { x, y, item: node });
  });

  const edgeLayer = createSvgEl("g");
  const nodeLayer = createSvgEl("g");
  const fxLayer = createSvgEl("g");
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);
  svg.appendChild(fxLayer);

  const edgePathByKey = new Map();
  for (const edge of interactions) {
    const from = positions.get(edge.a);
    const to = positions.get(edge.b);
    if (!from || !to) {
      continue;
    }
    const line = createSvgEl("line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("class", "edge");
    if (state.selectedEdgeKey === edge.key) {
      line.classList.add("is-selected");
    }
    line.addEventListener("click", () => {
      state.selectedEdgeKey = edge.key;
      renderVisualization();
    });
    edgeLayer.appendChild(line);
    edgePathByKey.set(edge.key, {
      path: "M " + from.x + " " + from.y + " L " + to.x + " " + to.y,
      line,
      from: edge.a,
      to: edge.b,
    });
  }

  const activeNodes = new Set();
  const activeEdges = new Set();
  for (const event of recentEvents) {
    const source = event.source;
    const target = event.target || "";
    activeNodes.add(source);
    if (target) {
      activeNodes.add(target);
      for (const edge of interactions) {
        if (
          (edge.a === source && edge.b === target) ||
          (edge.a === target && edge.b === source)
        ) {
          activeEdges.add(edge.key);
        }
      }
    }
  }

  for (const edge of interactions) {
    const edgeInfo = edgePathByKey.get(edge.key);
    if (!edgeInfo) {
      continue;
    }
    if (activeEdges.has(edge.key)) {
      edgeInfo.line.classList.add("is-active");
    }
  }

  for (const node of participants) {
    const point = positions.get(node.id);
    if (!point) {
      continue;
    }
    const g = createSvgEl("g");
    g.setAttribute("class", "node");
    if (node.kind === "agent") {
      g.classList.add("kind-agent");
    } else if (node.kind === "connector") {
      g.classList.add("kind-connector");
    } else {
      g.classList.add("kind-other");
    }
    if (activeNodes.has(node.id)) {
      g.classList.add("is-active");
    }

    const circle = createSvgEl("circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", "28");
    const text = createSvgEl("text");
    text.setAttribute("x", String(point.x));
    text.setAttribute("y", String(point.y + 4));
    text.textContent = node.label.length > 16 ? node.label.slice(0, 16) + "…" : node.label;

    g.appendChild(circle);
    g.appendChild(text);
    nodeLayer.appendChild(g);
  }

  for (const event of recentEvents) {
    if (!event.target) {
      continue;
    }
    let hit = null;
    for (const edge of interactions) {
      if (
        (edge.a === event.source && edge.b === event.target) ||
        (edge.a === event.target && edge.b === event.source)
      ) {
        hit = edgePathByKey.get(edge.key) || null;
        break;
      }
    }
    if (!hit) {
      continue;
    }

    const dot = createSvgEl("circle");
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "event-particle");
    const motion = createSvgEl("animateMotion");
    motion.setAttribute("dur", "1.1s");
    motion.setAttribute("repeatCount", "1");
    motion.setAttribute("path", hit.path);
    dot.appendChild(motion);
    fxLayer.appendChild(dot);
  }

  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);
  svg.appendChild(fxLayer);
  wrap.appendChild(svg);
  els.graphView.innerHTML = "";
  els.graphView.appendChild(wrap);
}

function renderFlow(viz) {
  const timeline = Array.isArray(viz.timeline) ? viz.timeline : [];
  const participants = Array.isArray(viz.participants) ? viz.participants : [];
  if (participants.length === 0) {
    els.flowView.innerHTML = "<div class='empty'>표시할 participant가 없습니다.</div>";
    return;
  }

  const laneWidth = 180;
  const topPad = 42;
  const rowGap = 62;
  const lanes = participants.slice(0, 10);
  const width = Math.max(760, laneWidth * lanes.length);
  const height = Math.max(280, topPad + timeline.length * rowGap + 40);
  const laneById = new Map(lanes.map((item, index) => [item.id, index]));

  const wrap = document.createElement("div");
  wrap.className = "flow-wrap";
  const svg = createSvgEl("svg");
  svg.setAttribute("class", "flow-svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");

  const defs = createSvgEl("defs");
  const marker = createSvgEl("marker");
  marker.setAttribute("id", "arrowHead");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "4");
  marker.setAttribute("orient", "auto");
  const arrowPath = createSvgEl("path");
  arrowPath.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
  arrowPath.setAttribute("fill", "#73f0d6");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  lanes.forEach((lane, index) => {
    const x = laneWidth * index + laneWidth / 2;
    const label = createSvgEl("text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", "22");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "flow-label");
    label.textContent = lane.label;
    svg.appendChild(label);

    const laneLine = createSvgEl("line");
    laneLine.setAttribute("x1", String(x));
    laneLine.setAttribute("y1", "28");
    laneLine.setAttribute("x2", String(x));
    laneLine.setAttribute("y2", String(height - 12));
    laneLine.setAttribute("class", "flow-lane");
    svg.appendChild(laneLine);
  });

  timeline.slice(-120).forEach((event, index) => {
    const y = topPad + index * rowGap;
    const sourceIndex = laneById.has(event.source) ? laneById.get(event.source) : 0;
    const targetIndex = laneById.has(event.target) ? laneById.get(event.target) : sourceIndex;
    const sx = laneWidth * sourceIndex + laneWidth / 2;
    const tx = laneWidth * targetIndex + laneWidth / 2;

    const arc = createSvgEl("path");
    const midY = y - 18;
    arc.setAttribute("d", "M " + sx + " " + y + " Q " + (sx + tx) / 2 + " " + midY + " " + tx + " " + y);
    arc.setAttribute("class", "flow-arc");
    arc.setAttribute("marker-end", "url(#arrowHead)");
    svg.appendChild(arc);

    const label = createSvgEl("text");
    label.setAttribute("x", String((sx + tx) / 2));
    label.setAttribute("y", String(y - 6));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "flow-event");
    const detail = event.detail || "";
    const text = formatTs(event.at) + " · " + event.subtype + " · " + detail;
    label.textContent = text.length > 80 ? text.slice(0, 80) + "…" : text;
    svg.appendChild(label);
  });

  wrap.appendChild(svg);
  els.flowView.innerHTML = "";
  els.flowView.appendChild(wrap);
}

async function tick() {
  try {
    await refreshInstances();
    await refreshVisualization();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.subtitle.textContent = "polling failed: " + message;
  }
}

function startPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.pollTimer = setInterval(() => {
    void tick();
  }, 1000);
}

els.modeGraph.addEventListener("click", () => setMode("graph"));
els.modeFlow.addEventListener("click", () => setMode("flow"));

void tick();
startPolling();
`;
