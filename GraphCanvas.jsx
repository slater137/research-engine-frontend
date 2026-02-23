import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Stars } from "@react-three/drei";

function hashToUnit(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (b.cited_by_count !== a.cited_by_count) {
      return b.cited_by_count - a.cited_by_count;
    }
    return a.id.localeCompare(b.id);
  });
}

function nodeRadius(node) {
  return Math.max(0.45, (Number(node?.size) || 0) * 0.11);
}

function nodeBucket(node) {
  if (node.side === "backward") return "left";
  if (node.side === "forward") return "right";
  if (node.side === "center") return "center";
  return "other";
}

function relaxCollisions(nodes, positions, centerId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const working = new Map();
  const anchor = new Map();

  nodes.forEach((node) => {
    const current = positions.get(node.id);
    if (!current) {
      return;
    }
    const copy = [...current];
    working.set(node.id, copy);
    anchor.set(node.id, [...current]);
  });

  const ids = nodes.map((node) => node.id).filter((id) => working.has(id));
  const iterations = 120;
  const padding = 0.35;
  const springStrength = 0.065;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let hadOverlap = false;

    for (let i = 0; i < ids.length; i += 1) {
      const aId = ids[i];
      const nodeA = byId.get(aId);
      const posA = working.get(aId);
      if (!nodeA || !posA) continue;

      for (let j = i + 1; j < ids.length; j += 1) {
        const bId = ids[j];
        const nodeB = byId.get(bId);
        const posB = working.get(bId);
        if (!nodeB || !posB) continue;

        const bucketA = nodeBucket(nodeA);
        const bucketB = nodeBucket(nodeB);
        if (bucketA !== "center" && bucketB !== "center" && bucketA !== bucketB) {
          continue;
        }

        const dx = posB[0] - posA[0];
        const dy = posB[1] - posA[1];
        const dz = posB[2] - posA[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minimum = nodeRadius(nodeA) + nodeRadius(nodeB) + padding;
        if (distance >= minimum) {
          continue;
        }

        hadOverlap = true;
        const overlap = minimum - Math.max(distance, 0.0001);
        let pushY = dy;
        let pushZ = dz;
        const yzLength = Math.hypot(pushY, pushZ);

        if (yzLength < 0.0001) {
          const seed = hashToUnit(`${aId}:${bId}`) * Math.PI * 2;
          pushY = Math.cos(seed);
          pushZ = Math.sin(seed);
        } else {
          pushY /= yzLength;
          pushZ /= yzLength;
        }

        const half = overlap / 2;
        if (aId !== centerId) {
          posA[1] -= pushY * half;
          posA[2] -= pushZ * half;
        }
        if (bId !== centerId) {
          posB[1] += pushY * half;
          posB[2] += pushZ * half;
        }
      }
    }

    ids.forEach((id) => {
      if (id === centerId) return;
      const current = working.get(id);
      const base = anchor.get(id);
      if (!current || !base) return;

      current[1] = current[1] * (1 - springStrength) + base[1] * springStrength;
      current[2] = current[2] * (1 - springStrength) + base[2] * springStrength;
    });

    if (!hadOverlap) {
      break;
    }
  }

  ids.forEach((id) => {
    const next = working.get(id);
    if (next) {
      positions.set(id, next);
    }
  });
}

