import type { Clock, EventDispatcher, IdGenerator } from '../support/index.js';

export const SpanStatus = {
  Unset: 'unset',
  Ok: 'ok',
  Error: 'error',
} as const;
export type SpanStatus = (typeof SpanStatus)[keyof typeof SpanStatus];

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

export class TokenUsage {
  constructor(
    readonly inputTokens: number,
    readonly outputTokens: number,
  ) {}
}

export interface ModelRate {
  readonly input: number;
  readonly output: number;
}

/**
 * USD price per million tokens, by model. The built-in rates are indicative;
 * supply your own table for billing-grade numbers.
 */
export class PricingTable {
  private readonly rates: Readonly<Record<string, ModelRate>>;

  constructor(rates: Readonly<Record<string, ModelRate>> = {}) {
    this.rates = rates;
  }

  static defaults(): PricingTable {
    return new PricingTable({
      'anthropic/claude-3.7-sonnet': { input: 3.0, output: 15.0 },
      'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0 },
      'anthropic/claude-opus-4': { input: 15.0, output: 75.0 },
      'deepseek/deepseek-r1': { input: 0.55, output: 2.19 },
    });
  }

  costUsd(model: string, usage: TokenUsage): number | undefined {
    const key = this.normalise(model);
    const rate = Object.hasOwn(this.rates, key) ? this.rates[key] : undefined;
    if (rate === undefined) {
      return undefined;
    }
    return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
  }

  /** Variant suffixes such as ":thinking" or ":free" share the base model's rate. */
  private normalise(model: string): string {
    const pos = model.indexOf(':');
    return pos === -1 ? model : model.slice(0, pos);
  }
}

/**
 * A unit of work in a trace: Trace (task) -> Span (step) -> child span (LLM call, tool, verification).
 * The root span of a trace has no parent.
 */
export interface SpanEvent {
  readonly name: string;
  readonly attributes: SpanAttributes;
}

export class Span {
  private ended: Date | undefined;
  private currentStatus: SpanStatus = SpanStatus.Unset;
  private currentMessage: string | undefined;
  private readonly attrs: Record<string, SpanAttributeValue>;
  private readonly eventList: SpanEvent[] = [];

  constructor(
    readonly traceId: string,
    readonly spanId: string,
    readonly parentSpanId: string | undefined,
    readonly name: string,
    readonly startedAt: Date,
    attributes: SpanAttributes = {},
  ) {
    this.attrs = { ...attributes };
  }

  get endedAt(): Date | undefined {
    return this.ended;
  }

  get status(): SpanStatus {
    return this.currentStatus;
  }

  get statusMessage(): string | undefined {
    return this.currentMessage;
  }

  get attributes(): SpanAttributes {
    return this.attrs;
  }

  get events(): readonly SpanEvent[] {
    return this.eventList;
  }

  addEvent(name: string, attributes: SpanAttributes = {}): void {
    this.eventList.push({ name, attributes: { ...attributes } });
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.attrs[key] = value;
  }

  end(at: Date, status: SpanStatus, message?: string): void {
    this.ended = at;
    this.currentStatus = status;
    this.currentMessage = message;
  }

  isEnded(): boolean {
    return this.ended !== undefined;
  }

  durationMs(): number | undefined {
    return this.ended === undefined ? undefined : this.ended.getTime() - this.startedAt.getTime();
  }
}

export class SpanStarted {
  constructor(readonly span: Span) {}
}

export class SpanEnded {
  constructor(readonly span: Span) {}
}

/**
 * A chunk of what a step's runner streamed. The engine dispatches one for each chunk, in order, with the ids of
 * the span the chunk belongs to. The text is exactly what the runner produced: redact it before it is stored.
 */
export class StepOutput {
  constructor(
    readonly traceId: string,
    readonly spanId: string,
    /** Counts from 0 within the span. */
    readonly seq: number,
    readonly text: string,
  ) {}
}

/**
 * Creates spans, stamps them with GenAI semantic-convention attributes and
 * announces their lifecycle through the event dispatcher.
 */
export class Tracer {
  static readonly ATTR_OPERATION = 'gen_ai.operation.name';
  static readonly ATTR_PROVIDER = 'gen_ai.provider.name';
  static readonly ATTR_MODEL = 'gen_ai.request.model';
  static readonly ATTR_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
  static readonly ATTR_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
  static readonly ATTR_COST_USD = 'indaba.cost.usd';

  constructor(
    private readonly clock: Clock,
    private readonly events: EventDispatcher,
    private readonly ids: IdGenerator,
    private readonly pricing: PricingTable = new PricingTable(),
  ) {}

  startTrace(name: string, attributes: SpanAttributes = {}): Promise<Span> {
    return this.start(name, this.ids.next(32), undefined, attributes);
  }

  startSpan(name: string, parent: Span, attributes: SpanAttributes = {}): Promise<Span> {
    return this.start(name, parent.traceId, parent.spanId, attributes);
  }

  async endSpan(span: Span, status: SpanStatus = SpanStatus.Ok, message?: string): Promise<void> {
    span.end(this.clock.now(), status, message);
    await this.events.dispatch(new SpanEnded(span));
  }

  recordUsage(span: Span, provider: string, model: string, usage: TokenUsage): void {
    span.setAttribute(Tracer.ATTR_PROVIDER, provider);
    span.setAttribute(Tracer.ATTR_MODEL, model);
    span.setAttribute(Tracer.ATTR_INPUT_TOKENS, usage.inputTokens);
    span.setAttribute(Tracer.ATTR_OUTPUT_TOKENS, usage.outputTokens);
    const cost = this.pricing.costUsd(model, usage);
    if (cost !== undefined) {
      span.setAttribute(Tracer.ATTR_COST_USD, cost);
    }
  }

  private async start(
    name: string,
    traceId: string,
    parentId: string | undefined,
    attributes: SpanAttributes,
  ): Promise<Span> {
    const span = new Span(traceId, this.ids.next(16), parentId, name, this.clock.now(), attributes);
    await this.events.dispatch(new SpanStarted(span));
    return span;
  }
}
