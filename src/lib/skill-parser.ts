import { AgentSkill, SkillMetadata } from "./types";

/**
 * Parse a SKILL.md file into an AgentSkill.
 * Handles YAML frontmatter with name, description, and metadata fields.
 * The markdown body (after frontmatter) becomes the skill content.
 */
export function parseSkill(raw: string): AgentSkill {
  const { frontmatter, body } = extractFrontmatter(raw);

  const name = extractField(frontmatter, "name") || "Unnamed Skill";
  const description = extractField(frontmatter, "description") || "";
  const homepage = extractField(frontmatter, "homepage") || undefined;
  const emoji =
    extractField(frontmatter, "emoji") ||
    extractNestedField(frontmatter, "emoji");
  const metadata = parseMetadata(frontmatter);

  // Pull emoji from metadata if not at top level
  const resolvedEmoji = emoji || metadata?.emoji;

  // Parse active skill fields (top-level in frontmatter)
  const runtime = extractField(frontmatter, "runtime");
  if (runtime) {
    if (!metadata) {
      // parseMetadata returned null but we have active skill fields
    }
    const meta = metadata || ({} as SkillMetadata);
    meta.runtime = runtime;

    // Parse auth block
    const authType = extractNestedField(frontmatter, "type");
    const authProvider = extractNestedField(frontmatter, "provider");
    const authScopes = extractListAfterKey(frontmatter, "scopes");
    if (authType) {
      meta.auth = {
        type: authType as "oauth2" | "api-key" | "token",
        ...(authProvider && { provider: authProvider }),
        ...(authScopes.length && { scopes: authScopes }),
      };
    }

    // Parse tools list
    const tools = extractListAfterKey(frontmatter, "tools");
    if (tools.length) meta.tools = tools;

    // Parse triggers list
    const triggers = extractListAfterKey(frontmatter, "triggers");
    if (triggers.length) meta.triggers = triggers;

    return {
      id: crypto.randomUUID(),
      name: resolvedEmoji ? `${resolvedEmoji} ${name}` : name,
      content: body.trim(),
      description,
      ...(homepage && { homepage }),
      metadata: meta,
    };
  }

  return {
    id: crypto.randomUUID(),
    name: resolvedEmoji ? `${resolvedEmoji} ${name}` : name,
    content: body.trim(),
    description,
    ...(homepage && { homepage }),
    metadata: metadata || undefined,
  };
}

/**
 * Detect whether raw text looks like a SKILL.md (has --- frontmatter).
 */
export function isSkillFormat(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("---");
}

/**
 * Split a SKILL.md into frontmatter text and markdown body.
 */
function extractFrontmatter(raw: string): {
  frontmatter: string;
  body: string;
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: "", body: raw };
  }

  // Find closing ---
  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter: "", body: raw };
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
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = fm.match(regex);
  if (!match) return null;

  let val = match[1].trim();
  // Strip surrounding quotes
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  return val || null;
}

/**
 * Extract a nested field from the metadata section.
 * Handles both YAML style and JSON-in-YAML style.
 */
function extractNestedField(fm: string, key: string): string | null {
  // Try plain YAML style: "emoji: 🐙"
  const yamlMatch = fm.match(new RegExp(`^\\s+${key}:\\s*(.+)$`, "m"));
  if (yamlMatch) {
    let val = yamlMatch[1].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val || null;
  }

  // Try JSON style: "\"emoji\": \"🐙\""
  const jsonMatch = fm.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "m"));
  if (jsonMatch) return jsonMatch[1] || null;

  return null;
}

/**
 * Try to parse the metadata block as JSON — handles both direct metadata objects
 * and the openclaw envelope format: metadata: { "openclaw": { ... } }
 */
