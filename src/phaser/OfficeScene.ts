import Phaser from 'phaser';
import { Agent, AGENT_COLORS } from '../lib/types';
import { buildPalette, registerAgentTextures, FRAME_PX, AnimState } from './SpriteGen';

const TILE = 48;

// Rich color palette
const P = {
  // Floor — warm wood planks
  plank1: 0x7a5c3e,
  plank2: 0x6d5236,
  plank3: 0x8a6a48,
  plankLine: 0x5a422e,
  // Walls
  wall: 0x2a2a40,
  wallDark: 0x1e1e32,
  wallAccent: 0x343450,
  baseboard: 0x4a3a2a,
  // Furniture - desks
  desk: 0x5c4535,
  deskTop: 0x6d553f,
  deskHighlight: 0x7d6549,
  deskLeg: 0x4a3728,
  // Monitor
  monitor: 0x1a1a2e,
  monitorBezel: 0x333344,
  monitorScreen: 0x00d4ff,
  monitorScreenAlt: 0x00ff88,
  // Chair
  chair: 0x2c3e50,
  chairSeat: 0x3a5068,
  chairHighlight: 0x4a6078,
  // Plants
  plant: 0x2d6a4f,
  plantLight: 0x3d8a6f,
  plantDark: 0x1d5a3f,
  plantPot: 0x8b5e3c,
  plantPotHighlight: 0xa67048,
  // Window
  window: 0x87ceeb,
  windowLight: 0xb0e0f0,
  windowFrame: 0x5a5a7a,
  // Rug
  rug: 0x6b2737,
  rugLight: 0x7b3747,
  rugBorder: 0x8b4757,
  rugPattern: 0x5b1727,
  // Bookshelf
  bookshelf: 0x6b4c2a,
  bookshelfDark: 0x5b3c1a,
  book1: 0xe74c3c,
  book2: 0x3498db,
  book3: 0x2ecc71,
  book4: 0xf1c40f,
  book5: 0x9b59b6,
  book6: 0xe67e22,
  // Coffee machine
  coffee: 0x5d4037,
  coffeeHighlight: 0x7d6057,
  coffeeMetal: 0x9e9e9e,
  // Whiteboard
  whiteboard: 0xecf0f1,
  whiteboardFrame: 0x8a9aaa,
  // Lighting
  ceilingLight: 0xf0e68c,
  lampGlow: 0xfff8e1,
};

export class OfficeScene extends Phaser.Scene {
  private agents: Agent[] = [];
  private agentSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private thoughtBubbles: Map<string, Phaser.GameObjects.Container> = new Map();
  private onAgentClick?: (agent: Agent) => void;
  private walkTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
  private agentTargets: Map<string, { x: number; y: number }> = new Map();
  private selectedAgentId: string | null = null;
  private agentAnimKeys: Map<string, Record<AnimState, string>> = new Map();
  private agentIndex = 0;
  private ready = false;
  private cols = 16;
  private rows = 10;
  private officeGraphics?: Phaser.GameObjects.Graphics;
  private deskPositions: { x: number; y: number }[] = []; // tile positions of desk chairs
  /** Snapshot of last-rendered agent state, keyed by id */
  private agentSnapshot: Map<string, { status: string; name: string; role: string; color: string; thought: string }> = new Map();

  constructor() {
    super({ key: 'OfficeScene' });
  }

  setOnAgentClick(cb: (agent: Agent) => void) {
    this.onAgentClick = cb;
  }

  preload() {
    // All graphics are procedurally generated — no external assets needed
  }

  create() {
    this.computeGrid();
    this.drawOffice();
    this.ready = true;

    this.scale.on('resize', () => {
      this.computeGrid();
      if (this.officeGraphics) {
        this.officeGraphics.destroy();
      }
      this.drawOffice();
      if (this.agents.length > 0) {
        this.fullRebuildAgents();
      }
    });

    // Render any agents that were set before create() fired
    if (this.agents.length > 0) {
      this.fullRebuildAgents();
    }
  }

  updateAgents(agents: Agent[]) {
    const prev = this.agents;
    this.agents = agents;
    if (!this.ready) return; // create() will handle rendering

    const prevIds = new Set(prev.map((a) => a.id));
    const nextIds = new Set(agents.map((a) => a.id));

    // Categorize changes
    const toRebuild = new Set<string>();   // identity change → full rebuild
    const toTransition = new Set<string>(); // status change only → smooth transition
    const toRemove = new Set<string>();

    // Removed agents
    for (const id of prevIds) {
      if (!nextIds.has(id)) toRemove.add(id);
    }

    // Added or changed agents
    for (const agent of agents) {
      const snap = this.agentSnapshot.get(agent.id);
      if (!snap) {
        // New agent
        toRebuild.add(agent.id);
      } else if (
        snap.name !== agent.name ||
        snap.role !== agent.role ||
        snap.color !== agent.color
      ) {
        // Identity changed → full rebuild needed
        toRebuild.add(agent.id);
      } else if (snap.status !== agent.status) {
        // Status only changed → smooth transition (no rebuild)
        toTransition.add(agent.id);
      }
    }

    // Remove deleted agents
    for (const id of toRemove) {
      this.destroyAgentSprite(id);
      this.agentSnapshot.delete(id);
    }

    // If any agent changed status, reassign desk positions for working agents
    if (toRebuild.size > 0 || toTransition.size > 0 || toRemove.size > 0) {
      this.assignDesks();
    }

    // Rebuild only sprites that need a full identity change
    for (const id of toRebuild) {
      this.destroyAgentSprite(id);
      const agent = agents.find((a) => a.id === id);
      if (agent) this.createAgentSprite(agent);
    }

    // Smoothly transition agents whose status changed (no rebuild)
    for (const id of toTransition) {
      const agent = agents.find((a) => a.id === id);
      if (agent) this.transitionAgentStatus(agent);
    }

    // For agents that are unchanged but might have a new thought, update the thought only
    for (const agent of agents) {
      if (toRebuild.has(agent.id) || toTransition.has(agent.id)) continue;
      const snap = this.agentSnapshot.get(agent.id);
      if (snap && snap.thought !== (agent.currentThought ?? '')) {
        this.agentSnapshot.set(agent.id, {
          status: agent.status, name: agent.name,
          role: agent.role, color: agent.color,
          thought: agent.currentThought ?? '',
        });
        // If a thought bubble is currently visible, refresh it
        if (this.thoughtBubbles.has(agent.id)) {
          const container = this.agentSprites.get(agent.id);
          if (container) {
            this.hideThoughtBubble(agent.id);
            if (agent.currentThought) this.showThoughtBubble(agent, container);
          }
        }
      }
    }

    // Schedule walks only for newly-created agents (existing timers are still running)
    for (const id of toRebuild) {
      this.scheduleWalk(id);
    }
  }

