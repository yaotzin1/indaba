import type {
  RegistryAddRootResponse,
  RegistryCopyResponse,
  RegistryEntryView,
  RegistryListResponse,
  RegistryResolveRootResponse,
} from '@indaba/core';
import {
  type FormEvent,
  createElement as h,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure, type RegistryAnswer } from '../client.js';
import { messages } from '../messages.js';
import {
  annotationOf,
  COPY_NAME,
  copyTargets,
  type DetailsForm,
  detailsProblems,
  formOf,
  refusalWords,
} from '../registry-model.js';
import { Modal } from './Modal.js';

/** The dialogs of the Workflows screen (specs/web-app-registry, AC-04 to AC-07). Each asks, acts once, and says what happened. */

interface DialogProps {
  readonly client: Client;
  readonly onClose: () => void;
  readonly onFatal: (failure: Failure) => void;
  /** The entry the person acted on is gone: the list should be read again. */
  readonly onGone: () => void;
}

/**
 * One action at a time: `run` ignores a second press while one is under way (AC-09), keeps the answer's refusal for the
 * dialog to show, and passes a failure that retrying cannot fix (the token, a stopped server) on.
 */
function useAction(props: Pick<DialogProps, 'onFatal' | 'onGone'>) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { onFatal, onGone } = props;
  const running = useRef(false);
  const run = useCallback(
    <T>(call: () => Promise<RegistryAnswer<T>>, done: (value: T) => void): void => {
      if (running.current) {
        return;
      }
      running.current = true;
      setBusy(true);
      setRefusal(undefined);
      call().then(
        (answer) => {
          running.current = false;
          if (!mounted.current) {
            return;
          }
          setBusy(false);
          if (answer.kind === 'ok') {
            done(answer.value);
            return;
          }
          const code = answer.kind === 'refused' ? answer.code : 'other';
          if (code === 'not_found') {
            onGone();
          }
          setRefusal(code);
        },
        (error: unknown) => {
          running.current = false;
          if (mounted.current) {
            setBusy(false);
          }
          if (error instanceof ApiFailure) {
            onFatal(error.failure);
          }
        },
      );
    },
    [onFatal, onGone],
  );
  return { busy, refusal, run, setRefusal };
}

/** What a refusal says and what to do next, read out as an alert. */
function Refusal(props: { readonly code: string | undefined }): ReactElement | null {
  if (props.code === undefined) {
    return null;
  }
  const words = refusalWords(props.code);
  return h(
    'div',
    { role: 'alert', className: 'field-problem' },
    h('p', null, words.message),
    h('p', null, h('b', null, words.next)),
  );
}

function TextField(props: {
  readonly label: string;
  readonly help?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
  readonly autoFocus?: boolean;
}): ReactElement {
  const id = useId();
  const helpId = `${id}-help`;
  return h(
    'div',
    { className: `field${props.invalid === true ? ' has-problem' : ''}` },
    h('label', { htmlFor: id }, props.label),
    h(
      'div',
      { className: 'field-control' },
      h('input', {
        id,
        type: 'text',
        value: props.value,
        spellCheck: false,
        autoComplete: 'off',
        'aria-invalid': props.invalid === true ? true : undefined,
        ...(props.help === undefined ? {} : { 'aria-describedby': helpId }),
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
      }),
    ),
    props.help === undefined ? null : h('p', { id: helpId, className: 'field-help muted' }, props.help),
  );
}

/** Edit details: the name, the project and the tags; only what changed is sent (AC-04). */
export function EditDialog(
  props: DialogProps & {
    readonly entry: RegistryEntryView;
    readonly onSaved: (entry: RegistryEntryView) => void;
  },
): ReactElement {
  const { entry, client, onSaved } = props;
  const [form, setForm] = useState<DetailsForm>(() => formOf(entry));
  const [nothing, setNothing] = useState(false);
  const action = useAction(props);
  const problems = detailsProblems(form);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const request = annotationOf(entry, form);
    if (problems.length > 0) {
      return;
    }
    if (request === undefined) {
      setNothing(true);
      return;
    }
    setNothing(false);
    action.run(() => client.annotateEntry(entry.id, request), onSaved);
  };
  return h(
    Modal,
    { title: messages.registry.editDialog.title(entry.name), onClose: props.onClose },
    h(
      'form',
      { onSubmit: submit, noValidate: true },
      h('p', { className: 'muted' }, messages.registry.editDialog.lead),
      h(TextField, {
        label: messages.registry.editDialog.name,
        help: messages.registry.editDialog.nameHelp,
        value: form.name,
        invalid: problems.some((p) => p.includes('name')),
        onChange: (name) => setForm({ ...form, name }),
      }),
      h(TextField, {
        label: messages.registry.editDialog.project,
        help: messages.registry.editDialog.projectHelp,
        value: form.project,
        invalid: problems.some((p) => p.includes('project')),
        onChange: (project) => setForm({ ...form, project }),
      }),
      h(TextField, {
        label: messages.registry.editDialog.tags,
        help: messages.registry.editDialog.tagsHelp,
        value: form.tags,
        invalid: problems.some((p) => p.includes('tag')),
        onChange: (tags) => setForm({ ...form, tags }),
      }),
      problems.length === 0
        ? null
        : h(
            'ul',
            { role: 'alert', className: 'field-problem' },
            ...problems.map((problem) => h('li', { key: problem }, problem)),
          ),
      nothing ? h('p', { role: 'status', className: 'muted' }, messages.registry.editDialog.nothing) : null,
      h(Refusal, { code: action.refusal }),
      h(
        'div',
        { className: 'dialog-actions' },
        h(
          'button',
          { type: 'submit', className: 'primary', disabled: action.busy },
          action.busy ? messages.registry.working : messages.registry.editDialog.save,
        ),
        h('button', { type: 'button', onClick: props.onClose }, messages.registry.cancel),
      ),
    ),
  );
}

