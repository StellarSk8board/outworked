import { useEffect, useRef } from "react";
import { Agent } from "../lib/types";
import type { FurnitureItem } from "../phaser/OfficeScene";

interface OfficeCanvasProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onAgentClick: (agent: Agent) => void;
  onAgentMove?: (agentId: string, x: number, y: number) => void;
  onFurnitureMove?: (items: FurnitureItem[]) => void;
  furnitureLayout?: FurnitureItem[] | null;
}

export default function OfficeCanvas({
  agents,
  selectedAgentId,
  onAgentClick,
  onAgentMove,
  onFurnitureMove,
  furnitureLayout,
}: OfficeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const sceneRef = useRef<import("../phaser/OfficeScene").OfficeScene | null>(
    null,
  );
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    let game: import("phaser").Game;

    async function initPhaser() {
      const Phaser = await import("phaser");
      const { OfficeScene } = await import("../phaser/OfficeScene");

      if (!containerRef.current || gameRef.current) return;

      const scene = new OfficeScene();
      scene.setOnAgentClick(onAgentClick);
      if (onAgentMove) scene.setOnAgentMove(onAgentMove);
      if (onFurnitureMove) scene.setOnFurnitureMove(onFurnitureMove);
      if (furnitureLayout) scene.setFurnitureLayout(furnitureLayout);
      sceneRef.current = scene;

      const rect = containerRef.current.getBoundingClientRect();
      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: Math.floor(rect.width) || 768,
        height: Math.floor(rect.height) || 480,
        backgroundColor: "#2a2a3a",
        scene: scene,
        parent: containerRef.current,
        antialias: true,
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.NONE,
        },
      });

      gameRef.current = game;

      // Pre-load agents so scene.create() can render them immediately
      scene.updateAgents(agentsRef.current);
      scene.setSelectedAgent(selectedAgentId);
    }

    initPhaser();

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update agents when they change
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateAgents(agents);
    }
  }, [agents]);

  // Update selection
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setSelectedAgent(selectedAgentId);
    }
  }, [selectedAgentId]);

  // Update click handler ref
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setOnAgentClick(onAgentClick);
    }
  }, [onAgentClick]);

  // Update move handlers
  useEffect(() => {
    if (sceneRef.current && onAgentMove) {
      sceneRef.current.setOnAgentMove(onAgentMove);
    }
  }, [onAgentMove]);

  useEffect(() => {
    if (sceneRef.current && onFurnitureMove) {
      sceneRef.current.setOnFurnitureMove(onFurnitureMove);
    }
  }, [onFurnitureMove]);

  return <div ref={containerRef} className="w-full h-full absolute inset-0" />;
}
