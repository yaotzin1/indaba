/**
 * The form a person fills in before `run --tui` starts the child process (specs/workflow-inputs, AC-17, T-23): one
 * question at a time, in plain words, for each input a run still lacks. Pure: a key in, the next state out. The form
 * checks nothing but "an answer was given"; the run checks every value with the same functions as any other way of
 * giving one and asks again for a refused answer (AC-15), so the form cannot disagree with the command line.
 */

/** What the form needs to know about an input; `InputDescription` of `@indaba/core` fits it, so no copy is made. */
export interface FormField {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly list: boolean;
  readonly choices?: readonly string[];
  readonly limits: Readonly<Record<string, number | boolean | string>>;
}

export type FormKey = 'enter' | 'backspace' | 'escape' | 'ctrl-c' | { readonly char: string };

export interface FormState {
  readonly fields: readonly FormField[];
  /** The input being asked. */
  readonly index: number;
  /** The lines already given for a list or a multi-line text. */
  readonly lines: readonly string[];
  /** What is being typed. */
  readonly draft: string;
  /** One sentence for the person, such as "An answer is needed."; cleared by the next key. */
  readonly message: string | undefined;
  readonly answers: Readonly<Record<string, readonly string[]>>;
  readonly outcome: 'asking' | 'done' | 'cancelled';
}

const MAX_SHOWN = 300;
/** A text longer than this is cut when typed: the run refuses an over-long value anyway, and a pasted book is not a value. */
const MAX_DRAFT = 20000;

/** Text from a workflow file shown to the person: no control characters, not too long, and 7-bit when asked. */
export function plainText(text: string, ascii: boolean, limit = MAX_SHOWN): string {
  const cleaned = Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  })
    .join('')
    .trim();
  const cut = cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
  return ascii ? cut.replace(/[^\x20-\x7e]/g, '?') : cut;
}

export function initialForm(fields: readonly FormField[]): FormState {
  return {
    fields,
    index: 0,
    lines: [],
    draft: '',
    message: undefined,
    answers: {},
    outcome: fields.length === 0 ? 'done' : 'asking',
  };
}

/** Whether the current input takes several lines (a list, or a multi-line text) and so ends on an empty line. */
export function takesLines(field: FormField): boolean {
  return field.list || field.limits.multiline === true;
}

/** One plain line that says what an answer looks like, from the declaration's own limits. */
export function answerHint(field: FormField, ascii: boolean): string {
  const { limits } = field;
  let hint: string;
  switch (field.type) {
    case 'choice':
      hint = `one of: ${(field.choices ?? []).map((choice) => plainText(choice, ascii, 60)).join(', ')}`;
      break;
    case 'boolean':
      hint = 'true or false';
      break;
    case 'number': {
      const bounds =
        limits.min !== undefined && limits.max !== undefined
          ? ` from ${limits.min} to ${limits.max}`
          : limits.min !== undefined
            ? ` of at least ${limits.min}`
            : limits.max !== undefined
              ? ` of at most ${limits.max}`
              : '';
      hint = `${limits.integer === true ? 'a whole number' : 'a number'}${bounds}`;
      break;
    }
    case 'path':
      hint =
        limits.kind === 'directory'
          ? 'a folder inside the project'
          : limits.kind === 'file'
            ? `a file inside the project${typeof limits.extensions === 'string' ? ` (${plainText(limits.extensions, ascii, 60)})` : ''}`
            : 'a file or folder inside the project';
      break;
    default:
      hint = `text, up to ${limits.maxLength ?? ''} characters`;
  }
  return takesLines(field) ? `${hint}; one per line, an empty line to finish` : hint;
}

function finishField(state: FormState, given: readonly string[]): FormState {
  const field = state.fields[state.index];
  if (field === undefined) {
    return state;
  }
  const value = field.list || field.limits.multiline !== true ? given : [given.join('\n')];
  const index = state.index + 1;
  return {
    ...state,
    index,
    lines: [],
    draft: '',
    message: undefined,
    answers: { ...state.answers, [field.name]: value },
    outcome: index >= state.fields.length ? 'done' : 'asking',
  };
}

/** What a pasted or typed chunk adds to the draft: printable characters only, never a control sequence. */
function typed(input: string): string {
  return Array.from(input)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
    })
    .join('');
}

export function reduceForm(state: FormState, key: FormKey): FormState {
  if (state.outcome !== 'asking') {
    return state;
  }
  if (key === 'escape' || key === 'ctrl-c') {
    return { ...state, outcome: 'cancelled', message: undefined };
  }
  const field = state.fields[state.index];
  if (field === undefined) {
    return state;
  }
  if (key === 'backspace') {
    return { ...state, draft: Array.from(state.draft).slice(0, -1).join(''), message: undefined };
  }
  if (key !== 'enter') {
    const added = typed(key.char);
    return added === ''
      ? state
      : { ...state, draft: `${state.draft}${added}`.slice(0, MAX_DRAFT), message: undefined };
  }
  const answer = state.draft;
  if (!takesLines(field)) {
    return answer.trim() === ''
      ? { ...state, message: 'An answer is needed here.' }
      : finishField(state, [answer]);
  }
  if (answer.trim() !== '') {
    return { ...state, lines: [...state.lines, answer], draft: '', message: undefined };
  }
  // An empty line ends a list or a multi-line text; an input with nothing in it has no value, which is not an answer
  return state.lines.length === 0
    ? { ...state, message: 'Give at least one line, then an empty line to finish.' }
    : finishField(state, state.lines);
}

/** The answers, in the shape the run's own question hook gives back; `undefined` when the person cancelled. */
export function formResult(
  state: FormState,
): { readonly values: Record<string, readonly string[]> } | undefined {
  return state.outcome === 'done' ? { values: { ...state.answers } } : undefined;
}

/** The lines of the screen, from the state: plain text, one row each, no styling (the app colours by `tone`). */
export interface FormLine {
  readonly text: string;
  readonly tone: 'normal' | 'dim' | 'accent' | 'bad';
}

export function formLines(state: FormState, ascii: boolean): readonly FormLine[] {
  const field = state.fields[state.index];
  if (field === undefined) {
    return [];
  }
  const out: FormLine[] = [
    {
      text: `Question ${state.index + 1} of ${state.fields.length}`,
      tone: 'dim',
    },
    {
      text: `${plainText(field.name, ascii, 64)}: ${plainText(field.description, ascii)}`,
      tone: 'accent',
    },
    { text: `  ${answerHint(field, ascii)}`, tone: 'dim' },
  ];
  for (const line of state.lines) {
    out.push({ text: `  ${plainText(line, ascii, 200)}`, tone: 'normal' });
  }
  out.push({ text: `> ${plainText(state.draft, ascii, 200)}_`, tone: 'normal' });
  if (state.message !== undefined) {
    out.push({ text: state.message, tone: 'bad' });
  }
  out.push({
    text: `Enter ${takesLines(field) ? 'adds a line (empty line to finish)' : 'answers'}   Backspace erases   Esc cancels the run`,
    tone: 'dim',
  });
  return out;
}
