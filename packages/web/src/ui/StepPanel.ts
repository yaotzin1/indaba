import type { StepFailureRoute, StepView } from '@indaba/core';
import { createElement as h, type ReactElement, type ReactNode } from 'react';
import { between, formatCallCost, formatDuration, formatTokens } from '../format.js';
import { type GraphNode, retriesUsed } from '../graph-model.js';
import { messages } from '../messages.js';
import { stepLook } from '../status.js';
import { Section, StateChip } from './parts.js';
import { stepTime } from './RunGraph.js';

/** Lines of output shown in the panel; the rest stays in the server's log. */
export const OUTPUT_LINES_SHOWN = 200;

/** What happens if the step fails, in plain words, from the route the run recorded. */
export function failureSentence(
  route: StepFailureRoute | undefined,
  step: StepView | undefined,
  structureKnown: boolean,
): string {
  if (!structureKnown) {
    return messages.step.failUnknown;
  }
  if (route === undefined || route.action === 'fail') {
    return messages.step.failFails;
  }
  if (route.action === 'escalate') {
    return messages.step.failEscalates;
  }
  if (route.action === 'retry_step' && route.target !== undefined) {
    return messages.step.failRetry(route.target, route.maxRetries, retriesUsed(step, route));
  }
  return messages.step.failOther(route.action);
}

function CommandsTable(props: { readonly step: StepView }): ReactElement {
  return h(
    'div',
    { className: 'table-scroll' },
    h(
      'table',
      { className: 'plain' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, messages.step.command),
          h('th', { scope: 'col', className: 'narrow-hide' }, messages.step.runner),
          h('th', { scope: 'col', className: 'num' }, messages.step.exitCode),
          h('th', { scope: 'col', className: 'num' }, messages.run.time),
        ),
      ),
      h(
        'tbody',
        null,
        ...props.step.runners.map((runner, index) => {
          const ms = between(runner.startedAt, runner.endedAt);
          return h(
            'tr',
            { key: runner.spanId },
            h('td', null, String(index + 1)),
            h('td', { className: 'narrow-hide' }, runner.name),
            h('td', { className: 'num' }, runner.exitCode === undefined ? '–' : String(runner.exitCode)),
            h('td', { className: 'num' }, ms === undefined ? '–' : formatDuration(ms)),
          );
        }),
      ),
    ),
  );
}

