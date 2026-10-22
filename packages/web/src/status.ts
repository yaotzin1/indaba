import type { RunStatus } from '@indaba/core';
import { messages } from './messages.js';

/** The look of a state: a class for colour, a symbol and a word. Colour only repeats the symbol and the word (AC-07). */
export type Tone = 'completed' | 'running' | 'failed' | 'escalated' | 'pending';

export interface StateLook {
  readonly tone: Tone;
  readonly symbol: string;
  readonly word: string;
}

const COMPLETED: StateLook = { tone: 'completed', symbol: '✓', word: messages.state.completed };
const RUNNING: StateLook = { tone: 'running', symbol: '▶', word: messages.state.running };
const FAILED: StateLook = { tone: 'failed', symbol: '✗', word: messages.state.failed };
const ESCALATED: StateLook = { tone: 'escalated', symbol: '▲', word: messages.state.escalated };
const PENDING: StateLook = { tone: 'pending', symbol: '○', word: messages.state.pending };

/** A step's state as the engine names it (`PENDING`, `RUNNING`, ...); anything else is shown as unknown. */
export function stepLook(status: string): StateLook {
  switch (status) {
    case 'COMPLETED':
      return COMPLETED;
    case 'RUNNING':
      return RUNNING;
    case 'VALIDATING':
      return { ...RUNNING, word: messages.state.validating };
    case 'FAILED':
      return FAILED;
    case 'ESCALATED':
      return ESCALATED;
    case 'CANCELLED':
      return { tone: 'pending', symbol: '■', word: messages.state.cancelled };
    case 'PENDING':
      return PENDING;
    default:
      return { tone: 'pending', symbol: '?', word: messages.state.unknown };
  }
}

export function runLook(status: RunStatus): StateLook {
  switch (status) {
    case 'completed':
      return COMPLETED;
    case 'running':
      return RUNNING;
    case 'failed':
      return FAILED;
    case 'escalated':
      return ESCALATED;
    case 'cancelled':
      return { tone: 'pending', symbol: '■', word: messages.state.cancelled };
    default:
      return { tone: 'pending', symbol: '?', word: messages.state.unknown };
  }
}

/** Whether a step is under way, so its node is the one marked active. */
export function isActive(status: string): boolean {
  return status === 'RUNNING' || status === 'VALIDATING';
}
