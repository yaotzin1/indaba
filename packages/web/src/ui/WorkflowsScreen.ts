import type { RegistryEntryView, RegistryListResponse } from '@indaba/core';
import { coreAddons, Gridwright, type GridwrightColumn, responsive, search } from 'apsw-gridwright/react';
import {
  createElement as h,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure, type RegistryAnswer } from '../client.js';
import { costTip } from '../cost.js';
import { type Clock, formatRunCost, formatWhen } from '../format.js';
import { messages } from '../messages.js';
import { hiddenCount, refusalWords, rowsOf, scanSentence, type WorkflowRow } from '../registry-model.js';
import { StateChip } from './parts.js';
import { hrefOf, isPlainClick, type Navigate } from './router.js';
import { CopyDialog, EditDialog, ImportDialog, RemoveDialog } from './WorkflowDialogs.js';

export interface WorkflowsScreenProps {
  readonly client: Client;
  readonly clock: Clock;
  readonly navigate: Navigate;
  readonly onFatal: (failure: Failure) => void;
  /** Show hidden, from the address (parent C-05). */
  readonly showHidden: boolean;
  /** Whether this server opens workflow files, so a name can lead to the source view. */
  readonly canOpen: boolean;
}

type Dialog = 'edit' | 'copy' | 'remove' | 'import';

function columns(clock: Clock, navigate: Navigate, canOpen: boolean): GridwrightColumn<WorkflowRow>[] {
  const open = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (isPlainClick(event)) {
      event.preventDefault();
      navigate({ name: 'workflow', workflowId: id });
    }
  };
  const c = messages.registry.columns;
  return [
    {
      id: 'name',
      header: c.name,
      accessor: (row) => row.name,
      cell: ({ row }) =>
        h(
          'span',
          null,
          row.opens && canOpen
            ? h(
                'a',
                {
                  className: 'row-link',
                  href: hrefOf({ name: 'workflow', workflowId: row.id }),
                  onClick: open(row.id),
                },
                row.name,
              )
            : row.name,
          row.entry.hidden ? h('span', { className: 'muted' }, ` (${messages.registry.hiddenTag})`) : null,
        ),
    },
    { id: 'project', header: c.project, accessor: (row) => row.project, responsive: { hideBelow: 480 } },
    { id: 'tags', header: c.tags, accessor: (row) => row.tags, responsive: { hideBelow: 640 } },
    {
      id: 'lastResult',
      header: c.lastResult,
      accessor: (row) => row.lastStatus ?? '',
      cell: ({ row }) =>
        row.lastLook === undefined
          ? h('span', { className: 'muted' }, messages.registry.neverRun)
          : h(StateChip, { look: row.lastLook }),
    },
    {
      id: 'lastCost',
      header: c.lastCost,
      align: 'end',
      accessor: (row) => row.lastCost?.usd ?? -1,
      responsive: { hideBelow: 560 },
      cell: ({ row }) =>
        row.lastCost === undefined
          ? h('span', { className: 'muted' }, '–')
          : h('span', { title: costTip(row.lastCost) }, formatRunCost(row.lastCost)),
    },
    {
      id: 'lastRun',
      header: c.lastRun,
      accessor: (row) => row.lastStartedAt ?? '',
      responsive: { hideBelow: 560 },
      cell: ({ row }) =>
        row.lastStartedAt === undefined
          ? h('span', { className: 'muted' }, '–')
          : formatWhen(row.lastStartedAt, clock),
    },
    {
      id: 'state',
      header: c.state,
      accessor: (row) => row.state.word,
      cell: ({ row }) =>
        h(
          'span',
          { title: row.stateWhy === '' ? undefined : row.stateWhy },
          h(StateChip, { look: row.state }),
        ),
    },
  ];
}

const GRID_ADDONS = [search<WorkflowRow>(), responsive<WorkflowRow>({ stackBelow: 560 })];
// One row at a time, chosen with a checkbox that a keyboard reaches; no select-all, since every action is on one workflow.
const GRID_CORE = coreAddons<WorkflowRow>({ selection: { checkboxes: true, selectAll: false } });
const GRID_QUERY = { sort: [{ columnId: 'name', direction: 'asc' as const }] };

