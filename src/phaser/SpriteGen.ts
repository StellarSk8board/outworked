/**
 * Procedural chibi character sprite generator v2.
 * Draws smooth, detailed characters using canvas 2D API at 48×48 resolution.
 * Each character has 4 animation states × 2 frames = 8 frames.
 */

export const FRAME_PX = 48;
export type AnimState = 'idle' | 'walk' | 'type' | 'think';

export interface CharacterPalette {
  skin: number;
  shirt: number;
  shirtDark: number;
  hair: number;
  pants: number;
  shoes: number;
  white: number;
  eye: number;
  mouth: number;
  hairStyle: number;
}

const SKIN_TONES = [0xffe0bd, 0xf5c8a0, 0xd4a574, 0xc68642, 0x8d5524];
const HAIR_COLORS = [0x2c1810, 0x8b4513, 0xd4a020, 0xc0392b, 0x1a1a2e];

export function buildPalette(shirtColor: number, index: number): CharacterPalette {
  const skinIdx = index % SKIN_TONES.length;
  const hairIdx = (index * 3 + 1) % HAIR_COLORS.length;
  const r = (shirtColor >> 16) & 0xff;
  const g = (shirtColor >> 8) & 0xff;
  const b = shirtColor & 0xff;
  const dark = (Math.max(0, r - 40) << 16) | (Math.max(0, g - 40) << 8) | Math.max(0, b - 40);

  return {
    skin: SKIN_TONES[skinIdx],
    shirt: shirtColor,
    shirtDark: dark,
    hair: HAIR_COLORS[hairIdx],
    pants: 0x2c3e50,
    shoes: 0x1a1a2e,
    white: 0xffffff,
    eye: 0x1a1a2e,
    mouth: 0xc0392b,
    hairStyle: index % 5,
  };
}

