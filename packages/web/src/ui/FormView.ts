import type {
  EditorResponse,
  JsonObject,
  JsonValue,
  WorkflowEdit,
  WorkflowPath,
  WorkflowProblem,
} from '@indaba/core';
import {
  type ChangeEvent,
  type FocusEvent,
  createElement as h,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type Choice,
  checkLevel,
  contextOf,
  entryEdit,
  entryText,
  type Field,
  fieldPaths,
  headerFields,
  integerOf,
  isOldStyle,
  levelOfPreset,
  linesOf,
  type Member,
  nextStepId,
  type PlacedProblems,
  type Preset,
  pathText,
  placeProblems,
  presetEdits,
  presetOf,
  type RunnerLevels,
  roleMembers,
  stepMembers,
  writeGlobs,
} from '../form-model.js';
import { messages } from '../messages.js';

const words = messages.form;

export interface FormViewProps {
  readonly value: JsonObject;
  readonly info: EditorResponse;
  readonly problems: readonly WorkflowProblem[];
  /** The sentence of the last refused edit, shown at the top (spec section 5). */
  readonly refusal: string | undefined;
  /** Rises with every answer of an edit, so a field shows the draft's value again after a refusal. */
  readonly revision: number;
  readonly onEdit: (edits: readonly WorkflowEdit[]) => void;
  /** Opens the source view at the line of this field. */
  readonly onShowSource: (path: WorkflowPath) => void;
  readonly confirm: (message: string) => boolean;
}

/** An element id for a path: every character but letters and digits written as its code, so two paths never meet. */
export function idOf(prefix: string, path: WorkflowPath): string {
  return `${prefix}${path
    .map((part) => `-${String(part).replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`)
    .join('')}`;
}

const labelOf = (key: string): string => words.labels[key] ?? key;

export interface FieldContext {
  readonly placed: PlacedProblems;
  readonly revision: number;
  readonly onEdit: (edits: readonly WorkflowEdit[]) => void;
  readonly onShowSource: (path: WorkflowPath) => void;
}

/** The parts every field shares: its label, its sentence, its problems, the error of the person's entry. */
function FieldShell(props: {
  readonly field: Field;
  readonly context: FieldContext;
  readonly control: (describedBy: string | undefined, invalid: boolean) => ReactNode;
  readonly entryError?: string | undefined;
  /** A field whose control is a group of its own labels itself with a legend. */
  readonly labelFor?: boolean;
}): ReactElement {
  const { field, context } = props;
  const id = idOf('f', field.path);
  const problems = context.placed.byField.get(pathText(field.path)) ?? [];
  const helpId = field.description === '' ? undefined : `${id}-help`;
  const problemId = problems.length === 0 && props.entryError === undefined ? undefined : `${id}-problem`;
  const describedBy = [problemId, helpId].filter((x) => x !== undefined).join(' ') || undefined;
  const invalid = problemId !== undefined;
  return h(
    'div',
    { className: invalid ? 'field has-problem' : 'field' },
    props.labelFor === false
      ? h(
          'span',
          { className: 'field-label', id: `${id}-label` },
          labelOf(field.key),
          ' ',
          h('code', { className: 'key' }, field.key),
        )
      : h('label', { htmlFor: id }, labelOf(field.key), ' ', h('code', { className: 'key' }, field.key)),
    h('div', { className: 'field-control' }, props.control(describedBy, invalid)),
    problemId === undefined
      ? null
      : h(
          'p',
          { id: problemId, className: 'field-problem' },
          [props.entryError, ...problems.map((p) => p.message)].filter((x) => x !== undefined).join(' '),
        ),
    helpId === undefined ? null : h('p', { id: helpId, className: 'field-help muted' }, field.description),
  );
}

/** Keeps an uncontrolled control showing the draft's value, except while the person is typing in it. */
function useShown<T extends HTMLInputElement | HTMLTextAreaElement>(
  shown: string,
  revision: number,
): { readonly ref: { current: T | null } } {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const element = ref.current;
    // `revision` is a dependency so a refused edit puts the draft's value back.
    void revision;
    if (element !== null && element.ownerDocument.activeElement !== element) {
      element.value = shown;
    }
  }, [shown, revision]);
  return { ref };
}

