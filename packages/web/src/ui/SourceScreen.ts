import type { WorkflowProblem, WorkflowSummary } from '@indaba/core';
import {
  createElement as h,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure } from '../client.js';
import { messages } from '../messages.js';
import { RunPanel } from './RunPanel.js';
import { hrefOf, isPlainClick, type Navigate } from './router.js';

/** How long the person pauses before a draft is checked; the Settings screen's value. */
export const CHECK_DELAY_MS = 250;

/** The offset in `text` of a 1-based line and column, clamped to the text; for putting the caret at a problem. */
export function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset);
    if (next < 0) {
      return text.length;
    }
    offset = next + 1;
  }
  const end = text.indexOf('\n', offset);
  const lineEnd = end < 0 ? text.length : end;
  return Math.min(offset + Math.max(column - 1, 0), lineEnd);
}

/** How many lines a text shows in an editor: one more than its newlines. */
export const lineCount = (text: string): number => text.split('\n').length;

/** Whether the text holds unsaved changes, for whoever is about to leave the screen. */
export type LeaveGuard = { current: (() => boolean) | undefined };

export interface SourceScreenProps {
  readonly client: Client;
  readonly workflowId: string;
  readonly navigate: Navigate;
  readonly onFatal: (failure: Failure) => void;
  /** Set to a check of unsaved changes while this screen is open; the page asks before it navigates away. */
  readonly leaveGuard: LeaveGuard;
  /** Asks the person before they lose their changes. */
  readonly confirm: (message: string) => boolean;
  readonly canRun: boolean;
  readonly noticeSeen: boolean;
  readonly onNoticeSeen: () => void;
  readonly checkDelayMs?: number;
  readonly pollMs?: number;
}

interface Loaded {
  readonly workflow: WorkflowSummary;
  /** What is on disk as far as the page knows: the text and the hash a save starts from. */
  readonly savedText: string;
  readonly savedHash: string;
  readonly savedProblems: readonly WorkflowProblem[];
}

type Status = 'idle' | 'checking' | 'saving';

function Problems(props: {
  readonly problems: readonly WorkflowProblem[];
  readonly onGo: (problem: WorkflowProblem) => void;
}): ReactElement {
  const { problems, onGo } = props;
  if (problems.length === 0) {
    return h('p', { className: 'source-ok' }, messages.editor.noProblems);
  }
  return h(
    'section',
    { className: 'source-problems', 'aria-labelledby': 'source-problems-title' },
    h('h3', { id: 'source-problems-title' }, messages.editor.problemsTitle(problems.length)),
    h(
      'ul',
      null,
      ...problems.map((problem, i) =>
        h(
          'li',
          { key: i },
          problem.line === undefined || problem.column === undefined
            ? problem.message
            : h(
                'button',
                {
                  type: 'button',
                  className: 'link',
                  'aria-label': `${messages.editor.goTo(problem.line)}: ${problem.message}`,
                  onClick: () => onGo(problem),
                },
                h('span', { className: 'source-at' }, messages.editor.atLine(problem.line, problem.column)),
                ` ${problem.message}`,
              ),
        ),
      ),
    ),
  );
}

/**
 * The text of one workflow file, to read, change and save (specs/web-app-editing-core): a monospace editor with line
 * numbers, the problems `indaba validate` would report as the person types, Save against the version read, and Run once
 * the saved file is valid.
 */
