import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { StateLook } from '../status.js';

/** A state as a chip: the symbol and the word, with colour repeating them (AC-07, AC-20). */
export function StateChip(props: { readonly look: StateLook }): ReactElement {
  const { look } = props;
  return h(
    'span',
    { className: `state ${look.tone}` },
    h('span', { 'aria-hidden': true }, look.symbol),
    look.word,
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
