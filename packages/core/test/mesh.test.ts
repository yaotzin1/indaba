import { describe, expect, it } from 'vitest';
import {
  AgentMessage,
  type Blackboard,
  Blackboard as Board,
  ConsensusArbiter,
  ConsensusOutcome,
  DecisionType,
  MessageType,
  type Participant,
  PingPongDetector,
  type Runner,
  RunnerParticipant,
  type RunRequest,
  RunResult,
} from '../src/index.js';

function participant(role: string, replies: readonly string[]): Participant {
  return {
    role,
    respond: async (_topic: string, _board: Blackboard, round: number): Promise<AgentMessage> => {
      const reply = replies[Math.min(round, replies.length) - 1] ?? '';
      return AgentMessage.fromReply(role, reply, round);
    },
  };
}

describe('ConsensusArbiter', () => {
  it('reaches consensus when everyone agrees', async () => {
    const result = await new ConsensusArbiter().deliberate('topic', [
      participant('architect', ['AGREEMENT: fine']),
      participant('reviewer', ['CRITIQUE: tests missing', 'AGREEMENT: ok now']),
    ]);
    expect(result.outcome).toBe(ConsensusOutcome.Reached);
    expect(result.rounds).toBe(2);
  });

  it('lets one dissenter block unanimity', async () => {
    const result = await new ConsensusArbiter({ maxRounds: 3 }).deliberate('t', [
      participant('architect', ['AGREEMENT: ok']),
      participant('reviewer', ['CRITIQUE: a', 'CRITIQUE: b', 'CRITIQUE: c']),
    ]);
    expect(result.outcome).toBe(ConsensusOutcome.MaxRoundsExceeded);
    expect(result.openObjections()).toContain('reviewer (CRITIQUE): c');
  });

  it('meets a majority quorum', async () => {
    const result = await new ConsensusArbiter().deliberate(
      't',
      [
        participant('a', ['AGREEMENT: y']),
        participant('b', ['AGREEMENT: y']),
        participant('c', ['CRITIQUE: n']),
      ],
      DecisionType.Majority,
    );
    expect(result.reached()).toBe(true);
  });

  it('stops early on ping-pong', async () => {
    const result = await new ConsensusArbiter({ maxRounds: 10 }).deliberate('t', [
      participant('architect', ['PROPOSAL: use X']),
      participant('reviewer', ['CRITIQUE: Use   Y instead']),
    ]);
    expect(result.outcome).toBe(ConsensusOutcome.Stalled);
    expect(result.rounds).toBe(2);
  });

  it('needs at least one participant', async () => {
    await expect(new ConsensusArbiter().deliberate('t', [])).rejects.toThrow(
      'A consensus needs at least one participant.',
    );
  });
});

describe('AgentMessage', () => {
  it('never treats an untagged reply as approval', () => {
    expect(AgentMessage.fromReply('r', 'Looks good to me', 1).type).toBe(MessageType.Proposal);
  });

  it('parses tag variants', () => {
    expect(AgentMessage.fromReply('r', '**AGREEMENT** - ship it', 1).type).toBe(MessageType.Agreement);
    expect(AgentMessage.fromReply('r', '[critique] no', 1).type).toBe(MessageType.Critique);
    expect(AgentMessage.fromReply('r', 'AGREEMENT: ship it', 1).content).toBe('ship it');
    expect(AgentMessage.fromReply('r', 'AGREEMENTS are hard', 1).type).toBe(MessageType.Proposal);
  });
});

describe('PingPongDetector', () => {
  it('needs enough history', () => {
    const m = AgentMessage.fromReply('a', 'CRITIQUE: x', 1);
    expect(new PingPongDetector().isStalled([m, m], 2)).toBe(false);
    expect(new PingPongDetector().isStalled([m, m], 1)).toBe(true);
  });
});

describe('Blackboard', () => {
  it('keeps messages, latest-by-sender and facts', () => {
    const board = new Board();
    board.post(new AgentMessage('a', MessageType.Critique, 'x', 1));
    board.post(new AgentMessage('a', MessageType.Agreement, 'y', 2));
    board.setFact('k', 'v');
    expect(board.latestBy('a')?.content).toBe('y');
    expect(board.latestBy('b')).toBeUndefined();
    expect(board.fact('k')).toBe('v');
    expect(board.fact('nope')).toBeUndefined();
    expect(board.transcript()).toBe('[round 1] a (CRITIQUE):\nx\n\n[round 2] a (AGREEMENT):\ny');
  });
});

describe('RunnerParticipant', () => {
  function runner(result: RunResult, seen: RunRequest[]): Runner {
    return {
      name: 'fake',
      run: async (request) => {
        seen.push(request);
        return result;
      },
    };
  }

  it('wraps the topic and parses the reply', async () => {
    const seen: RunRequest[] = [];
    const p = new RunnerParticipant({
      role: 'architect',
      runner: runner(new RunResult({ exitCode: 0, output: 'AGREEMENT: fine' }), seen),
      workdir: '/w',
    });
    const message = await p.respond('Pick a DB', new Board(), 1);
    expect(message.type).toBe(MessageType.Agreement);
    expect(seen[0]?.prompt).toContain('## Topic\nPick a DB');
    expect(seen[0]?.model).toBeUndefined();
  });

  it('turns a failed run into a critique', async () => {
    const p = new RunnerParticipant({
      role: 'r',
      runner: runner(new RunResult({ exitCode: 1, output: '', errorOutput: ' boom ' }), []),
      workdir: '/w',
    });
    const message = await p.respond('t', new Board(), 2);
    expect(message.type).toBe(MessageType.Critique);
    expect(message.content).toBe('The runner failed and could not take part: boom');
  });
});