/** A text, number or list field: it sends its edit when it loses focus or on Enter (single line), never per key. */
function EntryField(props: { readonly field: Field; readonly context: FieldContext }): ReactElement {
  const { field, context } = props;
  const kind = field.kind.kind;
  const multiline = (field.kind.kind === 'text' && field.kind.multiline) || kind === 'list';
  const [entryError, setEntryError] = useState<string | undefined>(undefined);
  const shown = entryText(field.value);
  const { ref } = useShown<HTMLInputElement & HTMLTextAreaElement>(shown, context.revision);

  const commit = (raw: string): void => {
    let entry: JsonValue | undefined;
    if (kind === 'integer') {
      if (raw.trim() === '') {
        entry = undefined;
      } else {
        entry = integerOf(raw);
        if (entry === undefined) {
          setEntryError(words.notInteger);
          return;
        }
      }
    } else if (kind === 'list') {
      entry = [...linesOf(raw)];
    } else {
      entry = multiline ? raw : raw.trim();
    }
    const result = entryEdit(field, entry);
    if (result.kind === 'required') {
      setEntryError(words.required);
      return;
    }
    setEntryError(undefined);
    if (result.kind === 'edit') {
      context.onEdit([result.edit]);
    }
  };

  return h(FieldShell, {
    field,
    context,
    entryError,
    control: (describedBy, invalid) =>
      h(multiline ? 'textarea' : 'input', {
        id: idOf('f', field.path),
        ref,
        defaultValue: shown,
        ...(multiline ? { rows: Math.min(Math.max(shown.split('\n').length + 1, 3), 12) } : { type: 'text' }),
        ...(kind === 'integer' ? { inputMode: 'numeric' } : {}),
        spellCheck: field.key === 'goal',
        autoComplete: 'off',
        required: field.required,
        'aria-invalid': invalid || undefined,
        'aria-describedby': describedBy,
        onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          commit(event.currentTarget.value),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !multiline) {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        },
      }),
  });
}

function choiceLabel(choice: Choice, field: Field): string {
  if (!choice.missing) {
    return choice.value;
  }
  return field.key === 'target' ? words.notAStep(choice.value) : words.notAvailable(choice.value);
}

/** One of a list of values: it sends its edit at once. */
function ChoiceField(props: {
  readonly field: Field;
  readonly choices: readonly Choice[];
  readonly context: FieldContext;
}): ReactElement {
  const { field, choices, context } = props;
  const current = typeof field.value === 'string' ? field.value : '';
  const chosen = choices.find((c) => c.value === current);
  return h(FieldShell, {
    field,
    context,
    control: (describedBy, invalid) => [
      h(
        'select',
        {
          key: 'select',
          id: idOf('f', field.path),
          value: current,
          'aria-invalid': invalid || undefined,
          'aria-describedby': describedBy,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => {
            const result = entryEdit(field, event.currentTarget.value);
            if (result.kind === 'edit') {
              context.onEdit([result.edit]);
            }
          },
        },
        field.required && current !== '' ? null : h('option', { value: '' }, words.notSet),
        ...choices.map((choice) =>
          h('option', { key: choice.value, value: choice.value }, choiceLabel(choice, field)),
        ),
      ),
      chosen === undefined || chosen.description === ''
        ? null
        : h('span', { key: 'about', className: 'muted small' }, chosen.description),
    ],
  });
}