  setSelectedAgent(id: string | null) {
    this.selectedAgentId = id;
    this.agentSprites.forEach((container, agentId) => {
      const highlight = container.getByName('highlight') as Phaser.GameObjects.Graphics | null;
      if (highlight) {
        highlight.setVisible(agentId === id);
      }
    });
  }

  private computeGrid() {
    const w = this.scale.gameSize.width || this.sys.game.canvas.width || 768;
    const h = this.scale.gameSize.height || this.sys.game.canvas.height || 480;
    this.cols = Math.max(16, Math.ceil(w / TILE));
    this.rows = Math.max(10, Math.ceil(h / TILE));
  }

  private drawOffice() {
    const g = this.add.graphics();
    this.officeGraphics = g;
    const { cols, rows } = this;
    const W = this.scale.gameSize.width;
    const H = this.scale.gameSize.height;

    // Reset desk positions
    this.deskPositions = [];

    // ======= FLOOR — warm wood planks =======
    const plankColors = [P.plank1, P.plank2, P.plank3, P.plank1, P.plank2];
    for (let row = 0; row < rows; row++) {
      const baseColor = plankColors[row % plankColors.length];
      g.fillStyle(baseColor, 1);
      g.fillRect(0, row * TILE, cols * TILE, TILE);

      // Plank joint line
      g.lineStyle(1, P.plankLine, 0.35);
      g.lineBetween(0, row * TILE, cols * TILE, row * TILE);

      // Subtle grain lines
      for (let i = 0; i < 3; i++) {
        const gy = row * TILE + 8 + i * 14;
        g.lineStyle(1, P.plankLine, 0.1);
        g.lineBetween(0, gy, cols * TILE, gy);
      }

      // Vertical plank seams (staggered like real planks)
      const offset = (row % 2) * (TILE * 1.5);
      g.lineStyle(1, P.plankLine, 0.2);
      for (let x = offset; x < cols * TILE; x += TILE * 3) {
        g.lineBetween(x, row * TILE, x, (row + 1) * TILE);
      }
    }

    // ======= RUG — ornate center rug =======
    const rugW = 8, rugH = 4;
    const rugX = Math.floor((cols - rugW) / 2);
    const rugY = Math.floor((rows - rugH) / 2);
    // Rug shadow
    g.fillStyle(0x000000, 0.12);
    g.fillRect(rugX * TILE + 3, rugY * TILE + 3, rugW * TILE, rugH * TILE);
    // Rug base
    g.fillStyle(P.rug, 1);
    g.fillRect(rugX * TILE, rugY * TILE, rugW * TILE, rugH * TILE);
    // Rug inner gradient
    g.fillStyle(P.rugLight, 0.3);
    g.fillRect(rugX * TILE + 8, rugY * TILE + 8, rugW * TILE - 16, rugH * TILE - 16);
    // Border
    g.lineStyle(3, P.rugBorder, 1);
    g.strokeRect(rugX * TILE + 4, rugY * TILE + 4, rugW * TILE - 8, rugH * TILE - 8);
    g.lineStyle(1, P.rugBorder, 0.5);
    g.strokeRect(rugX * TILE + 10, rugY * TILE + 10, rugW * TILE - 20, rugH * TILE - 20);
    // Rug pattern — diamond shapes
    g.lineStyle(1, P.rugPattern, 0.3);
    const rcx = (rugX + rugW / 2) * TILE;
    const rcy = (rugY + rugH / 2) * TILE;
    for (let i = 1; i <= 3; i++) {
      const s = i * 20;
      g.beginPath();
      g.moveTo(rcx, rcy - s);
      g.lineTo(rcx + s * 1.5, rcy);
      g.lineTo(rcx, rcy + s);
      g.lineTo(rcx - s * 1.5, rcy);
      g.closePath();
      g.strokePath();
    }

    // ======= WALLS =======
    const wallH = TILE * 1.5;
    // Main wall
    g.fillStyle(P.wall, 1);
    g.fillRect(0, 0, W, wallH);
    // Wall top accent
    g.fillStyle(P.wallDark, 1);
    g.fillRect(0, 0, W, 6);
    // Wall panel detail
    g.fillStyle(P.wallAccent, 0.3);
    for (let x = 0; x < W; x += TILE * 4) {
      g.fillRect(x + 4, 8, TILE * 4 - 8, wallH - 16);
    }
    // Baseboard
    g.fillStyle(P.baseboard, 1);
    g.fillRect(0, wallH - 5, W, 5);
    g.lineStyle(1, 0x3a2a1a, 0.5);
    g.lineBetween(0, wallH - 5, W, wallH - 5);
    // Wall shadow on floor
    g.fillStyle(0x000000, 0.08);
    g.fillRect(0, wallH, W, 16);

    // ======= WINDOWS — evenly distributed =======
    const winCount = Math.max(4, Math.floor(cols / 4));
    const winSpacing = cols / winCount;
    for (let i = 0; i < winCount; i++) {
      const wx = Math.floor((i + 0.5) * winSpacing) * TILE + 4;
      if (wx + TILE < W) {
        this.drawWindow(g, wx, 10, TILE - 8, wallH - 24);
      }
    }

    // ======= WINDOW LIGHT BEAMS on floor =======
    for (let i = 0; i < winCount; i++) {
      const wx = Math.floor((i + 0.5) * winSpacing) * TILE + 4;
      if (wx + TILE < W) {
        const beamX = wx - 10;
        const beamW = TILE + 10;
        g.fillStyle(0xfff8e1, 0.06);
        g.beginPath();
        g.moveTo(beamX, wallH);
        g.lineTo(beamX - 20, H);
        g.lineTo(beamX + beamW + 20, H);
        g.lineTo(beamX + beamW, wallH);
        g.closePath();
        g.fillPath();
      }
    }

    // ======= DESK ROWS =======
    const deskStart = 2;
    const deskEnd = rows - 2;
    const deskRange = deskEnd - deskStart;
    const deskRows: number[] = deskRange < 3
      ? [deskStart]
      : deskRange < 6
        ? [deskStart, deskStart + Math.floor(deskRange / 2)]
        : [deskStart, deskStart + Math.floor(deskRange / 3), deskStart + Math.floor(2 * deskRange / 3)];

    // Left wall desks
    for (const dr of deskRows) {
      this.drawDesk(g, 1 * TILE, dr * TILE);
      this.deskPositions.push({ x: 2, y: dr + 1 });
    }

    // Right wall desks
    const rightCol = cols - 3;
    for (const dr of deskRows) {
      this.drawDesk(g, rightCol * TILE, dr * TILE);
      this.deskPositions.push({ x: rightCol + 1, y: dr + 1 });
    }

    // Center desks
    const cLeft = Math.floor(cols / 2) - 2;
    const cRight = Math.floor(cols / 2) + 1;
    this.drawDesk(g, cLeft * TILE, 1 * TILE + 16);
    this.deskPositions.push({ x: cLeft + 1, y: 2 });
    this.drawDesk(g, cRight * TILE, 1 * TILE + 16);
    this.deskPositions.push({ x: cRight + 1, y: 2 });

    // ======= PLANTS — organic shapes =======
    this.drawPlant(g, 0, 1 * TILE + 4);
    this.drawPlant(g, (cols - 1) * TILE, 1 * TILE + 4);
    this.drawPlant(g, 0, (rows - 2) * TILE + 4);
    this.drawPlant(g, (cols - 1) * TILE, (rows - 2) * TILE + 4);

    // ======= WHITEBOARD =======
    this.drawWhiteboard(g, Math.floor((cols - 2) / 2) * TILE, 4);

    // ======= BOOKSHELVES =======
    const bottomRow = rows - 1;
    this.drawBookshelf(g, Math.floor(cols * 0.2) * TILE, bottomRow * TILE);
    this.drawBookshelf(g, Math.floor(cols * 0.6) * TILE, bottomRow * TILE);

    // ======= COFFEE MACHINE =======
    this.drawCoffeeMachine(g, (cols - 2) * TILE + 4, bottomRow * TILE + 4);

    // ======= WATER COOLER =======
    this.drawWaterCooler(g, Math.floor(cols * 0.4) * TILE, bottomRow * TILE);

    // ======= CEILING LIGHTS GLOW =======
    const lightG = this.add.graphics();
    lightG.setDepth(1);
    const lightSpacing = Math.max(4, Math.floor(cols / 3));
    for (let i = 0; i < 3; i++) {
      const lx = (i + 0.5) * lightSpacing * TILE;
      const ly = wallH + 20;
      // Soft light cone
      // lightG.fillStyle(P.lampGlow, 0.04);
      // lightG.fillCircle(lx, ly + 40, 80);
      // lightG.fillStyle(P.lampGlow, 0.03);
      // lightG.fillCircle(lx, ly + 60, 120);
      // Light fixture
      lightG.fillStyle(P.ceilingLight, 0.6);
      lightG.fillRect(lx - 15, wallH, 30, 4);
      lightG.fillStyle(0xffffff, 0.4);
      lightG.fillRect(lx - 12, wallH + 1, 24, 2);
    }

    // ======= AMBIENT PARTICLES =======
    // this.createDustParticles();
  }

