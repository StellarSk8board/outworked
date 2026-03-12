import { AgentSkill, SkillMetadata } from './types';

/**
 * Parse an OpenClaw SKILL.md file into an AgentSkill.
 * Handles YAML frontmatter with name, description, and metadata.openclaw fields.
 * The markdown body (after frontmatter) becomes the skill content.
 */
export function parseOpenClawSkill(raw: string): AgentSkill {
  const { frontmatter, body } = extractFrontmatter(raw);

  const name = extractField(frontmatter, 'name') || 'Unnamed Skill';
  const description = extractField(frontmatter, 'description') || '';
  const emoji = extractNestedField(frontmatter, 'emoji');
  const metadata = parseMetadata(frontmatter);

  return {
    id: crypto.randomUUID(),
    name: emoji ? `${emoji} ${name}` : name,
    content: body.trim(),
    description,
    metadata: metadata || undefined,
  };
}

/**
 * Detect whether raw text looks like an OpenClaw SKILL.md (has --- frontmatter).
 */
export function isOpenClawFormat(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith('---');
}

/**
 * Split a SKILL.md into frontmatter text and markdown body.
 */
function extractFrontmatter(raw: string): { frontmatter: string; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: '', body: raw };
  }

  // Find closing ---
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { frontmatter: '', body: raw };
  }

  const frontmatter = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trim(); // skip past \n---
  return { frontmatter, body };
}

/**
 * Extract a top-level scalar field from YAML-ish frontmatter.
 * Handles both quoted and unquoted values.
 */
function extractField(fm: string, key: string): string | null {
  // Match top-level key (not indented) followed by value
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = fm.match(regex);
  if (!match) return null;

  let val = match[1].trim();
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val || null;
}

/**
 * Extract a nested field from the metadata/openclaw section.
 * Handles both YAML style and JSON-in-YAML style.
 */
function extractNestedField(fm: string, key: string): string | null {
  // Try plain YAML style: "emoji: 🐙"
  const yamlMatch = fm.match(new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm'));
  if (yamlMatch) {
    let val = yamlMatch[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val || null;
  }

  // Try JSON style: "\"emoji\": \"🐙\""
  const jsonMatch = fm.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'm'));
  if (jsonMatch) return jsonMatch[1] || null;

  return null;
}

/**
 * Parse the openclaw metadata block from frontmatter.
 * Extracts requires (bins/anyBins), install instructions, and os constraints.
 */
function parseMetadata(fm: string): SkillMetadata | null {
  if(!fm) return null;
  if(!fm.includes('metadata')) return null;
  // if (!fm.includes('openclaw')) return null;

  const meta: SkillMetadata = {};

  // Extract emoji
  const emoji = extractNestedField(fm, 'emoji');
  if (emoji) meta.emoji = emoji;

  // Extract OS constraints
  const osMatch = fm.match(/os:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (osMatch) {
    meta.os = osMatch[1].match(/-\s*(\S+)/g)?.map((m) => m.replace(/^-\s*/, '')) || [];
  }

  // Extract requires.bins
  const bins = extractListAfterKey(fm, 'bins');
  const anyBins = extractListAfterKey(fm, 'anyBins');
  if (bins.length || anyBins.length) {
    meta.requires = {};
    if (bins.length) meta.requires.bins = bins;
    if (anyBins.length) meta.requires.anyBins = anyBins;
  }

  // Extract install array
  meta.install = parseInstallBlocks(fm);

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Extract a YAML list following a key, handling both YAML and JSON formats.
 */
function extractListAfterKey(fm: string, key: string): string[] {
  // YAML style:  bins:\n  - gh\n  - git
  const yamlMatch = fm.match(new RegExp(`${key}:\\s*\\n((?:\\s+-\\s*.+\\n?)+)`, 'm'));
  if (yamlMatch) {
    return yamlMatch[1].match(/- \s*(\S+)/g)?.map((m) => m.replace(/^-\s*/, '').trim()) || [];
  }

  // JSON style: "bins": ["gh", "git"]
  const jsonMatch = fm.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]+)\\]`));
  if (jsonMatch) {
    return jsonMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  return [];
}

/**
 * Parse install blocks from frontmatter.
 */
function parseInstallBlocks(fm: string): SkillMetadata['install'] {
  const installs: NonNullable<SkillMetadata['install']> = [];

  // JSON format: objects with "id", "kind", "label" etc.
  const jsonInstallRegex = /"id"\s*:\s*"([^"]+)"[^}]*?"kind"\s*:\s*"([^"]+)"[^}]*?"label"\s*:\s*"([^"]+)"/g;
  let jm;
  while ((jm = jsonInstallRegex.exec(fm)) !== null) {
    const block = fm.slice(Math.max(0, fm.lastIndexOf('{', jm.index)), fm.indexOf('}', jm.index + jm[0].length) + 1);
    const formula = block.match(/"formula"\s*:\s*"([^"]+)"/)?.[1];
    const pkg = block.match(/"package"\s*:\s*"([^"]+)"/)?.[1];
    const binsMatch = block.match(/"bins"\s*:\s*\[([^\]]+)\]/);
    const bins = binsMatch
      ? binsMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : [];

    installs.push({
      id: jm[1],
      kind: jm[2],
      label: jm[3],
      ...(formula && { formula }),
      ...(pkg && { package: pkg }),
      ...(bins.length && { bins }),
    });
  }

  if (installs.length) return installs;

  // YAML format: list of objects under install:
  const yamlInstallSection = fm.match(/install:\s*\n((?:\s+-[\s\S]*?)(?=\n\S|\n*$))/m);
  if (yamlInstallSection) {
    const items = yamlInstallSection[1].split(/\n\s+-\s+/).filter(Boolean);
    for (const item of items) {
      const text = item.startsWith('-') ? item.slice(1).trim() : item;
      const id = text.match(/id:\s*(\S+)/)?.[1] || '';
      const kind = text.match(/kind:\s*(\S+)/)?.[1] || '';
      const label = text.match(/label:\s*["']?(.+?)["']?\s*$/m)?.[1] || '';
      const formula = text.match(/formula:\s*(\S+)/)?.[1];
      const pkg = text.match(/package:\s*(\S+)/)?.[1];
      const binsMatch = text.match(/bins:\s*\n((?:\s+-\s*.+\n?)+)/);
      const bins = binsMatch
        ? binsMatch[1].match(/-\s*(\S+)/g)?.map((m) => m.replace(/^-\s*/, '')) || []
        : [];

      if (id && kind) {
        installs.push({
          id,
          kind,
          label,
          ...(formula && { formula }),
          ...(pkg && { package: pkg }),
          ...(bins.length && { bins }),
        });
      }
    }
  }

  return installs.length ? installs : undefined;
}

/**
 * List bundled skill names available in src/basic-skills/.
 */
export function listBundledSkillNames(): string[] {
  return [
    'apple-notes',
    'apple-reminders',
    'coding-agent',
    'gemini',
    'github',
    'gog',
    'imsg',
    'mcporter',
    'nano-pdf',
    'openai-whisper',
  ];
}