/** Copy to another project: pick a folder of the list and, if wanted, a name; then see what to review (AC-05). */
export function CopyDialog(
  props: DialogProps & {
    readonly entry: RegistryEntryView;
    readonly list: RegistryListResponse;
    readonly onCopied: (copy: RegistryCopyResponse) => void;
    /** Opens the copy; without it the dialog only closes. */
    readonly onOpen?: (entry: RegistryEntryView) => void;
  },
): ReactElement {
  const { entry, list, client, onCopied } = props;
  const targets = copyTargets(list);
  // Another project first: the folder the original is not in, when there is one.
  const first = targets.find((root) => root.id !== entry.rootId) ?? targets[0];
  const [rootId, setRootId] = useState(first?.id ?? '');
  const [name, setName] = useState('');
  const [done, setDone] = useState<RegistryCopyResponse | undefined>(undefined);
  const action = useAction(props);
  const nameBad = name !== '' && !COPY_NAME.test(name);
  const folderId = useId();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (nameBad || rootId === '') {
      return;
    }
    action.run(
      () => client.copyEntry(entry.id, { rootId, ...(name === '' ? {} : { name }) }),
      (copy) => {
        setDone(copy);
        onCopied(copy);
      },
    );
  };
  if (done !== undefined) {
    return h(
      Modal,
      { title: messages.registry.copyDialog.doneTitle, onClose: props.onClose },
      h('p', { role: 'status' }, messages.registry.copyDialog.doneLead(done.entry.path)),
      done.toReview.length === 0
        ? h('p', { className: 'muted' }, messages.registry.copyDialog.noReview)
        : h(
            'section',
            { className: 'use' },
            h('h4', null, messages.registry.copyDialog.review),
            h('ul', null, ...done.toReview.map((line, i) => h('li', { key: i }, h('code', null, line)))),
          ),
      h(
        'div',
        { className: 'dialog-actions' },
        props.onOpen === undefined
          ? null
          : h(
              'button',
              { type: 'button', className: 'primary', onClick: () => props.onOpen?.(done.entry) },
              messages.registry.copyDialog.open,
            ),
        h('button', { type: 'button', onClick: props.onClose }, messages.registry.close),
      ),
    );
  }
  return h(
    Modal,
    { title: messages.registry.copyDialog.title(entry.name), onClose: props.onClose },
    targets.length === 0
      ? h(
          'div',
          null,
          h('p', { role: 'alert' }, messages.registry.copyDialog.noFolders),
          h(
            'div',
            { className: 'dialog-actions' },
            h('button', { type: 'button', onClick: props.onClose }, messages.registry.close),
          ),
        )
      : h(
          'form',
          { onSubmit: submit, noValidate: true },
          h('p', { className: 'muted' }, messages.registry.copyDialog.lead),
          h(
            'div',
            { className: 'field' },
            h('label', { htmlFor: folderId }, messages.registry.copyDialog.folder),
            h(
              'div',
              { className: 'field-control' },
              h(
                'select',
                {
                  id: folderId,
                  value: rootId,
                  onChange: (e: { target: { value: string } }) => setRootId(e.target.value),
                },
                ...targets.map((root) =>
                  h(
                    'option',
                    { key: root.id, value: root.id },
                    messages.registry.copyDialog.folderOption(root.name, root.folder),
                  ),
                ),
              ),
            ),
          ),
          h(TextField, {
            label: messages.registry.copyDialog.name,
            help: messages.registry.copyDialog.nameHelp,
            value: name,
            invalid: nameBad,
            onChange: setName,
          }),
          nameBad
            ? h('p', { role: 'alert', className: 'field-problem' }, messages.registry.copyDialog.nameBad)
            : null,
          h(Refusal, { code: action.refusal }),
          h(
            'div',
            { className: 'dialog-actions' },
            h(
              'button',
              { type: 'submit', className: 'primary', disabled: action.busy || nameBad },
              action.busy ? messages.registry.working : messages.registry.copyDialog.copy,
            ),
            h('button', { type: 'button', onClick: props.onClose }, messages.registry.cancel),
          ),
        ),
  );
}