/** Several of a list of values, such as the steps a step waits for: each box sends the new list at once. */
function MultiField(props: {
  readonly field: Field;
  readonly choices: readonly Choice[];
  readonly context: FieldContext;
}): ReactElement {
  const { field, choices, context } = props;
  const held = Array.isArray(field.value)
    ? field.value.filter((v): v is string => typeof v === 'string')
    : [];
  const id = idOf('f', field.path);
  return h(FieldShell, {
    field,
    context,
    labelFor: false,
    control: (describedBy) =>
      choices.length === 0
        ? h('span', { className: 'muted small' }, words.notSet)
        : h(
            'div',
            {
              role: 'group',
              'aria-labelledby': `${id}-label`,
              'aria-describedby': describedBy,
              className: 'choices',
            },
            ...choices.map((choice, i) =>
              h(
                'label',
                { key: choice.value, className: 'choice' },
                h('input', {
                  type: 'checkbox',
                  id: i === 0 ? id : undefined,
                  checked: held.includes(choice.value),
                  onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    const on = event.currentTarget.checked;
                    const next = on ? [...held, choice.value] : held.filter((v) => v !== choice.value);
                    const result = entryEdit(field, next);
                    if (result.kind === 'edit') {
                      context.onEdit([result.edit]);
                    }
                  },
                }),
                ` ${choiceLabel(choice, field)}`,
              ),
            ),
          ),
  });
}

function BooleanField(props: { readonly field: Field; readonly context: FieldContext }): ReactElement {
  const { field, context } = props;
  return h(FieldShell, {
    field,
    context,
    control: (describedBy, invalid) =>
      h('input', {
        type: 'checkbox',
        id: idOf('f', field.path),
        checked: field.value === true,
        'aria-invalid': invalid || undefined,
        'aria-describedby': describedBy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const result = entryEdit(field, event.currentTarget.checked);
          if (result.kind === 'edit') {
            context.onEdit([result.edit]);
          }
        },
      }),
  });
}

/** A field the form does not edit: what it holds, and a way to it in the source view (AC-07). */
function SourceField(props: {
  readonly field: Field;
  readonly why: Exclude<keyof typeof words.inSource, 'absent'>;
  readonly context: FieldContext;
}): ReactElement {
  const { field, why, context } = props;
  return h(FieldShell, {
    field,
    context,
    labelFor: false,
    control: () => [
      h(
        'span',
        { key: 'why', className: 'muted small' },
        field.value === undefined ? words.inSource.absent : words.inSource[why],
      ),
      h(
        'button',
        { key: 'go', type: 'button', className: 'link', onClick: () => context.onShowSource(field.path) },
        words.showInSource(field.key),
      ),
    ],
  });
}

/** The first glob of "edit only these folders", for the person to change; not a recommendation. */
export const FOLDER_PLACEHOLDER = 'src/**';

const PRESETS: readonly Exclude<Preset, 'custom'>[] = ['none', 'read_only', 'folders', 'full'];

