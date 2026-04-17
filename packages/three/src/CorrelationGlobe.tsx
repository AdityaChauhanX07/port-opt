'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CorrelationGlobeProps {
  correlations: Float64Array;
  tickers: string[];
  onNodeHover?: (tickerIdx: number | null) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPHERE_R       = 3.0;
const NODE_R         = 0.12;
const CORR_THRESHOLD = 0.20;   // |corr| must exceed this to draw an edge
const LAYOUT_ITERS   = 50;
const SPRING_STEP    = 0.04;

// Hex colours matching design tokens (CSS vars unavailable in Three.js)
const COL_NODE       = new THREE.Color('#f5f5f5');
const COL_NODE_HOVER = new THREE.Color('#5e8eff');
const COL_EMISSIVE   = new THREE.Color('#5e8eff');
const COL_GAIN       = new THREE.Color('#3fb950');  // positive corr edge
const COL_LOSS       = new THREE.Color('#f85149');  // negative corr edge
const COL_NEUTRAL    = new THREE.Color('#525252');  // near-zero edge

// ---------------------------------------------------------------------------
// Force-directed layout on sphere surface
// ---------------------------------------------------------------------------

function projectToSphere(p: THREE.Vector3, r: number) {
  const len = p.length();
  if (len > 0) p.multiplyScalar(r / len);
}

function buildLayout(
  n: number,
  correlations: Float64Array,
  seed = 42,
): THREE.Vector3[] {
  // Seeded-ish RNG via a simple LCG so positions are deterministic
  let rng = seed;
  const nextRand = () => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    return (rng >>> 0) / 0xffffffff;
  };

  const pos = Array.from({ length: n }, () => {
    const u = nextRand() * 2 - 1;
    const t = nextRand() * 2 * Math.PI;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    return new THREE.Vector3(SPHERE_R * s * Math.cos(t), SPHERE_R * s * Math.sin(t), SPHERE_R * u);
  });

  for (let iter = 0; iter < LAYOUT_ITERS; iter++) {
    const forces = pos.map(() => new THREE.Vector3());

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const cij = correlations[i * n + j] ?? 0;
        // Correlation distance: 0 for perfect correlation, sqrt(2) for perfect anti-correlation
        const natDist = Math.sqrt(Math.max(0, 0.5 * (1 - cij))) * SPHERE_R * 1.6;

        const diff = new THREE.Vector3().subVectors(pos[j], pos[i]);
        const dist = diff.length();
        if (dist < 0.001) continue;

        // Spring force: pulls/pushes toward natDist
        const stretch = dist - natDist;
        const force = diff.clone().normalize().multiplyScalar(stretch * SPRING_STEP);
        forces[i].add(force);
        forces[j].sub(force);
      }
    }

    for (let i = 0; i < n; i++) {
      pos[i].add(forces[i]);
      projectToSphere(pos[i], SPHERE_R);
    }
  }

  return pos;
}

// ---------------------------------------------------------------------------
// Edge colour helper
// ---------------------------------------------------------------------------

function edgeColor(corr: number): THREE.Color {
  const t = Math.max(-1, Math.min(1, corr));
  const col = new THREE.Color();
  if (t >= 0) {
    col.lerpColors(COL_NEUTRAL, COL_GAIN, t);
  } else {
    col.lerpColors(COL_NEUTRAL, COL_LOSS, -t);
  }
  return col;
}

// ---------------------------------------------------------------------------
// Edge geometry (single LineSegments draw call)
// ---------------------------------------------------------------------------

function buildEdgeGeometry(
  positions: THREE.Vector3[],
  correlations: Float64Array,
  n: number,
): { geometry: THREE.BufferGeometry; colors: Float32Array; alphas: Float32Array; pairs: Array<[number, number]> } {
  const verts: number[] = [];
  const cols: number[] = [];
  const alph: number[] = [];
  const pairs: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = correlations[i * n + j] ?? 0;
      if (Math.abs(c) < CORR_THRESHOLD) continue;

      pairs.push([i, j]);

      const col = edgeColor(c);
      const alpha = 0.05 + (Math.abs(c) - CORR_THRESHOLD) / (1 - CORR_THRESHOLD) * 0.55;

      for (const vi of [positions[i], positions[j]]) {
        verts.push(vi.x, vi.y, vi.z);
        cols.push(col.r, col.g, col.b);
        alph.push(alpha);
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(cols,  3));
  geom.setAttribute('alpha',    new THREE.Float32BufferAttribute(alph,  1));

  const colors = new Float32Array(cols);
  const alphas = new Float32Array(alph);

  return { geometry: geom, colors, alphas, pairs };
}

// ---------------------------------------------------------------------------
// Edges component
// ---------------------------------------------------------------------------

interface EdgesProps {
  positions: THREE.Vector3[];
  correlations: Float64Array;
  n: number;
  hoveredNode: number | null;
}

