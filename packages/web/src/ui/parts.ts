import { createElement as h, type ReactElement, type ReactNode } from 'react';
import { messages } from '../messages.js';
import type { StateLook } from '../status.js';
import { useStale } from './stale.js';

/**
 * A state as a chip: the symbol and the word, with colour repeating them (AC-07, AC-20). While the stream is down the
 * chip says `last known` in words as well as turning grey, so a state is never taken for a live one.
 */
export function StateChip(props: { readonly look: StateLook }): ReactElement {
  const { look } = props;
  const stale = useStale();
  return h(
    'span',
    { className: `state ${look.tone}` },
    h('span', { 'aria-hidden': true }, look.symbol),
    look.word,
    stale ? h('span', { className: 'last-known' }, `, ${messages.state.lastKnown}`) : null,
  );
}

/** A message that replaces the screen: what happened and the one thing to do. Never part of a screen. */
export function Blocking(props: {
  readonly title: string;
  readonly body: string;
  readonly action: string;
}): ReactElement {
  return h(
    'section',
    { className: 'panel blocking', role: 'alert', 'aria-labelledby': 'blocking-title' },
    h('h2', { id: 'blocking-title' }, props.title),
    h('p', null, props.body),
    h('p', null, h('b', null, props.action)),
  );
}

export function Section(props: { readonly title: string; readonly children?: ReactNode }): ReactElement {
  return h('section', null, h('h4', null, props.title), props.children);
}