/**
 * Import a folder: a typed path, the folder it leads to shown back, and only then Add (AC-06). The folder sent to Add is
 * the one shown, never the text typed.
 */
export function ImportDialog(
  props: DialogProps & { readonly onAdded: (added: RegistryAddRootResponse) => void },
): ReactElement {
  const { client, onAdded } = props;
  const [path, setPath] = useState('');
  const [shown, setShown] = useState<RegistryResolveRootResponse | undefined>(undefined);
  const action = useAction(props);
  const look = (event: FormEvent): void => {
    event.preventDefault();
    if (path.trim() === '') {
      return;
    }
    action.run(() => client.resolveFolder(path.trim()), setShown);
  };
  const choose = (): void => {
    setShown(undefined);
    action.setRefusal(undefined);
  };
  return h(
    Modal,
    { title: messages.registry.importDialog.title, onClose: props.onClose },
    shown === undefined
      ? h(
          'form',
          { onSubmit: look, noValidate: true },
          h('p', { className: 'muted' }, messages.registry.importDialog.lead),
          h(TextField, {
            label: messages.registry.importDialog.path,
            help: messages.registry.importDialog.pathHelp,
            value: path,
            onChange: setPath,
          }),
          h(Refusal, { code: action.refusal }),
          h(
            'div',
            { className: 'dialog-actions' },
            h(
              'button',
              { type: 'submit', className: 'primary', disabled: action.busy || path.trim() === '' },
              action.busy ? messages.registry.importDialog.looking : messages.registry.importDialog.look,
            ),
            h('button', { type: 'button', onClick: props.onClose }, messages.registry.cancel),
          ),
        )
      : h(
          'div',
          null,
          h('p', null, messages.registry.importDialog.leadsTo),
          h('p', null, h('code', { 'data-testid': 'resolved-folder' }, shown.folder)),
          h('p', { role: 'status' }, messages.registry.importDialog.found(shown.found, shown.atLeast)),
          shown.alreadyCovered
            ? h('p', { className: 'note' }, messages.registry.importDialog.covered)
            : h('p', { className: 'note' }, messages.registry.importDialog.grant),
          h(Refusal, { code: action.refusal }),
          h(
            'div',
            { className: 'dialog-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'primary',
                disabled: action.busy,
                onClick: () => action.run(() => client.addFolder(shown.folder), onAdded),
              },
              action.busy ? messages.registry.working : messages.registry.importDialog.add,
            ),
            h('button', { type: 'button', onClick: choose }, messages.registry.importDialog.another),
          ),
        ),
  );
}

/**
 * Remove from the list: names what will happen and asks (AC-07). An entry that a scan would find again is not removed;
 * the dialog says why and offers Hide.
 */
export function RemoveDialog(
  props: DialogProps & {
    readonly entry: RegistryEntryView;
    readonly onRemoved: () => void;
    readonly onHidden: (entry: RegistryEntryView) => void;
  },
): ReactElement {
  const { entry, client } = props;
  const action = useAction(props);
  if (!entry.removable) {
    return h(
      Modal,
      { title: messages.registry.removeDialog.title(entry.name), onClose: props.onClose },
      h('p', null, messages.registry.removeDialog.notRemovable(entry.name)),
      h('p', null, messages.registry.removeDialog.hideInstead),
      h(Refusal, { code: action.refusal }),
      h(
        'div',
        { className: 'dialog-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'primary',
            disabled: action.busy,
            onClick: () => action.run(() => client.annotateEntry(entry.id, { hidden: true }), props.onHidden),
          },
          messages.registry.removeDialog.hideIt,
        ),
        h('button', { type: 'button', onClick: props.onClose }, messages.registry.cancel),
      ),
    );
  }
  return h(
    Modal,
    { title: messages.registry.removeDialog.title(entry.name), onClose: props.onClose },
    h('p', null, messages.registry.removeDialog.body),
    h(Refusal, { code: action.refusal }),
    h(
      'div',
      { className: 'dialog-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          disabled: action.busy,
          onClick: () => action.run(() => client.removeEntry(entry.id), props.onRemoved),
        },
        action.busy ? messages.registry.working : messages.registry.removeDialog.confirm,
      ),
      h('button', { type: 'button', onClick: props.onClose }, messages.registry.cancel),
    ),
  );
}