function layoutNodes(nodes, links, centerId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenBySourceType = new Map();
  const maxDepth = Math.max(
    1,
    ...nodes.map((node) => (Number.isFinite(node.depth) ? Number(node.depth) : 0))
  );

  for (const link of links) {
    const key = `${link.source}::${link.type}`;
    if (!childrenBySourceType.has(key)) {
      childrenBySourceType.set(key, []);
    }
    childrenBySourceType.get(key).push(link.target);
  }

  const positions = new Map();
  positions.set(centerId, [0, 0, 0]);

  function placeSubtree(parentId, sideType, sign, depth, parentY, visited) {
    if (depth > maxDepth) {
      return;
    }

    const key = `${parentId}::${sideType}`;
    const childIds = [...new Set(childrenBySourceType.get(key) || [])];
    const children = sortNodes(
      childIds
        .map((id) => byId.get(id))
        .filter(Boolean)
    );

    if (!children.length) {
      return;
    }

    const depthSpacingX = 10;
    const spacingPadding = 0.45;
    const radii = children.map((child) => nodeRadius(child));
    const totalSpan = radii.reduce((sum, radius) => sum + radius * 2, 0) + spacingPadding * (children.length - 1);
    let cursor = -totalSpan / 2;

    children.forEach((child, index) => {
      const radius = radii[index];
      const y = parentY + cursor + radius;
      const x = sign * depthSpacingX * depth;
      const z = (hashToUnit(child.id) - 0.5) * 4.2;

      if (!positions.has(child.id)) {
        positions.set(child.id, [x, y, z]);
      }

      if (!visited.has(child.id)) {
        const nextVisited = new Set(visited);
        nextVisited.add(child.id);
        placeSubtree(child.id, sideType, sign, depth + 1, y, nextVisited);
      }

      cursor += radius * 2 + spacingPadding;
    });
  }

  placeSubtree(centerId, "references", -1, 1, 0, new Set([centerId]));
  placeSubtree(centerId, "cited_by", 1, 1, 0, new Set([centerId]));

  const unplaced = nodes.filter((node) => !positions.has(node.id));
  unplaced.forEach((node, idx) => {
    const side = node.side === "backward" ? -1 : node.side === "forward" ? 1 : 0;
    const depth = Math.max(1, Number(node.depth) || 1);
    const x = side * depth * 10;
    const y = (idx % 8) * 1.6 - 5.5;
    const z = (hashToUnit(node.id) - 0.5) * 4.8;
    positions.set(node.id, [x, y, z]);
  });

  relaxCollisions(nodes, positions, centerId);
  return positions;
}

function nodeColor(node) {
  if (node.side === "center") return "#ffd166";
  if (node.side === "backward") return "#4dd0e1";
  if (node.side === "forward") return "#ff8a65";
  return "#e6ee9c";
}

function linkColor(link) {
  return link.type === "references" ? "#2dc7e0" : "#ff7043";
}

function GraphNode({ node, position, selected, onSelect }) {
  const radius = nodeRadius(node);
  const color = nodeColor(node);

  return (
    <mesh position={position} onClick={(event) => {
      event.stopPropagation();
      onSelect(node.id);
    }}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={selected ? 0.85 : 0.42}
        roughness={0.25}
        metalness={0.18}
      />
    </mesh>
  );
}

export default function GraphCanvas({ graph, selectedNodeId, onSelectNode }) {
  const centerId = graph?.meta?.centerWorkId || null;
  const positions = useMemo(() => {
    if (!graph?.nodes || !centerId) {
      return new Map();
    }
    return layoutNodes(graph.nodes, graph.links || [], centerId);
  }, [graph, centerId]);

  return (
    <Canvas
      camera={{ position: [0, 0, 34], fov: 50 }}
      onPointerMissed={() => onSelectNode(null)}
    >
      <color attach="background" args={["#03050e"]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[8, 6, 10]} intensity={0.9} color="#9ed4ff" />
      <pointLight position={[-10, -6, -4]} intensity={0.45} color="#ffb299" />
      <Stars radius={140} depth={80} count={3200} factor={4} saturation={0.4} fade speed={0.25} />

      {(graph?.links || []).map((link) => {
        const from = positions.get(link.source);
        const to = positions.get(link.target);
        if (!from || !to) {
          return null;
        }

        return (
          <Line
            key={`${link.source}-${link.target}-${link.type}`}
            points={[from, to]}
            color={linkColor(link)}
            lineWidth={1.2}
            transparent
            opacity={0.52}
          />
        );
      })}

      {(graph?.nodes || []).map((node) => {
        const position = positions.get(node.id) || [0, 0, 0];
        return (
          <GraphNode
            key={node.id}
            node={node}
            position={position}
            selected={node.id === selectedNodeId}
            onSelect={onSelectNode}
          />
        );
      })}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.45}
        panSpeed={0.55}
        minDistance={16}
        maxDistance={90}
        minPolarAngle={Math.PI / 2 - 0.65}
        maxPolarAngle={Math.PI / 2 + 0.65}
        minAzimuthAngle={-Math.PI / 2.6}
        maxAzimuthAngle={Math.PI / 2.6}
      />
    </Canvas>
  );
}