export function SourceScreen(props: SourceScreenProps): ReactElement {
  const { client, workflowId, navigate, onFatal, leaveGuard, confirm } = props;
  const checkDelayMs = props.checkDelayMs ?? CHECK_DELAY_MS;
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<readonly WorkflowProblem[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [saveRefusal, setSaveRefusal] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<
    { readonly text: string; readonly contentHash: string } | undefined
  >(undefined);
  const [running, setRunning] = useState(false);
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const gutter = useRef<HTMLDivElement | null>(null);
  const escaped = useRef(false);
  const checks = useRef(0);

  const dirty = loaded !== undefined && text !== loaded.savedText;
  // Stable, because the Run panel asks about a start again whenever this changes.
  const openRun = useCallback(
    (runId: string) => navigate({ name: 'run', runId, step: undefined }),
    [navigate],
  );
  const closeRun = useCallback(() => setRunning(false), []);

  useEffect(() => {
    let current = true;
    client.workflowSource(workflowId).then(
      (source) => {
        if (!current) {
          return;
        }
        setLoaded({
          workflow: source.workflow,
          savedText: source.text,
          savedHash: source.contentHash,
          savedProblems: source.problems,
        });
        setText(source.text);
        setProblems(source.problems);
      },
      (error: unknown) => {
        if (!current || !(error instanceof ApiFailure)) {
          return;
        }
        if (error.failure.kind === 'not_found' || error.failure.kind === 'server') {
          setRefusal(error.failure.message);
        } else {
          onFatal(error.failure);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [client, workflowId, onFatal]);

  // The page asks before leaving while there are unsaved changes; the browser asks before the tab closes.
  useEffect(() => {
    leaveGuard.current = () => dirty;
    return () => {
      leaveGuard.current = undefined;
    };
  }, [leaveGuard, dirty]);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // A draft is checked after a pause; only the latest answer is shown, so a slow early one never wins.
  useEffect(() => {
    if (loaded === undefined || text === loaded.savedText) {
      return;
    }
    const timer = setTimeout(() => {
      checks.current += 1;
      const mine = checks.current;
      setStatus((s) => (s === 'saving' ? s : 'checking'));
      client.checkWorkflow(text).then(
        (found) => {
          if (mine !== checks.current) {
            return;
          }
          setProblems(found ?? []);
          setStatus((s) => (s === 'checking' ? 'idle' : s));
        },
        (error: unknown) => {
          setStatus((s) => (s === 'checking' ? 'idle' : s));
          if (error instanceof ApiFailure) {
            onFatal(error.failure);
          }
        },
      );
    }, checkDelayMs);
    return () => clearTimeout(timer);
  }, [client, text, loaded, checkDelayMs, onFatal]);

  const save = useCallback(
    (baseHash: string, toSave: string) => {
      if (loaded === undefined) {
        return;
      }
      setStatus('saving');
      setSaveRefusal(undefined);
      client.saveWorkflowSource(workflowId, toSave, baseHash).then(
        (answer) => {
          setStatus('idle');
          if (answer.kind === 'saved') {
            checks.current += 1;
            setConflict(undefined);
            setLoaded({
              ...loaded,
              savedText: toSave,
              savedHash: answer.contentHash,
              savedProblems: answer.problems,
            });
            setProblems(answer.problems);
          } else if (answer.kind === 'changed') {
            setConflict(answer.current);
          } else {
            setSaveRefusal(messages.editor.refusals[answer.code] ?? messages.editor.refusals.other);
          }
        },
        (error: unknown) => {
          setStatus('idle');
          if (error instanceof ApiFailure) {
            onFatal(error.failure);
          }
        },
      );
    },
    [client, workflowId, loaded, onFatal],
  );

  const leave = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!isPlainClick(event)) {
      return;
    }
    event.preventDefault();
    if (!dirty || confirm(messages.editor.leave)) {
      leaveGuard.current = undefined;
      navigate({ name: 'runs' });
    }
  };

  const goTo = (problem: WorkflowProblem): void => {
    const area = editor.current;
    if (area === null || problem.line === undefined || problem.column === undefined) {
      return;
    }
    const at = offsetOf(text, problem.line, problem.column);
    area.focus();
    area.setSelectionRange(at, at);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      // The next Tab leaves the editor, so the keyboard is never trapped in it.
      escaped.current = true;
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && !escaped.current) {
      event.preventDefault();
      const area = event.currentTarget;
      const start = area.selectionStart;
      const end = area.selectionEnd;
      const next = `${text.slice(0, start)}  ${text.slice(end)}`;
      setText(next);
      // After React has written the new value.
      requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
      return;
    }
    escaped.current = false;
  };

  const backLink = h(
    'p',
    { className: 'back' },
    h('a', { href: hrefOf({ name: 'runs' }), onClick: leave }, `← ${messages.editor.back}`),
  );

  if (refusal !== undefined) {
    return h(
      'div',
      null,
      backLink,
      h('section', { className: 'panel', role: 'alert' }, h('p', null, refusal)),
    );
  }
  if (loaded === undefined) {
    return h('div', null, backLink, h('p', { role: 'status' }, messages.editor.loading));
  }

  const canRunNow = props.canRun && !dirty && loaded.savedProblems.length === 0 && status === 'idle';
  const statusText =
    status === 'saving'
      ? messages.editor.saving
      : status === 'checking'
        ? messages.editor.status.checking
        : dirty
          ? messages.editor.status.unsaved
          : loaded.savedProblems.length === 0
            ? messages.editor.status.saved
            : messages.editor.status.savedWithProblems;
  const lines = lineCount(text);

  return h(
    'div',
    { className: 'source' },
    backLink,
    h('h2', { id: 'page-title' }, messages.editor.title(loaded.workflow.name)),
    h(
      'p',
      { className: 'muted source-file' },
      messages.editor.file(loaded.workflow.path, loaded.workflow.project),
    ),
    conflict === undefined
      ? null
      : h(
          'section',
          { className: 'panel conflict', role: 'alert', 'aria-labelledby': 'conflict-title' },
          h('h3', { id: 'conflict-title' }, messages.editor.conflictTitle),
          h('p', null, messages.editor.conflictBody),
          h('label', { htmlFor: 'disk-version', className: 'source-label' }, messages.editor.diskLabel),
          h('textarea', {
            id: 'disk-version',
            className: 'source-text disk',
            readOnly: true,
            value: conflict.text,
            rows: Math.min(lineCount(conflict.text), 16),
            spellCheck: false,
          }),
          h(
            'div',
            { className: 'dialog-actions' },
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  checks.current += 1;
                  setLoaded({ ...loaded, savedText: conflict.text, savedHash: conflict.contentHash });
                  setText(conflict.text);
                  setConflict(undefined);
                  void client.checkWorkflow(conflict.text).then(
                    (found) => setProblems(found ?? []),
                    () => undefined,
                  );
                },
              },
              messages.editor.useDisk,
            ),
            h(
              'button',
              { type: 'button', className: 'primary', onClick: () => save(conflict.contentHash, text) },
              messages.editor.keepMine,
            ),
          ),
        ),
    h('label', { htmlFor: 'source-text', className: 'source-label' }, messages.editor.textLabel),
    h('p', { id: 'source-keys', className: 'muted small' }, messages.editor.keysHelp),
    h(
      'div',
      { className: 'source-editor' },
      h(
        'div',
        { ref: gutter, className: 'source-gutter', 'aria-hidden': true },
        ...Array.from({ length: lines }, (_, i) => h('span', { key: i }, String(i + 1))),
      ),
      h('textarea', {
        id: 'source-text',
        ref: editor,
        className: 'source-text',
        value: text,
        spellCheck: false,
        autoCapitalize: 'off',
        autoComplete: 'off',
        wrap: 'off',
        rows: Math.max(12, Math.min(lines + 1, 40)),
        'aria-describedby': 'source-keys source-status',
        onChange: (event: { readonly target: { readonly value: string } }) => setText(event.target.value),
        onKeyDown,
        onScroll: () => {
          if (gutter.current !== null && editor.current !== null) {
            gutter.current.scrollTop = editor.current.scrollTop;
          }
        },
      }),
    ),
    h(Problems, { problems, onGo: goTo }),
    h(
      'div',
      { className: 'save-bar' },
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          disabled: !dirty || status === 'saving' || conflict !== undefined,
          onClick: () => save(loaded.savedHash, text),
        },
        status === 'saving' ? messages.editor.saving : messages.editor.save,
      ),
      props.canRun
        ? h(
            'button',
            {
              type: 'button',
              disabled: !canRunNow,
              'aria-describedby': canRunNow ? undefined : 'source-run-help',
              onClick: () => setRunning(true),
            },
            messages.editor.run,
          )
        : null,
      h('p', { id: 'source-status', className: 'save-status info', role: 'status' }, statusText),
      props.canRun && !canRunNow
        ? h('p', { id: 'source-run-help', className: 'muted small' }, messages.editor.runNeedsSave)
        : null,
    ),
    saveRefusal === undefined ? null : h('p', { className: 'save-status fail', role: 'alert' }, saveRefusal),
    running
      ? h(RunPanel, {
          client,
          onClose: closeRun,
          onOpenRun: openRun,
          onFatal,
          noticeSeen: props.noticeSeen,
          onNoticeSeen: props.onNoticeSeen,
          startWith: { ...loaded.workflow, valid: true, problems: [] },
          ...(props.pollMs === undefined ? {} : { pollMs: props.pollMs }),
        })
      : null,
  );
}