  private createDustParticles() {
    // Create floating dust motes for atmosphere
    for (let i = 0; i < 20; i++) {
      const W = this.scale.gameSize.width;
      const H = this.scale.gameSize.height;
      const px = Math.random() * W;
      const py = Math.random() * H;
      const size = 1 + Math.random() * 2;
      const dust = this.add.circle(px, py, size, 0xfff8e1, 0.15 + Math.random() * 0.15);
      dust.setDepth(2);

      // Float upward slowly
      this.tweens.add({
        targets: dust,
        x: px + (Math.random() - 0.5) * 60,
        y: py - 30 - Math.random() * 40,
        alpha: 0,
        duration: 4000 + Math.random() * 4000,
        delay: Math.random() * 6000,
        repeat: -1,
        onRepeat: () => {
          dust.setPosition(Math.random() * W, Math.random() * H);
          dust.setAlpha(0.15 + Math.random() * 0.15);
        },
      });
    }
  }

  private drawWindow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
    // Window frame shadow
    g.fillStyle(0x000000, 0.2);
    g.fillRect(x + 2, y + 2, w, h);
    // Outer frame
    g.fillStyle(P.windowFrame, 1);
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
    // Glass — sky gradient feel
    g.fillStyle(P.window, 1);
    g.fillRect(x, y, w, h);
    // Sky lighter at top
    g.fillStyle(P.windowLight, 0.4);
    g.fillRect(x, y, w, h / 3);
    // Cross frame
    g.fillStyle(P.windowFrame, 1);
    g.fillRect(x + w / 2 - 1, y, 2, h);
    g.fillRect(x, y + h / 2 - 1, w, 2);
    // Glass sheen
    g.fillStyle(0xffffff, 0.15);
    g.fillRect(x + 2, y + 2, w / 2 - 4, h / 2 - 4);
    // Window sill
    g.fillStyle(P.windowFrame, 1);
    g.fillRect(x - 3, y + h + 2, w + 6, 3);
    g.fillStyle(0xffffff, 0.1);
    g.fillRect(x - 3, y + h + 2, w + 6, 1);
  }

  private drawDesk(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const dw = TILE * 2;
    const cx = x + TILE; // center of desk

    // Desk shadow
    g.fillStyle(0x000000, 0.12);
    g.fillRect(x + 3, y + 10, dw, TILE - 6);

    // Desk legs
    g.fillStyle(P.deskLeg, 1);
    g.fillRect(x + 4, y + 10, 4, TILE - 8);
    g.fillRect(x + dw - 8, y + 10, 4, TILE - 8);

    // Desk body
    g.fillStyle(P.desk, 1);
    g.fillRect(x, y + 6, dw, TILE - 10);

    // Desk top surface
    g.fillStyle(P.deskTop, 1);
    g.fillRect(x, y, dw, 8);
    // Top highlight
    g.fillStyle(P.deskHighlight, 0.5);
    g.fillRect(x + 2, y + 1, dw - 4, 3);

    // Monitor — back panel
    g.fillStyle(P.monitorBezel, 1);
    g.fillRect(cx - 15, y - 24, 30, 22);
    // Monitor screen
    g.fillStyle(P.monitor, 1);
    g.fillRect(cx - 13, y - 22, 26, 16);
    // Screen content — code lines
    const screenColors = [0x00d4ff, 0x00ff88, 0xff6b9d, 0xffd93d];
    for (let i = 0; i < 5; i++) {
      const lineW = 6 + Math.random() * 14;
      g.fillStyle(screenColors[i % screenColors.length], 0.7);
      g.fillRect(cx - 11, y - 20 + i * 3, lineW, 1.5);
    }
    // Screen glow
    g.fillStyle(P.monitorScreen, 0.08);
    g.fillCircle(cx, y - 14, 20);
    // Monitor stand
    g.fillStyle(P.monitorBezel, 1);
    g.fillRect(cx - 3, y - 2, 6, 3);
    g.fillRect(cx - 6, y, 12, 2);

    // Keyboard
    g.fillStyle(0x555555, 1);
    g.fillRect(cx - 10, y + 2, 20, 5);
    g.fillStyle(0x666666, 1);
    g.fillRect(cx - 9, y + 3, 18, 3);
    // Key dots
    g.fillStyle(0x777777, 0.6);
    for (let i = 0; i < 5; i++) {
      g.fillRect(cx - 8 + i * 4, y + 3.5, 2, 1);
    }

    // Mouse
    g.fillStyle(0x555555, 1);
    g.fillRect(cx + 14, y + 3, 5, 4);
    g.fillStyle(0x666666, 1);
    g.fillRect(cx + 14, y + 3, 5, 2);

    // Coffee mug on desk
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(x + 6, y + 1, 6, 5);
    g.fillStyle(0x8B4513, 0.4);
    g.fillRect(x + 7, y + 2, 4, 2);

    // Chair
    g.fillStyle(0x000000, 0.1);
    g.fillRect(cx - 9, y + TILE + 4, 20, 16);
    // Chair back
    g.fillStyle(P.chair, 1);
    g.fillRect(cx - 10, y + TILE, 20, 18);
    // Chair back highlight
    g.fillStyle(P.chairHighlight, 0.4);
    g.fillRect(cx - 8, y + TILE + 2, 16, 6);
    // Chair seat
    g.fillStyle(P.chairSeat, 1);
    g.fillRect(cx - 10, y + TILE - 3, 20, 6);
    // Seat highlight
    g.fillStyle(P.chairHighlight, 0.3);
    g.fillRect(cx - 8, y + TILE - 2, 16, 3);
    // Chair wheel dots
    g.fillStyle(0x333333, 0.6);
    g.fillCircle(cx - 8, y + TILE + 18, 2);
    g.fillCircle(cx + 8, y + TILE + 18, 2);
    g.fillCircle(cx, y + TILE + 19, 2);
  }

  private drawPlant(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // Shadow
    g.fillStyle(0x000000, 0.1);
    g.fillCircle(x + 24, y + 42, 12);

    // Pot
    g.fillStyle(P.plantPot, 1);
    g.fillRect(x + 10, y + 26, 28, 18);
    // Pot rim
    g.fillStyle(P.plantPotHighlight, 1);
    g.fillRect(x + 8, y + 24, 32, 4);
    // Pot highlight
    g.fillStyle(P.plantPotHighlight, 0.3);
    g.fillRect(x + 12, y + 28, 6, 14);
    // Pot shadow
    g.fillStyle(0x000000, 0.1);
    g.fillRect(x + 28, y + 28, 8, 14);

    // Soil
    g.fillStyle(0x3d2b1f, 1);
    g.fillRect(x + 12, y + 24, 24, 3);

    // Leaves — layered with depth
    g.fillStyle(P.plantDark, 1);
    g.fillCircle(x + 24, y + 18, 13);
    g.fillCircle(x + 15, y + 22, 9);
    g.fillCircle(x + 33, y + 22, 9);

    g.fillStyle(P.plant, 1);
    g.fillCircle(x + 24, y + 14, 12);
    g.fillCircle(x + 16, y + 20, 8);
    g.fillCircle(x + 32, y + 20, 8);

    // Highlights
    g.fillStyle(P.plantLight, 1);
    g.fillCircle(x + 22, y + 10, 6);
    g.fillCircle(x + 14, y + 17, 4);
    g.fillCircle(x + 30, y + 16, 5);

    // Light spots
    g.fillStyle(0x4daa7f, 0.4);
    g.fillCircle(x + 20, y + 8, 3);
  }

  private drawWhiteboard(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const bw = TILE * 2;
    const bh = TILE - 4;

    // Shadow
    g.fillStyle(0x000000, 0.15);
    g.fillRect(x + 2, y + 2, bw, bh);

    // Frame
    g.fillStyle(P.whiteboardFrame, 1);
    g.fillRect(x, y, bw, bh);

    // Board surface
    g.fillStyle(P.whiteboard, 1);
    g.fillRect(x + 4, y + 4, bw - 8, bh - 8);

    // Surface sheen
    g.fillStyle(0xffffff, 0.15);
    g.fillRect(x + 4, y + 4, bw / 2 - 6, bh / 2 - 6);

    // Content — kanban-style sticky notes
    const noteColors = [0xfff176, 0x80cbc4, 0xef9a9a, 0x90caf9];
    for (let i = 0; i < 4; i++) {
      const nx = x + 8 + (i % 2) * 42;
      const ny = y + 8 + Math.floor(i / 2) * 14;
      g.fillStyle(noteColors[i], 0.85);
      g.fillRect(nx, ny, 36, 10);
      // Note text lines
      g.fillStyle(0x333333, 0.4);
      g.fillRect(nx + 3, ny + 3, 20 + (i * 3), 1.5);
      g.fillRect(nx + 3, ny + 6, 12 + (i * 5), 1.5);
    }

    // Marker tray
    g.fillStyle(0x999999, 1);
    g.fillRect(x + 20, y + bh - 2, bw - 40, 3);
    // Markers
    const markerColors = [0xe74c3c, 0x2ecc71, 0x3498db, 0x1a1a2e];
    for (let i = 0; i < 4; i++) {
      g.fillStyle(markerColors[i], 1);
      g.fillRect(x + 24 + i * 12, y + bh - 3, 8, 2);
    }
  }

  private drawBookshelf(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const sw = TILE * 2;
    const sh = TILE;

    // Shadow
    g.fillStyle(0x000000, 0.1);
    g.fillRect(x + 3, y + 3, sw, sh);

    // Shelf body
    g.fillStyle(P.bookshelf, 1);
    g.fillRect(x, y, sw, sh);
    // Side panels darker
    g.fillStyle(P.bookshelfDark, 1);
    g.fillRect(x, y, 3, sh);
    g.fillRect(x + sw - 3, y, 3, sh);
    // Middle shelf
    g.fillStyle(P.bookshelfDark, 1);
    g.fillRect(x + 3, y + sh / 2 - 1, sw - 6, 3);
    // Top highlight
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(x, y, sw, 2);

    // Books — top shelf
    const books1 = [P.book1, P.book2, P.book3, P.book4, P.book5, P.book6];
    for (let i = 0; i < 6; i++) {
      const bh = sh / 2 - 6 + (i % 3) * 2;
      const bx = x + 5 + i * 14;
      g.fillStyle(books1[i], 1);
      g.fillRect(bx, y + sh / 2 - bh - 1, 10, bh);
      // Book highlight
      g.fillStyle(0xffffff, 0.12);
      g.fillRect(bx, y + sh / 2 - bh - 1, 3, bh);
    }

    // Books — bottom shelf
    const books2 = [P.book4, P.book1, P.book5, P.book2, P.book6, P.book3];
    for (let i = 0; i < 6; i++) {
      const bh = sh / 2 - 6 + ((i + 1) % 3) * 2;
      const bx = x + 5 + i * 14;
      g.fillStyle(books2[i], 1);
      g.fillRect(bx, y + sh - bh - 2, 10, bh);
      g.fillStyle(0xffffff, 0.12);
      g.fillRect(bx, y + sh - bh - 2, 3, bh);
    }
  }

  private drawCoffeeMachine(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // Shadow
    g.fillStyle(0x000000, 0.1);
    g.fillRect(x + 2, y + 2, 34, 38);

    // Machine body
    g.fillStyle(P.coffee, 1);
    g.fillRect(x, y, 32, 36);
    // Body highlight
    g.fillStyle(P.coffeeHighlight, 0.4);
    g.fillRect(x + 2, y + 2, 10, 32);

    // Display panel
    g.fillStyle(0x263238, 1);
    g.fillRect(x + 4, y + 4, 24, 14);
    // Display screen
    g.fillStyle(0x00e676, 0.6);
    g.fillRect(x + 6, y + 6, 20, 10);
    // Screen text
    g.fillStyle(0x00e676, 0.4);
    g.fillRect(x + 8, y + 8, 8, 1.5);
    g.fillRect(x + 8, y + 11, 12, 1.5);

    // Buttons
    g.fillStyle(P.coffeeMetal, 1);
    g.fillCircle(x + 10, y + 22, 3);
    g.fillCircle(x + 22, y + 22, 3);
    // Button highlight
    g.fillStyle(0xffffff, 0.2);
    g.fillCircle(x + 9, y + 21, 1.5);
    g.fillCircle(x + 21, y + 21, 1.5);

    // Drip tray
    g.fillStyle(P.coffeeMetal, 1);
    g.fillRect(x + 4, y + 28, 24, 6);
    g.fillStyle(0x000000, 0.1);
    g.fillRect(x + 6, y + 29, 20, 4);

    // Steam
    g.fillStyle(0xffffff, 0.08);
    g.fillCircle(x + 16, y - 4, 4);
    g.fillCircle(x + 14, y - 10, 3);
    g.fillCircle(x + 18, y - 14, 2);
  }

  private drawWaterCooler(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    // Shadow
    g.fillStyle(0x000000, 0.1);
    g.fillRect(x + 3, y + 3, 24, 44);

    // Base
    g.fillStyle(0xeceff1, 1);
    g.fillRect(x, y + 16, 24, 30);
    // Base highlight
    g.fillStyle(0xffffff, 0.2);
    g.fillRect(x + 2, y + 18, 6, 26);

    // Water bottle
    g.fillStyle(0xb3e5fc, 0.5);
    g.fillRect(x + 4, y, 16, 18);
    // Bottle cap
    g.fillStyle(0x0288d1, 1);
    g.fillRect(x + 6, y - 2, 12, 3);
    // Water level
    g.fillStyle(0x4fc3f7, 0.4);
    g.fillRect(x + 5, y + 4, 14, 12);
    // Water highlights
    g.fillStyle(0xffffff, 0.2);
    g.fillRect(x + 6, y + 2, 3, 14);

    // Tap
    g.fillStyle(P.coffeeMetal, 1);
    g.fillRect(x + 8, y + 24, 8, 3);

    // Cup
    g.fillStyle(0xffffff, 0.8);
    g.fillRect(x + 9, y + 30, 6, 6);
  }

  /** Full teardown + rebuild; used on resize and initial render */
  private fullRebuildAgents() {
    // Remove everything
    this.agentSprites.forEach((c) => c.destroy());
    this.agentSprites.clear();
    this.thoughtBubbles.forEach((c) => c.destroy());
    this.thoughtBubbles.clear();
    this.agentAnimKeys.clear();
    this.agentSnapshot.clear();
    this.walkTimers.forEach((t) => t.destroy());
    this.walkTimers.clear();
    this.agentIndex = 0;

    this.assignDesks();

    for (const agent of this.agents) {
      this.createAgentSprite(agent);
    }
    this.scheduleIdleWalks();
  }

  /** Assign working agents to desk positions (mutates agent.position) */
  private assignDesks() {
    const usedDesks = new Set<number>();
    for (const agent of this.agents) {
      if (agent.status !== 'idle') {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < this.deskPositions.length; i++) {
          if (usedDesks.has(i)) continue;
          const d = this.deskPositions[i];
          const dist = Math.abs(d.x - agent.position.x) + Math.abs(d.y - agent.position.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) {
          usedDesks.add(bestIdx);
          agent.position.x = this.deskPositions[bestIdx].x;
          agent.position.y = this.deskPositions[bestIdx].y;
        }
      }
    }
  }

  /** Destroy a single agent's sprite, thought bubble, walk timer, and tweens */
  private destroyAgentSprite(id: string) {
    const container = this.agentSprites.get(id);
    if (container) {
      this.tweens.killTweensOf(container);
      // Also kill tweens on children (status dot pulse)
      container.getAll().forEach((child) => this.tweens.killTweensOf(child));
      container.destroy();
      this.agentSprites.delete(id);
    }
    this.hideThoughtBubble(id);
    const timer = this.walkTimers.get(id);
    if (timer) {
      timer.destroy();
      this.walkTimers.delete(id);
    }
    this.agentAnimKeys.delete(id);
  }

  private statusToAnim(status: string): AnimState {
    switch (status) {
      case 'thinking': return 'think';
      case 'working': return 'type';
      case 'speaking': return 'type';
      default: return 'idle';
    }
  }

  private createAgentSprite(agent: Agent) {
    const px = agent.position.x * TILE + TILE / 2;
    const py = agent.position.y * TILE + TILE / 2;

    const container = this.add.container(px, py);
    container.setDepth(10);

    // Selection highlight — soft glow ring
    const highlight = this.add.graphics();
    highlight.setName('highlight');
    highlight.fillStyle(0xffffff, 0.08);
    highlight.fillCircle(0, 0, 26);
    highlight.fillStyle(0xffffff, 0.12);
    highlight.fillCircle(0, 0, 20);
    highlight.setVisible(agent.id === this.selectedAgentId);
    container.add(highlight);

    // Generate sprite sheet from agent color
    const shirtColor = parseInt(agent.color.replace('#', ''), 16);
    const palette = buildPalette(shirtColor, this.agentIndex++);
    const animKeys = registerAgentTextures(this, agent.id, palette);
    this.agentAnimKeys.set(agent.id, animKeys);

    // Create animated sprite
    const animState = this.statusToAnim(agent.status);
    const sprite = this.add.sprite(0, -2, animKeys[animState]);
    sprite.setName('sprite');
    sprite.play(animKeys[animState]);
    container.add(sprite);

    // Name tag with background
    const nameText = this.add.text(0, 24, agent.name, {
      fontSize: '9px',
      fontFamily: '"SF Pro", "Segoe UI", system-ui, sans-serif',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
      fontStyle: 'bold',
      resolution: window.devicePixelRatio,
    });
    nameText.setOrigin(0.5, 0);
    container.add(nameText);

    // Role text
    const roleText = this.add.text(0, 35, agent.role, {
      fontSize: '7px',
      fontFamily: '"SF Pro", "Segoe UI", system-ui, sans-serif',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
      resolution: window.devicePixelRatio,
    });
    roleText.setOrigin(0.5, 0);
    container.add(roleText);

    // Status indicator — pill badge
    const statusColor = agent.status === 'thinking' ? 0xf39c12 : agent.status === 'working' ? 0x2ecc71 : agent.status === 'speaking' ? 0x3498db : 0x7f8c8d;
    const statusGfx = this.add.graphics();
    statusGfx.setName('statusDot');
    // Outer ring
    statusGfx.fillStyle(0x000000, 0.3);
    statusGfx.fillCircle(16, -22, 6);
    // Dot
    statusGfx.fillStyle(statusColor, 1);
    statusGfx.fillCircle(16, -22, 4.5);
    // Highlight
    statusGfx.fillStyle(0xffffff, 0.3);
    statusGfx.fillCircle(15, -23, 2);
    container.add(statusGfx);

    // Pulse animation on status when active
    if (agent.status !== 'idle') {
      this.tweens.add({
        targets: statusGfx,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Interaction
    container.setSize(TILE, TILE);
    container.setInteractive({ cursor: 'pointer' });
    container.on('pointerdown', () => {
      if (this.onAgentClick) this.onAgentClick(agent);
    });
    container.on('pointerover', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 150,
        ease: 'Back.easeOut',
      });
      if (agent.currentThought) this.showThoughtBubble(agent, container);
    });
    container.on('pointerout', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        duration: 150,
        ease: 'Quad.easeOut',
      });
      this.hideThoughtBubble(agent.id);
    });

    // Idle bob animation
    if (agent.status === 'idle') {
      this.startIdleBob(container, py);
    }

    this.agentSprites.set(agent.id, container);

    // Save snapshot so differential updates can detect changes
    this.agentSnapshot.set(agent.id, {
      status: agent.status,
      name: agent.name,
      role: agent.role,
      color: agent.color,
      thought: agent.currentThought ?? '',
    });
  }

  private showThoughtBubble(agent: Agent, _container: Phaser.GameObjects.Container) {
    this.hideThoughtBubble(agent.id);
    if (!agent.currentThought) return;

    const px = agent.position.x * TILE + TILE / 2;
    const py = agent.position.y * TILE;

    const bubble = this.add.container(px, py - 44);
    bubble.setDepth(25);

    const maxW = 180;
    const text = this.add.text(0, 0, agent.currentThought, {
      fontSize: '9px',
      fontFamily: '"SF Pro", "Segoe UI", system-ui, sans-serif',
      color: '#1a1a2e',
      wordWrap: { width: maxW - 20 },
      align: 'center',
      lineSpacing: 2,
      resolution: window.devicePixelRatio,
    });
    text.setOrigin(0.5, 1);

    const tw = Math.min(text.width + 20, maxW);
    const th = text.height + 14;

    const bg = this.add.graphics();
    // Shadow
    bg.fillStyle(0x000000, 0.12);
    bg.fillRoundedRect(-tw / 2 + 2, -th + 2, tw, th, 8);
    // Background
    bg.fillStyle(0xffffff, 0.96);
    bg.fillRoundedRect(-tw / 2, -th, tw, th, 8);
    // Border
    bg.lineStyle(1.5, 0xcccccc, 0.8);
    bg.strokeRoundedRect(-tw / 2, -th, tw, th, 8);
    // Tail — three small circles
    bg.fillStyle(0xffffff, 0.96);
    bg.fillCircle(0, 4, 4);
    bg.fillCircle(-3, 10, 2.5);
    bg.fillCircle(-5, 15, 1.5);

    bubble.add(bg);
    bubble.add(text);

    // Fade in
    bubble.setAlpha(0);
    this.tweens.add({
      targets: bubble,
      alpha: 1,
      y: py - 48,
      duration: 200,
      ease: 'Back.easeOut',
    });

    this.thoughtBubbles.set(agent.id, bubble);
  }

  private hideThoughtBubble(agentId: string) {
    const b = this.thoughtBubbles.get(agentId);
    if (b) {
      b.destroy();
      this.thoughtBubbles.delete(agentId);
    }
  }

  /** Smoothly transition an agent whose status changed without full rebuild */
  private transitionAgentStatus(agent: Agent) {
    const container = this.agentSprites.get(agent.id);
    if (!container) return;

    // Kill all existing tweens on this container (bob, walk, etc.)
    this.tweens.killTweensOf(container);
    container.getAll().forEach((child) => this.tweens.killTweensOf(child));

    // Cancel any pending walk timer
    const timer = this.walkTimers.get(agent.id);
    if (timer) {
      timer.destroy();
      this.walkTimers.delete(agent.id);
    }

    // Update animation state
    const animKeys = this.agentAnimKeys.get(agent.id);
    const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite | null;
    if (sprite && animKeys) {
      const animState = this.statusToAnim(agent.status);
      sprite.play(animKeys[animState]);
    }

    // Update status dot
    const oldStatusGfx = container.getByName('statusDot') as Phaser.GameObjects.Graphics | null;
    if (oldStatusGfx) {
      oldStatusGfx.destroy();
    }
    const statusColor = agent.status === 'thinking' ? 0xf39c12 : agent.status === 'working' ? 0x2ecc71 : agent.status === 'speaking' ? 0x3498db : 0x7f8c8d;
    const statusGfx = this.add.graphics();
    statusGfx.setName('statusDot');
    statusGfx.fillStyle(0x000000, 0.3);
    statusGfx.fillCircle(16, -22, 6);
    statusGfx.fillStyle(statusColor, 1);
    statusGfx.fillCircle(16, -22, 4.5);
    statusGfx.fillStyle(0xffffff, 0.3);
    statusGfx.fillCircle(15, -23, 2);
    container.add(statusGfx);

    if (agent.status !== 'idle') {
      this.tweens.add({
        targets: statusGfx,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Smoothly tween to new position (desk or wherever)
    const targetX = agent.position.x * TILE + TILE / 2;
    const targetY = agent.position.y * TILE + TILE / 2;
    const dx = Math.abs(container.x - targetX);
    const dy = Math.abs(container.y - targetY);
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Duration scales with distance — minimum 400ms, ~8px per ms
    const moveDuration = Math.max(400, Math.min(1500, distance * 4));

    // Use walk animation while moving to new position
    if (sprite && animKeys && distance > 4) {
      sprite.play(animKeys.walk);
    }

    this.tweens.add({
      targets: container,
      x: targetX,
      y: targetY,
      duration: moveDuration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        // Switch to correct animation for final status
        if (sprite && animKeys) {
          const animState = this.statusToAnim(agent.status);
          sprite.play(animKeys[animState]);
        }
        // Resume idle behaviors if idle
        if (agent.status === 'idle') {
          this.startIdleBob(container, targetY);
          this.scheduleWalk(agent.id);
        }
      },
    });

    // Update snapshot
    this.agentSnapshot.set(agent.id, {
      status: agent.status,
      name: agent.name,
      role: agent.role,
      color: agent.color,
      thought: agent.currentThought ?? '',
    });
  }

  /** Start a gentle idle bob animation on a container */
  private startIdleBob(container: Phaser.GameObjects.Container, baseY: number) {
    this.tweens.add({
      targets: container,
      y: baseY - 2,
      duration: 1200 + Math.random() * 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: Math.random() * 500,
    });
  }

  private scheduleIdleWalks() {
    for (const agent of this.agents) {
      this.scheduleWalk(agent.id);
    }
  }

  private scheduleWalk(agentId: string) {
    const delay = 5000 + Math.random() * 10000;
    const timer = this.time.delayedCall(delay, () => {
      const agent = this.agents.find((a) => a.id === agentId);
      if (!agent || agent.status !== 'idle') {
        this.scheduleWalk(agentId);
        return;
      }
      // Pick a random nearby position (1 tile away)
      const dx = Math.floor(Math.random() * 3) - 1;
      const dy = Math.floor(Math.random() * 3) - 1;
      if (dx === 0 && dy === 0) {
        // No movement — just reschedule
        this.scheduleWalk(agentId);
        return;
      }
      const nx = Math.max(1, Math.min(this.cols - 2, agent.position.x + dx));
      const ny = Math.max(1, Math.min(this.rows - 2, agent.position.y + dy));
      this.agentTargets.set(agentId, { x: nx, y: ny });

      const container = this.agentSprites.get(agentId);
      if (container) {
        // Kill the idle bob tween before walking
        this.tweens.killTweensOf(container);

        // Switch to walk animation
        const animKeys = this.agentAnimKeys.get(agentId);
        const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite | null;
        if (sprite && animKeys) {
          sprite.play(animKeys.walk);
        }

        const targetX = nx * TILE + TILE / 2;
        const targetY = ny * TILE + TILE / 2;

        this.tweens.add({
          targets: container,
          x: targetX,
          y: targetY,
          duration: 1000 + Math.random() * 500,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            // Switch back to idle animation
            if (sprite && animKeys) {
              sprite.play(animKeys.idle);
            }
            // Update the agent position record locally in scene (doesn't persist)
            agent.position.x = nx;
            agent.position.y = ny;
            // Restart idle bob at new position
            this.startIdleBob(container, targetY);
            this.scheduleWalk(agentId);
          },
        });
      } else {
        this.scheduleWalk(agentId);
      }
    });
    this.walkTimers.set(agentId, timer);
  }
}
