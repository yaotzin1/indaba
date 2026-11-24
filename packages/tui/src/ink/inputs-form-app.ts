import {
  type FormField,
  type FormKey,
  type FormState,
  formLines,
  formResult,
  initialForm,
  reduceForm,
} from '../inputs-form.js';
import {
  Box,
  h,
  type Key,
  type ReactElement,
  Text,
  useApp,
  useEffect,
  useInput,
  useState,
} from './adapter.js';

export interface InputsFormAppProps {
  readonly fields: readonly FormField[];
  readonly ascii: boolean;
  readonly color: boolean;
  readonly onFinish: (result: ReturnType<typeof formResult>) => void;
}

/** The key a press means to the form; a press with no meaning (an arrow, a function key) is `undefined`. */
export function formKey(input: string, key: Key): FormKey | undefined {
  if (key.ctrl && input === 'c') return 'ctrl-c';
  if (key.return) return 'enter';
  if (key.escape) return 'escape';
  if (key.backspace || key.delete) return 'backspace';
  if (key.ctrl || key.meta || input === '') return undefined;
  return { char: input };
}

const TONE = { accent: 'magenta', bad: 'red' } as const;

/** The questions of `run --tui`, asked before the dashboard takes the screen (specs/workflow-inputs, AC-17). */
export function InputsFormApp(props: InputsFormAppProps): ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<FormState>(() => initialForm(props.fields));

  useInput((input, key) => {
    const press = formKey(input, key);
    if (press !== undefined) {
      setState((previous) => reduceForm(previous, press));
    }
  });

  useEffect(() => {
    if (state.outcome !== 'asking') {
      props.onFinish(formResult(state));
      exit();
    }
  }, [state.outcome]);

  return h(
    Box,
    { flexDirection: 'column' },
    ...formLines(state, props.ascii).map((line, index) => {
      const color =
        props.color && (line.tone === 'accent' || line.tone === 'bad') ? TONE[line.tone] : undefined;
      return h(
        Text,
        {
          key: index,
          wrap: 'truncate',
          ...(color === undefined ? {} : { color }),
          ...(line.tone === 'dim' ? { dimColor: true } : {}),
        },
        line.text === '' ? ' ' : line.text,
      );
    }),
  );
}
