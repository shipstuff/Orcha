import { SessionState } from '../database/repositories/sessions.js';

export interface StateTransition {
  from: SessionState | SessionState[];
  to: SessionState;
  event: string;
}

// Define valid state transitions
const transitions: StateTransition[] = [
  // Initial transitions based on user type
  { from: 'created', to: 'waiting_approval', event: 'requires_approval' },
  { from: 'created', to: 'approved', event: 'auto_approved' },

  // Approval workflow
  { from: 'waiting_approval', to: 'approved', event: 'approve' },
  { from: 'waiting_approval', to: 'stopped', event: 'reject' },

  // Agent lifecycle
  { from: 'approved', to: 'initializing', event: 'start' },
  { from: 'initializing', to: 'running', event: 'initialized' },
  { from: 'running', to: 'waiting', event: 'question' },
  { from: 'running', to: 'completing', event: 'completing' },
  { from: 'running', to: 'failed', event: 'error' },
  { from: 'waiting', to: 'running', event: 'answer' },
  { from: 'completing', to: 'completed', event: 'completed' },
  { from: 'completing', to: 'failed', event: 'error' },

  // Stop from any active state
  {
    from: ['created', 'waiting_approval', 'approved', 'initializing', 'running', 'waiting', 'completing'],
    to: 'stopped',
    event: 'stop',
  },

  // Restart from terminal states
  { from: ['completed', 'failed', 'stopped'], to: 'approved', event: 'restart' },
];

export type StateEvent =
  | 'requires_approval'
  | 'auto_approved'
  | 'approve'
  | 'reject'
  | 'start'
  | 'initialized'
  | 'question'
  | 'answer'
  | 'completing'
  | 'completed'
  | 'error'
  | 'stop'
  | 'restart';

export function canTransition(from: SessionState, event: StateEvent): SessionState | null {
  for (const transition of transitions) {
    const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from];

    if (fromStates.includes(from) && transition.event === event) {
      return transition.to;
    }
  }

  return null;
}

export function isTerminalState(state: SessionState): boolean {
  return ['completed', 'failed', 'stopped'].includes(state);
}

export function isActiveState(state: SessionState): boolean {
  return ['initializing', 'running', 'waiting', 'completing'].includes(state);
}

export function canStop(state: SessionState): boolean {
  return canTransition(state, 'stop') !== null;
}

export function canRestart(state: SessionState): boolean {
  return canTransition(state, 'restart') !== null;
}

export function getStateLabel(state: SessionState): string {
  const labels: Record<SessionState, string> = {
    created: 'Created',
    waiting_approval: 'Waiting for Approval',
    approved: 'Approved',
    initializing: 'Initializing',
    running: 'Running',
    waiting: 'Waiting for Input',
    completing: 'Completing',
    completed: 'Completed',
    failed: 'Failed',
    stopped: 'Stopped',
  };

  return labels[state];
}

export function getStateEmoji(state: SessionState): string {
  const emojis: Record<SessionState, string> = {
    created: '🆕',
    waiting_approval: '🔐',
    approved: '✓',
    initializing: '⚙️',
    running: '🏃',
    waiting: '❓',
    completing: '📝',
    completed: '✅',
    failed: '❌',
    stopped: '⏹️',
  };

  return emojis[state];
}