// ---- color helpers ----
function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
function lighten(c: number, amt: number): string {
  const r = Math.min(255, ((c >> 16) & 0xff) + amt);
  const g = Math.min(255, ((c >> 8) & 0xff) + amt);
  const b = Math.min(255, (c & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

// ---- geometry helpers ----
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- character dimensions ----
const CX = 24;
const HEAD_CY = 14;
const HEAD_R = 11;
const BODY_TOP = 25;
const BODY_H = 11;
const BODY_W = 14;
const SHOULDER_Y = 27;
const LEG_W = 5;
const LEG_H = 7;
const SHOE_H = 3;

// ---- frame specifications ----
interface FrameSpec {
  dy: number;
  blink: boolean;
  mouthOpen: boolean;
  lh: [number, number]; // left hand position
  rh: [number, number]; // right hand position
  lf: [number, number]; // left foot position
  rf: [number, number]; // right foot position
}

const SPECS: Record<string, FrameSpec> = {
  idle_0: { dy: 0, blink: false, mouthOpen: false, lh: [14, 36], rh: [34, 36], lf: [20, 44], rf: [28, 44] },
  idle_1: { dy: -1, blink: true, mouthOpen: false, lh: [14, 35], rh: [34, 35], lf: [20, 44], rf: [28, 44] },
  walk_0: { dy: -1, blink: false, mouthOpen: false, lh: [18, 32], rh: [30, 38], lf: [18, 44], rf: [30, 44] },
  walk_1: { dy: 0, blink: false, mouthOpen: false, lh: [18, 38], rh: [30, 32], lf: [22, 44], rf: [26, 44] },
  type_0: { dy: 0, blink: false, mouthOpen: false, lh: [18, 34], rh: [30, 34], lf: [20, 44], rf: [28, 44] },
  type_1: { dy: 0, blink: false, mouthOpen: false, lh: [16, 35], rh: [32, 33], lf: [20, 44], rf: [28, 44] },
  think_0: { dy: 0, blink: false, mouthOpen: false, lh: [14, 36], rh: [28, 22], lf: [20, 44], rf: [28, 44] },
  think_1: { dy: -1, blink: false, mouthOpen: true, lh: [14, 35], rh: [28, 21], lf: [20, 44], rf: [28, 44] },
};

// ---- drawing functions ----

function drawLeg(ctx: CanvasRenderingContext2D, p: CharacterPalette, cx: number, topY: number) {
  // Pants
  ctx.fillStyle = hex(p.pants);
  rrect(ctx, cx - LEG_W / 2, topY, LEG_W, LEG_H, 1);
  ctx.fill();
  // Pants highlight
  ctx.fillStyle = lighten(p.pants, 15);
  ctx.fillRect(cx - LEG_W / 2 + 1, topY + 1, 2, LEG_H - 2);
  // Shoe
  ctx.fillStyle = hex(p.shoes);
  rrect(ctx, cx - LEG_W / 2 - 1, topY + LEG_H - 1, LEG_W + 2, SHOE_H, 1.5);
  ctx.fill();
  // Shoe highlight
  ctx.fillStyle = lighten(p.shoes, 50);
  ctx.fillRect(cx - LEG_W / 2, topY + LEG_H, LEG_W, 1);
}

function drawArm(ctx: CanvasRenderingContext2D, p: CharacterPalette, sx: number, sy: number, ex: number, ey: number) {
  // Sleeve
  ctx.strokeStyle = hex(p.shirt);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // Sleeve highlight
  ctx.strokeStyle = lighten(p.shirt, 25);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 1);
  ctx.lineTo((sx + ex) / 2, (sy + ey) / 2 - 1);
  ctx.stroke();
  // Hand
  ctx.fillStyle = hex(p.skin);
  ctx.beginPath();
  ctx.arc(ex, ey, 3, 0, Math.PI * 2);
  ctx.fill();
  // Hand highlight
  ctx.fillStyle = lighten(p.skin, 20);
  ctx.beginPath();
  ctx.arc(ex - 0.5, ey - 0.5, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBody(ctx: CanvasRenderingContext2D, p: CharacterPalette, dy: number) {
  const bx = CX - BODY_W / 2;
  const by = BODY_TOP + dy;

  // Body shadow
  ctx.fillStyle = hex(p.shirtDark);
  rrect(ctx, bx, by, BODY_W, BODY_H, 3);
  ctx.fill();

  // Body main
  ctx.fillStyle = hex(p.shirt);
  rrect(ctx, bx, by, BODY_W, BODY_H - 2, 3);
  ctx.fill();

  // Shirt highlight
  ctx.fillStyle = lighten(p.shirt, 35);
  rrect(ctx, bx + 2, by + 1, BODY_W - 4, 4, 2);
  ctx.fill();

  // Collar
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(CX - 5, by);
  ctx.lineTo(CX, by + 4);
  ctx.lineTo(CX + 5, by);
  ctx.closePath();
  ctx.fill();
  // Collar shadow
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.moveTo(CX - 4, by);
  ctx.lineTo(CX, by + 3);
  ctx.lineTo(CX + 4, by);
  ctx.closePath();
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, p: CharacterPalette, dy: number, blink: boolean, mouthOpen: boolean) {
  const cy = HEAD_CY + dy;

  // Neck
  ctx.fillStyle = hex(p.skin);
  ctx.fillRect(CX - 3, cy + HEAD_R - 3, 6, 5);

  // Head circle
  ctx.fillStyle = hex(p.skin);
  ctx.beginPath();
  ctx.arc(CX, cy, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // Head shading gradient
  const g = ctx.createRadialGradient(CX - 4, cy - 4, 1, CX, cy, HEAD_R);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(CX, cy, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = hex(p.skin);
  ctx.beginPath();
  ctx.ellipse(CX - HEAD_R + 1, cy + 2, 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(CX + HEAD_R - 1, cy + 2, 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Inner ear
  ctx.fillStyle = lighten(p.skin, -15);
  ctx.beginPath();
  ctx.ellipse(CX - HEAD_R + 1.5, cy + 2, 1.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(CX + HEAD_R - 1.5, cy + 2, 1.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  if (blink) {
    ctx.strokeStyle = hex(p.eye);
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(CX - 6, cy + 1);
    ctx.lineTo(CX - 2, cy + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX + 2, cy + 1);
    ctx.lineTo(CX + 6, cy + 1);
    ctx.stroke();
  } else {
    // Eye whites
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(CX - 4, cy + 1, 3.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(CX + 4, cy + 1, 3.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Iris
    ctx.fillStyle = '#3B5998';
    ctx.beginPath();
    ctx.arc(CX - 3.5, cy + 1.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX + 4.5, cy + 1.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Pupils
    ctx.fillStyle = hex(p.eye);
    ctx.beginPath();
    ctx.arc(CX - 3.5, cy + 1.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX + 4.5, cy + 1.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
    // Eye highlights
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(CX - 5, cy + 0.3, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX + 3, cy + 0.3, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // Small secondary highlight
    ctx.beginPath();
    ctx.arc(CX - 2.5, cy + 2.5, 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(CX + 5.5, cy + 2.5, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyebrows
  ctx.strokeStyle = hex(p.hair);
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(CX - 6, cy - 3);
  ctx.quadraticCurveTo(CX - 4, cy - 4.5, CX - 1.5, cy - 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(CX + 1.5, cy - 3);
  ctx.quadraticCurveTo(CX + 4, cy - 4.5, CX + 6, cy - 3);
  ctx.stroke();

  // Mouth
  if (mouthOpen) {
    ctx.fillStyle = '#8b0000';
    ctx.beginPath();
    ctx.ellipse(CX, cy + 6, 2.5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tongue hint
    ctx.fillStyle = '#cc4444';
    ctx.beginPath();
    ctx.ellipse(CX, cy + 6.8, 1.5, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = hex(p.mouth);
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(CX, cy + 4.5, 2.5, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  // Nose hint
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.beginPath();
  ctx.arc(CX, cy + 3.5, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Cheek blush
  ctx.fillStyle = 'rgba(255,130,130,0.18)';
  ctx.beginPath();
  ctx.ellipse(CX - 7, cy + 3.5, 3, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(CX + 7, cy + 3.5, 3, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHair(ctx: CanvasRenderingContext2D, p: CharacterPalette, dy: number, style: number) {
  const cy = HEAD_CY + dy;
  const r = HEAD_R;
  ctx.fillStyle = hex(p.hair);

  switch (style % 5) {
    case 0: { // Short neat
      ctx.beginPath();
      ctx.arc(CX, cy, r + 2, Math.PI, 0);
      ctx.lineTo(CX + r + 2, cy - 1);
      ctx.lineTo(CX - r - 2, cy - 1);
      ctx.closePath();
      ctx.fill();
      // Highlight
      ctx.fillStyle = lighten(p.hair, 30);
      ctx.beginPath();
      ctx.ellipse(CX - 2, cy - r, 5, 2.5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 1: { // Side swoop
      ctx.beginPath();
      ctx.arc(CX, cy, r + 2, Math.PI - 0.1, 0.1);
      ctx.closePath();
      ctx.fill();
      // Swoop fringe
      ctx.beginPath();
      ctx.moveTo(CX - 4, cy - r - 2);
      ctx.quadraticCurveTo(CX + 12, cy - r - 1, CX + r + 4, cy + 1);
      ctx.lineTo(CX + r + 1, cy - 2);
      ctx.arc(CX, cy, r + 2, -0.1, Math.PI, true);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lighten(p.hair, 30);
      ctx.beginPath();
      ctx.ellipse(CX + 2, cy - r, 4, 2, 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 2: { // Long
      // Top cap
      ctx.beginPath();
      ctx.arc(CX, cy, r + 2, Math.PI - 0.2, 0.2);
      ctx.closePath();
      ctx.fill();
      // Right side strand
      ctx.beginPath();
      ctx.moveTo(CX + r + 1, cy - 2);
      ctx.lineTo(CX + r + 4, cy + 8);
      ctx.quadraticCurveTo(CX + r + 2, cy + 14, CX + r - 2, cy + 12);
      ctx.lineTo(CX + r - 2, cy - 2);
      ctx.closePath();
      ctx.fill();
      // Left side strand
      ctx.beginPath();
      ctx.moveTo(CX - r - 1, cy - 2);
      ctx.lineTo(CX - r - 4, cy + 8);
      ctx.quadraticCurveTo(CX - r - 2, cy + 14, CX - r + 2, cy + 12);
      ctx.lineTo(CX - r + 2, cy - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lighten(p.hair, 25);
      ctx.beginPath();
      ctx.ellipse(CX, cy - r, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 3: { // Spiky
      ctx.beginPath();
      ctx.arc(CX, cy, r + 1, Math.PI + 0.4, -0.4);
      ctx.fill();
      const spikes = [
        { x: CX - 7, y: cy - r - 6 },
        { x: CX - 2, y: cy - r - 9 },
        { x: CX + 3, y: cy - r - 7 },
        { x: CX + 8, y: cy - r - 4 },
        { x: CX - 10, y: cy - r - 2 },
      ];
      for (const s of spikes) {
        ctx.beginPath();
        ctx.moveTo(s.x - 4, cy - r + 3);
        ctx.lineTo(s.x, s.y);
        ctx.lineTo(s.x + 4, cy - r + 3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = lighten(p.hair, 30);
      ctx.beginPath();
      ctx.ellipse(CX - 1, cy - r + 2, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 4: { // Curly poof
      const bumps = 8;
      for (let i = 0; i < bumps; i++) {
        const a = Math.PI + (i / (bumps - 1)) * Math.PI;
        const bx = CX + Math.cos(a) * (r + 3);
        const by = cy + Math.sin(a) * (r + 3);
        ctx.beginPath();
        ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = lighten(p.hair, 25);
      ctx.beginPath();
      ctx.arc(CX - 4, cy - r - 1, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

function drawCharacterFrame(
  ctx: CanvasRenderingContext2D,
  p: CharacterPalette,
  spec: FrameSpec,
  offsetX: number,
  isThink: boolean,
) {
  ctx.save();
  ctx.translate(offsetX, 0);

  const dy = spec.dy;
  const lShoulderX = CX - BODY_W / 2;
  const rShoulderX = CX + BODY_W / 2;
  const sY = SHOULDER_Y + dy;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(CX, 45, 12, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  drawLeg(ctx, p, spec.lf[0], spec.lf[1] - LEG_H - SHOE_H + 1);
  drawLeg(ctx, p, spec.rf[0], spec.rf[1] - LEG_H - SHOE_H + 1);

  // Left arm (behind body)
  drawArm(ctx, p, lShoulderX, sY, spec.lh[0], spec.lh[1] + dy);

  // Body
  drawBody(ctx, p, dy);

  // Right arm (in front if not think; for think, draw after head)
  if (!isThink) {
    drawArm(ctx, p, rShoulderX, sY, spec.rh[0], spec.rh[1] + dy);
  }

  // Head + face
  drawHead(ctx, p, dy, spec.blink, spec.mouthOpen);

  // Hair on top
  drawHair(ctx, p, dy, p.hairStyle);

  // Think: draw right arm on top (hand on chin)
  if (isThink) {
    drawArm(ctx, p, rShoulderX, sY, spec.rh[0], spec.rh[1] + dy);
  }

  ctx.restore();
}

// ---- public API ----

export function generateSpriteSheet(palette: CharacterPalette): HTMLCanvasElement {
  const states: AnimState[] = ['idle', 'walk', 'type', 'think'];
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_PX * 8;
  canvas.height = FRAME_PX;
  const ctx = canvas.getContext('2d')!;

  let fi = 0;
  for (const state of states) {
    for (let f = 0; f < 2; f++) {
      const key = `${state}_${f}`;
      const spec = SPECS[key];
      drawCharacterFrame(ctx, palette, spec, fi * FRAME_PX, state === 'think');
      fi++;
    }
  }

  return canvas;
}

export function registerAgentTextures(
  scene: Phaser.Scene,
  agentId: string,
  palette: CharacterPalette
): Record<AnimState, string> {
  const sheet = generateSpriteSheet(palette);
  const states: AnimState[] = ['idle', 'walk', 'type', 'think'];
  const keys: Record<string, string> = {};

  let frameIdx = 0;
  for (const state of states) {
    const key = `agent_${agentId}_${state}`;
    keys[state] = key;

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = FRAME_PX * 2;
    frameCanvas.height = FRAME_PX;
    const fctx = frameCanvas.getContext('2d')!;
    fctx.drawImage(
      sheet,
      frameIdx * FRAME_PX, 0, FRAME_PX * 2, FRAME_PX,
      0, 0, FRAME_PX * 2, FRAME_PX
    );

    if (scene.anims.exists(key)) scene.anims.remove(key);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addSpriteSheet(key, frameCanvas as unknown as HTMLImageElement, {
      frameWidth: FRAME_PX,
      frameHeight: FRAME_PX,
    });

    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key, { start: 0, end: 1 }),
      frameRate: state === 'walk' ? 5 : state === 'type' ? 6 : 2,
      repeat: -1,
    });

    frameIdx += 2;
  }

  return keys as Record<AnimState, string>;
}
