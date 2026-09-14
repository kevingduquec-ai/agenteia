'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial, Sphere } from '@react-three/drei';
import { useRef } from 'react';
import type { Mesh } from 'three';

export type OrbState = 'idle' | 'thinking' | 'speaking';

const ORB_LOOK: Record<OrbState, { color: string; speed: number; distort: number }> = {
  idle: { color: '#8b5cf6', speed: 0.6, distort: 0.25 },
  thinking: { color: '#7c3aed', speed: 3.2, distort: 0.55 },
  speaking: { color: '#a855f7', speed: 1.6, distort: 0.38 },
};

function OrbMesh({ state }: { state: OrbState }) {
  const meshRef = useRef<Mesh>(null);
  const look = ORB_LOOK[state];

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * (state === 'idle' ? 0.2 : 0.45);
    meshRef.current.rotation.x += delta * 0.08;
  });

  return (
    <Sphere ref={meshRef} args={[1, 64, 64]}>
      <MeshDistortMaterial
        color={look.color}
        attach="material"
        distort={look.distort}
        speed={look.speed}
        roughness={0.2}
        metalness={0.15}
      />
    </Sphere>
  );
}

/**
 * El "rostro" de Prefi: una esfera 3D que respira/gira suavemente en
 * reposo y se acelera cuando el asistente esta pensando o respondiendo —
 * una señal visual instantanea de estado que no requiere leer texto,
 * pensada para alguien que no esta acostumbrado a interfaces tecnicas.
 */
export function ChatOrb({ state }: { state: OrbState }) {
  return (
    <div className="relative h-24 w-24 sm:h-28 sm:w-28" aria-hidden="true">
      <div
        className="absolute inset-0 rounded-full blur-2xl opacity-60 transition-colors duration-700"
        style={{ backgroundColor: ORB_LOOK[state].color }}
      />
      <Canvas camera={{ position: [0, 0, 2.6] }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 2, 2]} intensity={1.3} />
        <pointLight position={[-2, -1, 2]} intensity={0.7} color="#c4b5fd" />
        <OrbMesh state={state} />
      </Canvas>
    </div>
  );
}
