// Agent-to-agent message bus
// Tracks inter-agent exchanges for the current orchestration run (not persisted)

import { AgentMessage } from "./types";

let exchanges: AgentMessage[] = [];

export function addExchange(
  fromId: string,
  fromName: string,
  toId: string,
  toName: string,
  question: string,
  response: string,
): AgentMessage {
  const msg: AgentMessage = {
    id: crypto.randomUUID(),
    fromAgentId: fromId,
    fromAgentName: fromName,
    toAgentId: toId,
    toAgentName: toName,
    question,
    response,
    timestamp: Date.now(),
  };
  exchanges.push(msg);
  return msg;
}

export function getExchanges(): AgentMessage[] {
  return [...exchanges];
}

export function clearExchanges(): void {
  exchanges = [];
}

/**
 * Parse [ASK:AgentName] question patterns from agent output.
 * Returns array of { agentName, question } or empty array if none found.
 */
export function parseAskRequests(
  text: string,
): { agentName: string; question: string }[] {
  const results: { agentName: string; question: string }[] = [];
  const regex = /\[ASK:([^\]]+)\]\s*([^\[]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const agentName = match[1].trim();
    const question = match[2].trim();
    if (agentName && question) {
      results.push({ agentName, question });
    }
  }
  return results;
}