function Edges({ positions, correlations, n, hoveredNode }: EdgesProps) {
  const linesRef = useRef<THREE.LineSegments>(null);

  const { geometry, colors, alphas, pairs } = useMemo(
    () => buildEdgeGeometry(positions, correlations, n),
    [positions, correlations, n],
  );

  // Update opacity when hovered node changes
  React.useEffect(() => {
    if (!linesRef.current) return;
    const colorAttr = linesRef.current.geometry.getAttribute('color') as THREE.BufferAttribute;

    const nSegs = pairs.length;
    for (let e = 0; e < nSegs; e++) {
      const [ni, nj] = pairs[e];
      const connected = hoveredNode !== null && (ni === hoveredNode || nj === hoveredNode);
      const dim       = hoveredNode !== null && !connected;

      const baseAlpha = alphas[e * 2];
      const scale = dim ? 0.15 : connected ? 2.0 : 1.0;
      const a = Math.min(baseAlpha * scale, 0.85);

      for (const vIdx of [e * 2, e * 2 + 1]) {
        const r = colors[vIdx * 3 + 0];
        const g = colors[vIdx * 3 + 1];
        const b = colors[vIdx * 3 + 2];
        colorAttr.setXYZ(vIdx, r * a, g * a, b * a);
      }
    }
    colorAttr.needsUpdate = true;
  }, [hoveredNode, pairs, colors, alphas]);

  return (
    <lineSegments ref={linesRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={1} />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// Single node sphere
// ---------------------------------------------------------------------------

interface NodeProps {
  position: THREE.Vector3;
  ticker: string;
  index: number;
  hovered: boolean;
  onHover: (idx: number | null) => void;
}

function Node({ position, ticker, index, hovered, onHover }: NodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshStandardMaterial>(null);
  const clockRef = useRef(0);

  useFrame((_, delta) => {
    if (!meshRef.current || !matRef.current) return;
    clockRef.current += delta;

    // Scale spring toward target
    const targetScale = hovered ? 1.5 : 1.0;
    meshRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale),
      1 - Math.exp(-delta / 0.15),
    );

    // Color lerp
    const targetColor = hovered ? COL_NODE_HOVER : COL_NODE;
    matRef.current.color.lerp(targetColor, 1 - Math.exp(-delta / 0.12));

    // Breathing emissive
    const breathe = 0.2 + Math.sin(clockRef.current * (2 * Math.PI / 4)) * 0.02;
    matRef.current.emissiveIntensity = hovered ? 0.6 : breathe;
  });

  return (
    <group position={position.toArray()}>
      <mesh
        ref={meshRef}
        onPointerEnter={(e) => { e.stopPropagation(); onHover(index); }}
        onPointerLeave={(e) => { e.stopPropagation(); onHover(null);  }}
      >
        <sphereGeometry args={[NODE_R, 16, 12]} />
        <meshStandardMaterial
          ref={matRef}
          color={COL_NODE}
          emissive={COL_EMISSIVE}
          emissiveIntensity={0.2}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      {/* Billboard label */}
      <Text
        position={[0, NODE_R + 0.14, 0]}
        fontSize={0.15}
        color={hovered ? '#5e8eff' : '#a3a3a3'}
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {ticker}
      </Text>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Scene (rotation + interaction)
// ---------------------------------------------------------------------------

interface SceneProps {
  positions: THREE.Vector3[];
  tickers: string[];
  correlations: Float64Array;
  n: number;
  onNodeHover?: (idx: number | null) => void;
}

function Scene({ positions, tickers, correlations, n, onNodeHover }: SceneProps) {
  const groupRef   = useRef<THREE.Group>(null);
  const orbitRef   = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const autoRotate = useRef(true);

  const handleHover = useCallback((idx: number | null) => {
    setHovered(idx);
    onNodeHover?.(idx);
  }, [onNodeHover]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    if (autoRotate.current) {
      groupRef.current.rotation.y += 0.05 * delta;
    }
  });

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />

      <OrbitControls
        ref={orbitRef}
        enableZoom
        enablePan={false}
        minDistance={4}
        maxDistance={15}
        dampingFactor={0.08}
        enableDamping
        onStart={() => { autoRotate.current = false; }}
        onEnd={()   => { autoRotate.current = true;  }}
      />

      <group ref={groupRef}>
        <Edges
          positions={positions}
          correlations={correlations}
          n={n}
          hoveredNode={hovered}
        />

        {positions.map((pos, i) => (
          <Node
            key={tickers[i] ?? i}
            position={pos}
            ticker={tickers[i] ?? `A${i}`}
            index={i}
            hovered={hovered === i}
            onHover={handleHover}
          />
        ))}
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Legend row
// ---------------------------------------------------------------------------

function Legend() {
  const stops: Array<{ color: string; label: string }> = [
    { color: '#f85149', label: '−1.0' },
    { color: '#525252', label:  '0'   },
    { color: '#3fb950', label: '+1.0' },
  ];

  return (
    <div className="flex items-center justify-center gap-6 mt-3">
      {stops.map(({ color, label }, i) => (
        <React.Fragment key={label}>
          {i > 0 && (
            <div
              className="h-px flex-1 max-w-24"
              style={{
                background: `linear-gradient(to right, ${stops[i - 1].color}, ${color})`,
                opacity: 0.4,
              }}
            />
          )}
          <span className="mono text-[11px] tabular-nums" style={{ color }}>
            {label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function CorrelationGlobe({ correlations, tickers, onNodeHover }: CorrelationGlobeProps) {
  const n = tickers.length;

  // Hooks must be called unconditionally — guard inside the memo body
  const positions = useMemo(
    () => (correlations && n >= 2 ? buildLayout(n, correlations, 42) : []),
    [n, correlations],
  );

  if (!correlations || n < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height: 600 }}>
        <p className="mono text-[13px] text-[#737373]">Need at least 2 assets</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ height: 600, background: '#0a0a0a', borderRadius: 8 }}>
        <Canvas
          camera={{ position: [0, 0, 8], fov: 50 }}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#0a0a0a', borderRadius: 8 }}
        >
          <Scene
            positions={positions}
            tickers={tickers}
            correlations={correlations}
            n={n}
            onNodeHover={onNodeHover}
          />
        </Canvas>
      </div>
      <Legend />
    </div>
  );
}
