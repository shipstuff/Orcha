export type CommandType = 'approve' | 'reject' | 'stop' | 'restart';

export interface Command {
  type: CommandType;
  args?: string;
}

const commandPatterns: Array<{ pattern: RegExp; type: CommandType }> = [
  { pattern: /^\s*\/approve\s*$/i, type: 'approve' },
  { pattern: /^\s*\/reject\s*$/i, type: 'reject' },
  { pattern: /^\s*\/stop\s*$/i, type: 'stop' },
  { pattern: /^\s*\/restart\s*$/i, type: 'restart' },
];

export function parseCommand(text: string): Command | null {
  // Check each line of the comment for commands
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    for (const { pattern, type } of commandPatterns) {
      if (pattern.test(trimmed)) {
        return { type };
      }
    }
  }

  return null;
}

export function isApprovalCommand(text: string): boolean {
  const command = parseCommand(text);
  return command?.type === 'approve';
}

export function isRejectCommand(text: string): boolean {
  const command = parseCommand(text);
  return command?.type === 'reject';
}

export function isStopCommand(text: string): boolean {
  const command = parseCommand(text);
  return command?.type === 'stop';
}

export function isRestartCommand(text: string): boolean {
  const command = parseCommand(text);
  return command?.type === 'restart';
}
