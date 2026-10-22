import type { RunSummaryOfUse, WorkflowListResponse, WorkflowSummary } from '@indaba/core';
import {
  createElement as h,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure } from '../client.js';
import { messages } from '../messages.js';

/** How often a start is asked about while it has no trace yet. The page's stream retry, not a measurement. */
export const START_POLL_MS = 500;

export interface RunPanelProps {
  readonly client: Client;
  /** Closes the panel; focus goes back to the button that opened it. */
  readonly onClose: () => void;
  /** A run has its trace: open its Run screen. */
  readonly onOpenRun: (runId: string) => void;
  readonly onFatal: (failure: Failure) => void;
  /** Whether the person was already told, this session, that closing indaba ui stops the runs (AC-11). */
  readonly noticeSeen: boolean;
  readonly onNoticeSeen: () => void;
  readonly pollMs?: number;
}

type View =
  | { readonly name: 'list' }
  | {
      readonly name: 'confirm';
      readonly workflow: WorkflowSummary;
      readonly contentHash: string;
      readonly use: RunSummaryOfUse;
    }
  | { readonly name: 'starting'; readonly workflow: WorkflowSummary; readonly startId: string }
  | { readonly name: 'failed'; readonly workflow: WorkflowSummary; readonly reason: string }
  | {
      readonly name: 'refused';
      readonly workflow: WorkflowSummary;
      readonly code: string;
      readonly problems: readonly string[];
    };

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function refusalOf(code: string): { readonly message: string; readonly next: string } {
  return messages.actions.refusals[code] ?? messages.actions.refusals.other ?? { message: '', next: '' };
}

function List(props: {
  readonly title: string;
  readonly items: readonly string[];
  readonly empty?: string;
  readonly code?: boolean;
}): ReactElement | null {
  if (props.items.length === 0 && props.empty === undefined) {
    return null;
  }
  return h(
    'section',
    { className: 'use' },
    h('h4', null, props.title),
    props.items.length === 0
      ? h('p', { className: 'muted' }, props.empty)
      : h(
          'ul',
          null,
          ...props.items.map((item, i) =>
            // Commands are shown as text only, never as markup or a link (parent AC-16).
            h('li', { key: i }, props.code === true ? h('code', null, item) : item),
          ),
        ),
  );
}

function WorkflowItem(props: {
  readonly workflow: WorkflowSummary;
  readonly busy: boolean;
  readonly onRun: (workflow: WorkflowSummary) => void;
}): ReactElement {
  const { workflow, busy, onRun } = props;
  const problemsId = `problems-${workflow.id}`;
  return h(
    'li',
    { className: workflow.valid ? 'workflow' : 'workflow invalid' },
    h(
      'div',
      { className: 'workflow-text' },
      h('b', null, workflow.name),
      h('span', { className: 'muted' }, messages.actions.inProject(workflow.path, workflow.project)),
      workflow.valid
        ? null
        : h(
            'div',
            { id: problemsId, className: 'workflow-problems' },
            h('span', null, messages.actions.invalid),
            h('ul', null, ...workflow.problems.map((problem, i) => h('li', { key: i }, problem))),
          ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: workflow.valid ? 'primary' : undefined,
        disabled: !workflow.valid || busy,
        'aria-label': messages.actions.runLabel(workflow.name),
        'aria-describedby': workflow.valid ? undefined : problemsId,
        onClick: () => onRun(workflow),
      },
      messages.actions.run,
    ),
  );
}

/**
 * The Run a workflow panel (AC-13): a dialog with the workflows found, the confirmation of what a first run will use,
 * and the start until its run has a trace. Nothing starts until the person presses a button that names the workflow,
 * and a second press while a request is out sends nothing (AC-07).
 */