function tryParseMetadataJSON(fm: string): SkillMetadata | null {
  // Find the metadata block — everything after "metadata:" until next top-level key or end
  const metaStart = fm.match(/^metadata:\s*$/m) || fm.match(/^metadata:\s*\{/m);
  if (!metaStart) return null;

  const startIdx = metaStart.index! + metaStart[0].indexOf("{");
  if (startIdx < metaStart.index!) return null; // no opening brace

  // Find matching closing brace
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < fm.length; i++) {
    if (fm[i] === "{") depth++;
    else if (fm[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return null;

  try {
    // Clean trailing commas (common in hand-written JSON)
    const jsonStr = fm
      .slice(startIdx, endIdx + 1)
      .replace(/,\s*([\]}])/g, "$1");
    const parsed = JSON.parse(jsonStr);

    // Unwrap openclaw envelope if present
    const source = parsed.openclaw || parsed;
    return jsonToSkillMetadata(source);
  } catch {
    return null;
  }
}

/**
 * Convert a parsed JSON object to SkillMetadata.
 */
function jsonToSkillMetadata(obj: Record<string, unknown>): SkillMetadata {
  const meta: SkillMetadata = {};

  if (typeof obj.emoji === "string") meta.emoji = obj.emoji;

  if (Array.isArray(obj.os)) {
    meta.os = obj.os.filter((s): s is string => typeof s === "string");
  }

  const req = obj.requires as Record<string, unknown> | undefined;
  if (req && typeof req === "object") {
    meta.requires = {};
    if (Array.isArray(req.bins))
      meta.requires.bins = req.bins.filter(
        (s): s is string => typeof s === "string",
      );
    if (Array.isArray(req.anyBins))
      meta.requires.anyBins = req.anyBins.filter(
        (s): s is string => typeof s === "string",
      );
    if (Array.isArray(req.config))
      meta.requires.config = req.config.filter(
        (s): s is string => typeof s === "string",
      );
  }

  if (Array.isArray(obj.install)) {
    const installs: NonNullable<SkillMetadata["install"]> = [];
    for (const item of obj.install) {
      if (typeof item === "object" && item && "id" in item && "kind" in item) {
        const i = item as Record<string, unknown>;
        installs.push({
          id: String(i.id),
          kind: String(i.kind),
          label: String(i.label || ""),
          ...(typeof i.formula === "string" && { formula: i.formula }),
          ...(typeof i.package === "string" && { package: i.package }),
          ...(typeof i.module === "string" && { module: i.module }),
          ...(Array.isArray(i.bins) && {
            bins: i.bins.filter((s): s is string => typeof s === "string"),
          }),
        });
      }
    }
    if (installs.length) meta.install = installs;
  }

  return meta;
}

/**
 * Parse the metadata block from frontmatter.
 * Supports three formats:
 *   1. Direct YAML metadata fields
 *   2. JSON metadata object
 *   3. openclaw envelope: metadata: { "openclaw": { ... } }
 */
function parseMetadata(fm: string): SkillMetadata | null {
  if (!fm) return null;
  if (!fm.includes("metadata")) return null;

  // Try JSON/openclaw format first
  const jsonMeta = tryParseMetadataJSON(fm);
  if (jsonMeta && Object.keys(jsonMeta).length > 0) return jsonMeta;

  // Fall back to YAML-style extraction
  const meta: SkillMetadata = {};

  // Extract emoji
  const emoji = extractNestedField(fm, "emoji");
  if (emoji) meta.emoji = emoji;

  // Extract OS constraints
  const osMatch = fm.match(/os:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (osMatch) {
    meta.os =
      osMatch[1].match(/-\s*(\S+)/g)?.map((m) => m.replace(/^-\s*/, "")) || [];
  }

  // Extract requires.bins
  const bins = extractListAfterKey(fm, "bins");
  const anyBins = extractListAfterKey(fm, "anyBins");
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
  const yamlMatch = fm.match(
    new RegExp(`${key}:\\s*\\n((?:\\s+-\\s*.+\\n?)+)`, "m"),
  );
  if (yamlMatch) {
    return (
      yamlMatch[1]
        .match(/- \s*(\S+)/g)
        ?.map((m) => m.replace(/^-\s*/, "").trim()) || []
    );
  }

  // JSON style: "bins": ["gh", "git"]
  const jsonMatch = fm.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]+)\\]`));
  if (jsonMatch) {
    return jsonMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return [];
}

/**
 * Parse install blocks from frontmatter.
 */
function parseInstallBlocks(fm: string): SkillMetadata["install"] {
  const installs: NonNullable<SkillMetadata["install"]> = [];

  // JSON format: objects with "id", "kind", "label" etc.
  const jsonInstallRegex =
    /"id"\s*:\s*"([^"]+)"[^}]*?"kind"\s*:\s*"([^"]+)"[^}]*?"label"\s*:\s*"([^"]+)"/g;
  let jm;
  while ((jm = jsonInstallRegex.exec(fm)) !== null) {
    const block = fm.slice(
      Math.max(0, fm.lastIndexOf("{", jm.index)),
      fm.indexOf("}", jm.index + jm[0].length) + 1,
    );
    const formula = block.match(/"formula"\s*:\s*"([^"]+)"/)?.[1];
    const pkg = block.match(/"package"\s*:\s*"([^"]+)"/)?.[1];
    const mod = block.match(/"module"\s*:\s*"([^"]+)"/)?.[1];
    const binsMatch = block.match(/"bins"\s*:\s*\[([^\]]+)\]/);
    const bins = binsMatch
      ? binsMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : [];

    installs.push({
      id: jm[1],
      kind: jm[2],
      label: jm[3],
      ...(formula && { formula }),
      ...(pkg && { package: pkg }),
      ...(mod && { module: mod }),
      ...(bins.length && { bins }),
    });
  }

  if (installs.length) return installs;

  // YAML format: list of objects under install:
  const yamlInstallSection = fm.match(
    /install:\s*\n((?:\s+-[\s\S]*?)(?=\n\S|\n*$))/m,
  );
  if (yamlInstallSection) {
    const items = yamlInstallSection[1].split(/\n\s+-\s+/).filter(Boolean);
    for (const item of items) {
      const text = item.startsWith("-") ? item.slice(1).trim() : item;
      const id = text.match(/id:\s*(\S+)/)?.[1] || "";
      const kind = text.match(/kind:\s*(\S+)/)?.[1] || "";
      const label = text.match(/label:\s*["']?(.+?)["']?\s*$/m)?.[1] || "";
      const formula = text.match(/formula:\s*(\S+)/)?.[1];
      const pkg = text.match(/package:\s*(\S+)/)?.[1];
      const mod = text.match(/module:\s*(\S+)/)?.[1];
      const binsMatch = text.match(/bins:\s*\n((?:\s+-\s*.+\n?)+)/);
      const bins = binsMatch
        ? binsMatch[1]
            .match(/-\s*(\S+)/g)
            ?.map((m) => m.replace(/^-\s*/, "")) || []
        : [];

      if (id && kind) {
        installs.push({
          id,
          kind,
          label,
          ...(formula && { formula }),
          ...(pkg && { package: pkg }),
          ...(mod && { module: mod }),
          ...(bins.length && { bins }),
        });
      }
    }
  }

  return installs.length ? installs : undefined;
}