/**
 * The Workflows screen (specs/web-app-registry): the registry's list in a grid, and the actions on one selected entry. The
 * server decides everything; this draws what it sent and sends what the person chose.
 */
export function WorkflowsScreen(props: WorkflowsScreenProps): ReactElement {
  const { client, clock, navigate, onFatal, showHidden } = props;
  const [list, setList] = useState<RegistryListResponse | undefined | 'unavailable'>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const working = useRef(false);

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

  const load = useCallback(
    (announce?: string) => {
      client.registry().then((answer) => {
        if (!mounted.current) {
          return;
        }
        setList(answer ?? 'unavailable');
        if (announce !== undefined) {
          setNotice(announce);
        }
      }, fail);
    },
    [client, fail],
  );

  useEffect(() => load(), [load]);

  // Asked for again when the window gains focus, so a file written meanwhile shows; the server scans at most every 30
  // seconds (specs/workflow-registry, AC-14). The old list stays until the new one arrives.
  useEffect(() => {
    const refresh = (): void => load();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);

  const rows = useMemo(() => (typeof list === 'object' ? rowsOf(list, showHidden) : []), [list, showHidden]);
  const gridColumns = useMemo(
    () => columns(clock, navigate, props.canOpen),
    [clock, navigate, props.canOpen],
  );
  const selected = rows.find((row) => row.id === selectedId)?.entry;

  const closeDialog = useCallback(() => setDialog(undefined), []);

  /** An action of the toolbar that is not a dialog: one at a time, its answer announced, its refusal shown. */
  const act = <T>(
    call: () => Promise<RegistryAnswer<T>>,
    done: (value: T) => string,
    reload = true,
  ): void => {
    if (working.current) {
      return;
    }
    working.current = true;
    setBusy(true);
    setProblem(undefined);
    call().then(
      (answer) => {
        working.current = false;
        if (!mounted.current) {
          return;
        }
        setBusy(false);
        if (answer.kind === 'ok') {
          const sentence = done(answer.value);
          if (reload) {
            load(sentence);
          } else {
            setNotice(sentence);
          }
          return;
        }
        setProblem(answer.kind === 'refused' ? answer.code : 'other');
        if (answer.kind === 'refused' && answer.code === 'not_found') {
          load();
        }
      },
      (error: unknown) => {
        working.current = false;
        if (mounted.current) {
          setBusy(false);
        }
        fail(error);
      },
    );
  };

  const toggleHidden = (entry: RegistryEntryView): void =>
    act(
      () => client.annotateEntry(entry.id, { hidden: !entry.hidden }),
      () =>
        entry.hidden
          ? messages.registry.announce.shown(entry.name)
          : messages.registry.announce.hidden(entry.name),
    );

  const goToHidden = (): void => navigate({ name: 'workflows', showHidden: !showHidden }, { replace: true });

  let body: ReactElement;
  if (list === undefined) {
    body = h('p', { role: 'status' }, messages.registry.loading);
  } else if (list === 'unavailable') {
    body = h(
      'section',
      { className: 'panel empty', role: 'alert' },
      h('h3', null, messages.registry.unavailable),
      h('p', null, messages.registry.unavailableNext),
    );
  } else {
    const hidden = hiddenCount(list);
    body = h(
      'div',
      null,
      h('p', { className: 'muted' }, messages.registry.folders(list.roots.map((root) => root.name))),
      list.truncated ? h('p', { className: 'note' }, messages.registry.truncated) : null,
      h(
        'div',
        { className: 'toolbar', role: 'toolbar', 'aria-label': messages.registry.toolbar },
        h(
          'button',
          {
            type: 'button',
            disabled: busy,
            onClick: () =>
              act(
                () => client.scanRegistry(),
                (scanned) => scanSentence(scanned.reports),
              ),
          },
          busy ? messages.registry.scanning : messages.registry.scanAgain,
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-haspopup': 'dialog',
            onClick: () => setDialog('import'),
          },
          messages.registry.import,
        ),
        hidden > 0 || showHidden
          ? h(
              'button',
              { type: 'button', className: 'quiet', 'aria-pressed': showHidden, onClick: goToHidden },
              messages.registry.showHidden(hidden),
            )
          : null,
      ),
      h(
        'div',
        { className: 'toolbar', role: 'toolbar', 'aria-label': messages.registry.selectionToolbar },
        h(
          'span',
          { className: 'muted' },
          selected === undefined ? messages.registry.none : messages.registry.selected(selected.name),
        ),
        ...(selected === undefined
          ? []
          : [
              h(
                'button',
                { key: 'edit', type: 'button', 'aria-haspopup': 'dialog', onClick: () => setDialog('edit') },
                messages.registry.edit,
              ),
              h(
                'button',
                { key: 'hide', type: 'button', disabled: busy, onClick: () => toggleHidden(selected) },
                selected.hidden ? messages.registry.show : messages.registry.hide,
              ),
              h(
                'button',
                { key: 'copy', type: 'button', 'aria-haspopup': 'dialog', onClick: () => setDialog('copy') },
                messages.registry.copy,
              ),
              h(
                'button',
                {
                  key: 'remove',
                  type: 'button',
                  'aria-haspopup': 'dialog',
                  onClick: () => setDialog('remove'),
                },
                messages.registry.remove,
              ),
            ]),
      ),
      h('p', { role: 'status', className: 'muted' }, notice),
      problem === undefined
        ? null
        : h(
            'div',
            { role: 'alert', className: 'field-problem' },
            h('p', null, refusalWords(problem).message),
            h('p', null, h('b', null, refusalWords(problem).next)),
          ),
      rows.length === 0
        ? h(
            'section',
            { className: 'panel empty' },
            h('h3', null, messages.registry.empty),
            h('p', null, messages.registry.emptyBody),
          )
        : h(
            'section',
            { className: 'panel' },
            h(Gridwright<WorkflowRow>, {
              className: 'ix-grid',
              'aria-label': messages.registry.gridLabel,
              columns: gridColumns,
              data: rows,
              getRowId: (row: WorkflowRow) => row.id,
              initialQuery: GRID_QUERY,
              selectionMode: 'single',
              onSelectionChange: (ids: readonly (string | number)[]) => {
                const first = ids[0];
                setSelectedId(first === undefined ? undefined : String(first));
              },
              coreAddons: GRID_CORE,
              addons: GRID_ADDONS,
            }),
          ),
    );
  }

  const common = { client, onClose: closeDialog, onFatal, onGone: () => load() };
  return h(
    'div',
    null,
    h('div', { className: 'title-row' }, h('h2', { id: 'page-title' }, messages.registry.title)),
    h('p', { className: 'muted' }, messages.registry.lead),
    body,
    typeof list === 'object' && dialog === 'edit' && selected !== undefined
      ? h(EditDialog, {
          ...common,
          entry: selected,
          onSaved: (entry) => {
            setDialog(undefined);
            load(messages.registry.announce.saved(entry.name));
          },
        })
      : null,
    typeof list === 'object' && dialog === 'copy' && selected !== undefined
      ? h(CopyDialog, {
          ...common,
          entry: selected,
          list,
          onCopied: (copy) => {
            setSelectedId(copy.entry.id);
            load(messages.registry.announce.copied(copy.entry.path));
          },
          ...(props.canOpen
            ? {
                onOpen: (entry: RegistryEntryView) => {
                  setDialog(undefined);
                  navigate({ name: 'workflow', workflowId: entry.id });
                },
              }
            : {}),
        })
      : null,
    typeof list === 'object' && dialog === 'remove' && selected !== undefined
      ? h(RemoveDialog, {
          ...common,
          entry: selected,
          onRemoved: () => {
            setDialog(undefined);
            setSelectedId(undefined);
            load(messages.registry.announce.removed(selected.name));
          },
          onHidden: (entry) => {
            setDialog(undefined);
            load(messages.registry.announce.hidden(entry.name));
          },
        })
      : null,
    dialog === 'import'
      ? h(ImportDialog, {
          ...common,
          onAdded: (added) => {
            setDialog(undefined);
            load(
              added.alreadyCovered
                ? messages.registry.announce.alreadyCovered(added.root.folder)
                : messages.registry.announce.added(added.root.folder, added.report.found),
            );
          },
        })
      : null,
  );
}