export function RunPanel(props: RunPanelProps): ReactElement {
  const { client, onClose, onOpenRun, onFatal, noticeSeen, onNoticeSeen } = props;
  const pollMs = props.pollMs ?? START_POLL_MS;
  const [listing, setListing] = useState<WorkflowListResponse | undefined>(undefined);
  const [view, setView] = useState<View>({ name: 'list' });
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      if (mounted.current && error instanceof ApiFailure) {
        onFatal(error.failure);
      }
    },
    [onFatal],
  );

  const load = useCallback(() => {
    setListing(undefined);
    client.workflows().then((list) => {
      if (mounted.current) {
        setListing(list ?? { workflows: [], truncated: false });
      }
    }, fail);
  }, [client, fail]);

  useEffect(load, [load]);

  // Focus moves into the dialog when it opens and whenever its view changes, to the view's heading.
  useEffect(() => {
    const heading = dialog.current?.querySelector<HTMLElement>(`[data-autofocus="${view.name}"]`);
    heading?.focus();
  }, [view.name]);

  // A start is asked about until its run has a trace or it has failed (AC-08, AC-15).
  useEffect(() => {
    if (view.name !== 'starting') {
      return;
    }
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (): void => {
      client.startStatus(view.startId).then(
        (status) => {
          if (!current || !mounted.current) {
            return;
          }
          if (status.state === 'running' && status.runId !== undefined) {
            onOpenRun(status.runId);
            return;
          }
          if (status.state === 'failed') {
            setView({ name: 'failed', workflow: view.workflow, reason: status.failure ?? '' });
            return;
          }
          timer = setTimeout(ask, pollMs);
        },
        (error: unknown) => {
          if (current) {
            fail(error);
          }
        },
      );
    };
    ask();
    return () => {
      current = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [view, client, pollMs, onOpenRun, fail]);

  const start = (workflow: WorkflowSummary, confirmedHash?: string): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    client.startRun(workflow.id, confirmedHash).then(
      (answer) => {
        if (!mounted.current) {
          return;
        }
        setBusy(false);
        if (answer.kind === 'confirm') {
          setView({ name: 'confirm', workflow, contentHash: answer.contentHash, use: answer.use });
          return;
        }
        if (answer.kind === 'refused') {
          setView({ name: 'refused', workflow, code: answer.code, problems: answer.problems });
          return;
        }
        onNoticeSeen();
        setView({ name: 'starting', workflow, startId: answer.startId });
      },
      (error: unknown) => {
        if (mounted.current) {
          setBusy(false);
        }
        fail(error);
      },
    );
  };

  const backToList = (): void => {
    setView({ name: 'list' });
    load();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || dialog.current === null) {
      return;
    }
    // Focus stays in the dialog: Tab from the last control goes to the first, Shift+Tab from the first to the last.
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    const active = dialog.current.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  let body: ReactElement;
  if (view.name === 'confirm') {
    const { workflow, use, contentHash } = view;
    body = h(
      'div',
      null,
      h('h3', { tabIndex: -1, 'data-autofocus': 'confirm' }, messages.actions.confirmTitle(workflow.name)),
      h('p', null, messages.actions.confirmLead),
      h(List, { title: messages.actions.runners, items: use.runners }),
      h(List, {
        title: messages.actions.commands,
        items: use.commands,
        empty: messages.actions.noCommands,
        code: true,
      }),
      h(List, { title: messages.actions.permissions, items: use.permissions }),
      use.needsPerson.length === 0
        ? null
        : h(
            'section',
            { className: 'use warn' },
            h('h4', null, messages.actions.needsPerson),
            h(
              'ul',
              null,
              ...use.needsPerson.map((stepId, i) => h('li', { key: i }, h('code', null, stepId))),
            ),
            h('p', null, messages.actions.needsPersonNote),
          ),
      h('p', { className: 'note' }, messages.actions.limit),
      h(
        'div',
        { className: 'dialog-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'primary',
            disabled: busy,
            onClick: () => start(workflow, contentHash),
          },
          messages.actions.confirmRun,
        ),
        h('button', { type: 'button', onClick: backToList, disabled: busy }, messages.actions.back),
      ),
    );
  } else if (view.name === 'starting') {
    body = h(
      'div',
      { role: 'status' },
      h('h3', { tabIndex: -1, 'data-autofocus': 'starting' }, messages.actions.starting(view.workflow.name)),
      h('p', { className: 'muted' }, messages.actions.startingNote),
    );
  } else if (view.name === 'failed') {
    const { workflow, reason } = view;
    body = h(
      'div',
      { role: 'alert' },
      h('h3', { tabIndex: -1, 'data-autofocus': 'failed' }, messages.actions.failedTitle),
      reason === '' ? null : h('p', null, h('code', null, messages.actions.failedReason(reason))),
      h(
        'div',
        { className: 'dialog-actions' },
        h(
          'button',
          { type: 'button', className: 'primary', onClick: () => start(workflow) },
          messages.actions.tryAgain,
        ),
        h('button', { type: 'button', onClick: backToList }, messages.actions.back),
      ),
    );
  } else if (view.name === 'refused') {
    const refusal = refusalOf(view.code);
    body = h(
      'div',
      { role: 'alert' },
      h('h3', { tabIndex: -1, 'data-autofocus': 'refused' }, refusal.message),
      view.problems.length === 0
        ? null
        : h(
            'section',
            { className: 'use' },
            h('h4', null, messages.actions.problemsTitle),
            h('ul', null, ...view.problems.map((problem, i) => h('li', { key: i }, problem))),
          ),
      h('p', null, h('b', null, refusal.next)),
      h(
        'div',
        { className: 'dialog-actions' },
        h('button', { type: 'button', onClick: backToList }, messages.actions.back),
      ),
    );
  } else {
    body = h(
      'div',
      null,
      h('p', { tabIndex: -1, 'data-autofocus': 'list', className: 'muted' }, messages.actions.lead),
      noticeSeen ? null : h('p', { className: 'note' }, messages.actions.notice),
      listing === undefined
        ? h('p', { role: 'status' }, messages.actions.loading)
        : listing.workflows.length === 0
          ? h('p', null, messages.actions.none)
          : h(
              'ul',
              { className: 'workflows', 'aria-label': messages.actions.listLabel },
              ...listing.workflows.map((workflow) =>
                h(WorkflowItem, { key: workflow.id, workflow, busy, onRun: (w) => start(w) }),
              ),
            ),
      listing?.truncated === true ? h('p', { className: 'note' }, messages.actions.truncated) : null,
    );
  }

  return h(
    'div',
    { className: 'dialog-backdrop' },
    h(
      'div',
      {
        ref: dialog,
        className: 'dialog',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'run-panel-title',
        onKeyDown,
      },
      h(
        'div',
        { className: 'dialog-head' },
        h('h2', { id: 'run-panel-title' }, messages.actions.panelTitle),
        h('button', { type: 'button', className: 'link', onClick: onClose }, messages.actions.close),
      ),
      body,
    ),
  );
}