function RunnersTable(props: { readonly step: StepView }): ReactElement {
  if (props.step.runners.every((runner) => runner.operation === 'execute_tool')) {
    return h(CommandsTable, props);
  }
  return h(
    'div',
    { className: 'table-scroll' },
    h(
      'table',
      { className: 'plain' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, messages.step.runner),
          h('th', { scope: 'col', className: 'narrow-hide' }, messages.step.model),
          h('th', { scope: 'col', className: 'num' }, messages.step.tokens),
          h('th', { scope: 'col', className: 'num' }, messages.step.cost),
        ),
      ),
      h(
        'tbody',
        null,
        ...props.step.runners.map((runner) =>
          h(
            'tr',
            { key: runner.spanId },
            h('td', null, runner.name),
            h(
              'td',
              { className: 'narrow-hide' },
              runner.operation === 'execute_tool' ? '–' : (runner.model ?? messages.step.notReported),
            ),
            h(
              'td',
              { className: 'num' },
              runner.operation === 'execute_tool'
                ? '–'
                : `${formatTokens(runner.inputTokens)} / ${formatTokens(runner.outputTokens)}`,
            ),
            h(
              'td',
              { className: 'num' },
              runner.operation === 'execute_tool' ? '–' : formatCallCost(runner.costUsd),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * The tries of a step, as a list: each try's result and time on one line, and why it failed under it. A reason can be
 * long (a command's last output), so it gets the full width rather than a table column, on a phone as on a desktop.
 */
function TriesList(props: { readonly step: StepView }): ReactElement {
  return h(
    'ol',
    { className: 'tries' },
    ...props.step.history.map((attempt) => {
      const ms = between(attempt.startedAt, attempt.endedAt);
      return h(
        'li',
        { key: attempt.attempt },
        h(
          'p',
          { className: 'try-line' },
          h('b', null, messages.run.tryLabel(attempt.attempt)),
          h(StateChip, { look: stepLook(attempt.outcome) }),
          h('span', { className: 'muted' }, ms === undefined ? '–' : formatDuration(ms)),
        ),
        attempt.reason === undefined ? null : h('p', { className: 'try-reason' }, attempt.reason),
      );
    }),
  );
}

function happened(node: GraphNode): ReactNode[] {
  const step = node.step;
  const parts: ReactNode[] = [];
  if (step === undefined || step.status === 'PENDING') {
    parts.push(
      h(
        'p',
        { key: 'waits' },
        node.dependsOn.length === 0
          ? messages.step.waitsForNothing
          : messages.step.waitsFor(node.dependsOn.join(', ')),
      ),
    );
  }
  if (step !== undefined && step.runners.length > 0) {
    parts.push(h(RunnersTable, { key: 'runners', step }));
  } else if (step !== undefined && step.status !== 'PENDING') {
    parts.push(h('p', { key: 'none', className: 'muted' }, messages.step.noRunnerYet));
  }
  if (step !== undefined) {
    const notes: string[] = [];
    for (const skipped of step.skipped) {
      notes.push(messages.step.skipped(skipped.runner, skipped.reason));
    }
    const tools = Object.entries(step.toolCalls);
    if (tools.length > 0) {
      notes.push(`${messages.step.tools}: ${tools.map(([kind, n]) => `${kind} ${n}`).join(', ')}.`);
    }
    if (step.permissions.allowed + step.permissions.rejected > 0) {
      notes.push(messages.step.permissions(step.permissions.allowed, step.permissions.rejected));
    }
    if (step.consensus !== undefined) {
      notes.push(messages.step.consensus(step.consensus.outcome, step.consensus.rounds));
    }
    for (const note of notes) {
      parts.push(h('p', { key: note, className: 'muted' }, note));
    }
  }
  return parts;
}

function outputOf(step: StepView | undefined): ReactElement {
  if (step === undefined || (step.output.length === 0 && step.partialLine === '')) {
    return h('p', { className: 'muted' }, messages.step.outputNothing);
  }
  const lines = step.output.slice(-OUTPUT_LINES_SHOWN);
  const cut = step.outputTruncated || step.output.length > lines.length;
  const text = [...lines, ...(step.partialLine === '' ? [] : [step.partialLine])].join('\n');
  return h(
    'div',
    null,
    cut ? h('p', { className: 'muted' }, messages.step.outputCut) : null,
    // Text from a run is shown as text: React escapes it, and the server has already dropped escape sequences (AC-16).
    h('pre', { 'aria-live': 'off', tabIndex: 0 }, text),
  );
}

export interface StepPanelProps {
  readonly node: GraphNode;
  readonly structureKnown: boolean;
  readonly retriedBy: readonly string[];
  readonly now: number;
}

/** A selected step: what happened in it, what happens if it fails, its tries and its output. */
export function StepPanel(props: StepPanelProps): ReactElement {
  const { node, structureKnown, retriedBy, now } = props;
  const step = node.step;
  const status = step?.status ?? 'PENDING';
  const look = stepLook(status);
  const time = step === undefined ? undefined : stepTime(step, now);
  const heading =
    status === 'PENDING'
      ? messages.step.willHappen
      : look.tone === 'running'
        ? messages.step.happening
        : messages.step.happened;
  const live = look.tone === 'running';

  return h(
    'article',
    { className: 'panel inspector', 'aria-labelledby': 'step-title' },
    h(
      'h3',
      { id: 'step-title' },
      node.id,
      h(StateChip, { look }),
      time === undefined ? null : h('span', { className: 'muted' }, time),
      step !== undefined && step.attempts > 1
        ? h('span', { className: 'muted' }, messages.run.tryLabel(step.attempts))
        : null,
    ),
    h(Section, { title: heading }, ...happened(node)),
    h(
      Section,
      { title: messages.step.ifFails },
      h('p', null, failureSentence(node.onFailure, step, structureKnown)),
      retriedBy.length > 0
        ? h('p', { className: 'muted' }, messages.step.targetOf(retriedBy.join(', ')))
        : null,
    ),
    step !== undefined && step.history.length > 1
      ? h(Section, { title: messages.step.tries }, h(TriesList, { step }))
      : null,
    h(
      Section,
      { title: live ? `${messages.step.output} (${messages.step.outputLive})` : messages.step.output },
      outputOf(step),
    ),
  );
}