/** What a step's agent may change, as the presets of the parent's C-16 (AC-09). */
function PermissionsField(props: {
  readonly field: Field;
  readonly runners: readonly RunnerLevels[];
  readonly context: FieldContext;
}): ReactElement {
  const { field, runners, context } = props;
  const preset = presetOf(field.value);
  const oldStyle = isOldStyle(field.value);
  const id = idOf('f', field.path);
  const globs = writeGlobs(field.value);
  const shownGlobs = globs.join('\n');
  const { ref } = useShown<HTMLTextAreaElement>(shownGlobs, context.revision);
  const problems = context.placed.byField.get(pathText(field.path)) ?? [];
  const choose = (next: Exclude<Preset, 'custom'>): void => {
    // A step that edits folders keeps its globs; another one starts from a placeholder the person changes (spec C-10).
    // One edit per path: the level is set and the keys the new shape forbids are removed (AC-16).
    context.onEdit(
      presetEdits(next, field.value, field.path, preset === 'folders' ? globs : [FOLDER_PLACEHOLDER]),
    );
  };
  // What each runner of the step can hold, from the catalog (AC-16, AC-17).
  const checks = (option: Preset) =>
    option === 'none' || option === 'custom' ? undefined : checkLevel(runners, levelOfPreset(option));
  const reasonOf = (note: string): string => words.permissions.reasons[note] ?? words.permissions.reasonOther;
  const current = checks(preset);
  const options = preset === 'custom' ? [...PRESETS, 'custom' as const] : PRESETS;
  return h(
    'fieldset',
    { className: problems.length === 0 ? 'permissions' : 'permissions has-problem' },
    h('legend', null, words.permissions.legend, ' ', h('code', { className: 'key' }, field.key)),
    h('p', { className: 'field-help muted' }, words.permissions.rule),
    problems.length === 0
      ? null
      : h('p', { className: 'field-problem' }, problems.map((p) => p.message).join(' ')),
    ...options.map((option) =>
      h(
        'div',
        { key: option, className: 'preset' },
        h(
          'label',
          null,
          h('input', {
            type: 'radio',
            name: id,
            value: option,
            checked: preset === option,
            disabled: option === 'custom' || (preset !== option && checks(option)?.kind === 'refused'),
            'aria-describedby': `${id}-${option}-help`,
            onChange: () => {
              if (option !== 'custom') {
                choose(option);
              }
            },
          }),
          ` ${words.permissions[option]}`,
        ),
        h(
          'p',
          { id: `${id}-${option}-help`, className: 'field-help muted' },
          words.permissions[`${option}Help`],
        ),
        (() => {
          const check = checks(option);
          return check?.kind === 'refused'
            ? h(
                'p',
                { className: 'field-problem' },
                words.permissions.refused(check.runner, reasonOf(check.note)),
              )
            : null;
        })(),
        preset === option && oldStyle
          ? h(
              'p',
              { className: 'field-help muted' },
              option === 'full' ? words.permissions.oldStyleFull : words.permissions.oldStyle,
            )
          : null,
      ),
    ),
    current?.kind === 'ok' && !oldStyle
      ? h(
          'ul',
          { className: 'field-help muted' },
          ...current.runners.flatMap((r) => [
            r.checkedAfter
              ? h('li', { key: `${r.runner}-after` }, words.permissions.checkedAfter(r.runner))
              : null,
            r.commandsNotLimited
              ? h('li', { key: `${r.runner}-commands` }, words.permissions.commandsNotLimited(r.runner))
              : null,
          ]),
        )
      : null,
    preset === 'folders'
      ? h(
          'div',
          { className: 'field' },
          h('label', { htmlFor: `${id}-globs` }, words.permissions.globs),
          h(
            'div',
            { className: 'field-control' },
            h('textarea', {
              id: `${id}-globs`,
              ref,
              defaultValue: shownGlobs,
              rows: Math.min(Math.max(globs.length + 1, 2), 8),
              spellCheck: false,
              'aria-describedby': `${id}-globs-help`,
              onBlur: (event: FocusEvent<HTMLTextAreaElement>) => {
                const next = linesOf(event.currentTarget.value);
                if (next.length > 0 && JSON.stringify(next) !== JSON.stringify(globs)) {
                  context.onEdit([{ op: 'set', path: [...field.path, 'fs', 'write'], value: [...next] }]);
                }
              },
            }),
          ),
          h('p', { id: `${id}-globs-help`, className: 'field-help muted' }, words.permissions.globsHelp),
        )
      : null,
    preset === 'custom' ? h(SourceButton, { field, context }) : null,
  );
}

function SourceButton(props: { readonly field: Field; readonly context: FieldContext }): ReactElement {
  return h(
    'button',
    { type: 'button', className: 'link', onClick: () => props.context.onShowSource(props.field.path) },
    words.showInSource(props.field.key),
  );
}

/** A mapping with fields of its own, such as `on_failure`. */
function GroupField(props: {
  readonly field: Field;
  readonly fields: readonly Field[];
  readonly context: FieldContext;
}): ReactElement {
  const { field, fields, context } = props;
  const problems = context.placed.byField.get(pathText(field.path)) ?? [];
  return h(
    'fieldset',
    { className: 'group' },
    h('legend', null, labelOf(field.key), ' ', h('code', { className: 'key' }, field.key)),
    field.description === '' ? null : h('p', { className: 'field-help muted' }, field.description),
    problems.length === 0
      ? null
      : h('p', { className: 'field-problem' }, problems.map((p) => p.message).join(' ')),
    ...fields.map((f) => h(FieldView, { key: f.key, field: f, context })),
  );
}

