
export interface TaskStatus {
  assignment: { agentId: string; agentName: string; task: string };
  status: 'pending' | 'running' | 'done' | 'error';
  reply?: string;
  error?: string;
}

export interface InstructionRun {
  id: number;
  instruction: string;
  plan: string;
  tasks: TaskStatus[];
  done: boolean;
}

