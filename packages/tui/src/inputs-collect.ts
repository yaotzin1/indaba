import { type Logger, noopLogger } from '@indaba/engine';
import { h, type RenderOptions, render } from './ink/adapter.js';
import { InputsFormApp } from './ink/inputs-form-app.js';
import type { FormField } from './inputs-form.js';

export interface CollectInputsOptions {
  /** The inputs to ask for, in the order to ask them: `InputDescription` of `@indaba/core` fits. */
  readonly fields: readonly FormField[];
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  /** Records that the form opened and closed, and how many inputs it asked for. Never a value. */
  readonly logger?: Logger;
}

/** The answers, one list of lines for each input; the run checks them. */
export interface CollectedInputs {
  readonly values: Readonly<Record<string, readonly string[]>>;
}

/**
 * Asks a person for the inputs a run lacks, in the dashboard process and before the child starts (specs/workflow-inputs,
 * AC-17). `undefined` means the form was closed without answering. Gives the terminal back before it returns or throws.
 * A value a person types is in no log line and no error: the logger gets the count of inputs and how it ended.
 */
export async function collectInputs(options: CollectInputsOptions): Promise<CollectedInputs | undefined> {
  const logger = options.logger ?? noopLogger;
  let result: CollectedInputs | undefined;
  const renderOptions: RenderOptions = {
    stdout: options.stdout,
    stdin: options.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  };
  logger.info('tui.inputs', 'the inputs form opened', { inputs: options.fields.length });
  const instance = render(
    h(InputsFormApp, {
      fields: options.fields,
      ascii: options.ascii,
      color: options.color,
      onFinish: (collected) => {
        result = collected;
      },
    }),
    renderOptions,
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
  }
  logger.info('tui.inputs', 'the inputs form closed', { answered: result !== undefined });
  return result;
}