function FieldView(props: { readonly field: Field; readonly context: FieldContext }): ReactElement {
  const { field, context } = props;
  const kind = field.kind;
  switch (kind.kind) {
    case 'text':
    case 'integer':
    case 'list':
      return h(EntryField, { field, context });
    case 'boolean':
      return h(BooleanField, { field, context });
    case 'choice':
      return h(ChoiceField, { field, choices: kind.choices, context });
    case 'multi':
      return h(MultiField, { field, choices: kind.choices, context });
    case 'group':
      return h(GroupField, { field, fields: kind.fields, context });
    case 'permissions':
      return h(PermissionsField, { field, runners: kind.runners, context });
    case 'fixed':
      return h(FieldShell, {
        field,
        context,
        labelFor: false,
        control: () => h('span', null, words.fixed(entryText(field.value))),
      });
    case 'source':
      return h(SourceField, { field, why: kind.why, context });
  }
}

export function ProblemList(props: {
  readonly title: string;
  readonly problems: readonly WorkflowProblem[];
}): ReactElement | null {
  if (props.problems.length === 0) {
    return null;
  }
  return h(
    'div',
    { className: 'form-problems' },
    h('p', { className: 'field-problem' }, props.title),
    h(
      'ul',
      { className: 'form-problem-list' },
      ...props.problems.map((p, i) => h('li', { key: i }, p.message)),
    ),
  );
}

export function MemberFields(props: {
  readonly member: Member;
  readonly context: FieldContext;
}): ReactElement {
  const { member, context } = props;
  if (!member.mapping) {
    return h('p', { className: 'muted' }, words.notMapping);
  }
  return h('div', null, ...member.fields.map((f) => h(FieldView, { key: f.key, field: f, context })));
}

/**
 * The form of a workflow (specs/web-app-editing-forms): its own fields, its roles and its steps, every field read from
 * the schema and every change sent as one edit of its path, so the rest of the file stays as it was written.
 */
export function FormView(props: FormViewProps): ReactElement {
  const { value, info, problems, onEdit, onShowSource, confirm } = props;
  const schema = info.schema;
  const context = contextOf(value, info.catalog);
  const header = headerFields(schema, value);
  const roles = roleMembers(schema, value, context);
  const steps = stepMembers(schema, value, context);
  const paths = [
    ...fieldPaths(header),
    ...roles.flatMap((r) => fieldPaths(r.fields)),
    ...steps.flatMap((s) => fieldPaths(s.fields)),
  ];
  const placed = placeProblems(problems, paths);
  const fieldContext: FieldContext = { placed, revision: props.revision, onEdit, onShowSource };

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const byId = selectedId === undefined ? -1 : steps.findIndex((s) => s.name === selectedId);
  const index = byId >= 0 ? byId : Math.min(selectedIndex, Math.max(steps.length - 1, 0));
  const selected = steps[index];
  const select = (i: number): void => {
    setSelectedIndex(i);
    setSelectedId(steps[i]?.name || undefined);
  };

  const counts = new Map<string, number>();
  for (const s of steps) {
    counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  }
  const addressable = (member: Member | undefined): member is Member =>
    member !== undefined && member.name !== '' && counts.get(member.name) === 1;
  const hasProblems = (i: number): boolean =>
    problems.some(
      (p) =>
        p.path !== undefined &&
        (p.path === `$.steps[${i}]` ||
          p.path.startsWith(`$.steps[${i}].`) ||
          p.path.startsWith(`$.steps[${i}][`)),
    );

  const addStep = (): void => {
    const id = nextStepId(context.stepIds);
    onEdit([
      {
        op: 'addStep',
        step: { id, runner: 'shell' },
        ...(addressable(selected) ? { after: selected.name } : {}),
      },
    ]);
    setSelectedId(id);
  };
  const move = (by: -1 | 1): void => {
    if (!addressable(selected)) {
      return;
    }
    if (by === -1) {
      const before = steps[index - 2];
      onEdit([
        { op: 'moveStep', id: selected.name, ...(before === undefined ? {} : { after: before.name }) },
      ]);
    } else {
      const next = steps[index + 1];
      if (next !== undefined) {
        onEdit([{ op: 'moveStep', id: selected.name, after: next.name }]);
      }
    }
  };
  const remove = (): void => {
    if (addressable(selected) && confirm(words.confirmRemove(selected.name))) {
      onEdit([{ op: 'removeStep', id: selected.name }]);
      setSelectedId(steps[index + 1]?.name ?? steps[index - 1]?.name);
    }
  };

  return h(
    'div',
    { className: 'form' },
    props.refusal === undefined
      ? null
      : h('p', { className: 'save-status fail', role: 'alert' }, words.refused(props.refusal)),
    h(ProblemList, { title: words.problemsTop, problems: placed.top }),
    h(
      'section',
      { className: 'panel form-section', 'aria-labelledby': 'form-workflow' },
      h('h3', { id: 'form-workflow' }, words.workflowTitle),
      ...header.map((f) => h(FieldView, { key: f.key, field: f, context: fieldContext })),
    ),
    h(
      'section',
      { className: 'panel form-section', 'aria-labelledby': 'form-roles' },
      h('h3', { id: 'form-roles' }, words.rolesTitle),
      roles.length === 0 ? h('p', { className: 'muted' }, words.noRoles) : null,
      ...roles.map((role) =>
        h(
          'fieldset',
          { key: role.name, className: 'group' },
          h('legend', null, role.name),
          h(MemberFields, { member: role, context: fieldContext }),
        ),
      ),
    ),
    h(
      'section',
      { className: 'panel form-section', 'aria-labelledby': 'form-steps' },
      h('h3', { id: 'form-steps' }, words.stepsTitle),
      steps.length === 0
        ? h('p', { className: 'muted' }, words.noSteps)
        : h(
            'nav',
            { 'aria-label': words.stepListLabel },
            h(
              'ol',
              { className: 'step-list' },
              ...steps.map((step, i) =>
                h(
                  'li',
                  { key: i },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: i === index ? 'step-pick selected' : 'step-pick',
                      'aria-current': i === index ? 'step' : undefined,
                      onClick: () => select(i),
                    },
                    step.name === '' ? words.stepLabel('') : step.name,
                    hasProblems(i)
                      ? h('span', { className: 'step-flag' }, ` (${words.stepHasProblems})`)
                      : null,
                  ),
                ),
              ),
            ),
          ),
      h(
        'div',
        { className: 'step-actions' },
        h('button', { type: 'button', onClick: addStep, 'aria-describedby': 'add-step-help' }, words.addStep),
        h('span', { id: 'add-step-help', className: 'muted small' }, words.addStepHelp),
      ),
      selected === undefined
        ? null
        : h(
            'fieldset',
            { className: 'group step', key: `step-${index}` },
            h('legend', null, words.stepLabel(selected.name)),
            addressable(selected)
              ? h(
                  'div',
                  { className: 'step-actions' },
                  h(
                    'button',
                    { type: 'button', disabled: index === 0, onClick: () => move(-1) },
                    words.moveUp,
                  ),
                  h(
                    'button',
                    { type: 'button', disabled: index === steps.length - 1, onClick: () => move(1) },
                    words.moveDown,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'danger',
                      onClick: remove,
                      'aria-label': words.removeStepLabel(selected.name),
                    },
                    words.removeStep,
                  ),
                )
              : h('p', { className: 'muted small' }, words.noIdActions),
            h(ProblemList, { title: words.problemsHere, problems: placed.byStep.get(index) ?? [] }),
            h(MemberFields, { member: selected, context: fieldContext }),
          ),
    ),
  );
}
