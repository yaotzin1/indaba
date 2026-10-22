import type { DiscussionView } from '@indaba/core';
import { createElement as h, type ReactElement, useState } from 'react';
import { messages } from '../messages.js';
import { Section } from './parts.js';

type Load = 'idle' | 'loading' | 'none' | 'failed' | 'loaded';

/** Where each participant ended: the type of the last message each one posted. */
export function lastPositions(view: DiscussionView): string {
  const last = new Map<string, string>();
  for (const message of view.messages) {
    last.set(message.sender, message.type);
  }
  return [...last].map(([sender, type]) => `${sender} ${type}`).join(', ');
}

function Thread(props: { readonly view: DiscussionView }): ReactElement {
  const { view } = props;
  const rounds = [...new Set(view.messages.map((message) => message.round))];
  return h(
    'div',
    { className: 'thread' },
    view.messages.length > 0
      ? h('p', { className: 'muted' }, messages.discussion.summary(lastPositions(view)))
      : null,
    ...rounds.map((round) =>
      h(
        'section',
        { key: round },
        h('h5', null, messages.discussion.round(round)),
        ...view.messages
          .filter((message) => message.round === round)
          .map((message, index) =>
            h(
              'div',
              { key: index, className: 'message' },
              h(
                'p',
                null,
                h('b', null, message.sender),
                ' ',
                h('span', { className: 'muted' }, message.type),
              ),
              // Text a model wrote is shown as text, never as markup.
              h('pre', { tabIndex: 0 }, message.content),
            ),
          ),
      ),
    ),
    view.ruling === undefined
      ? null
      : h(
          'section',
          null,
          h('p', null, h('b', null, messages.discussion.ruling(view.ruling.verdict, view.ruling.decidedBy))),
          view.ruling.note === '' ? null : h('pre', { tabIndex: 0 }, view.ruling.note),
        ),
  );
}

/** The discussion of a debate step: closed by default, loaded when asked for, shown as plain text. */
export function Discussion(props: {
  readonly load: () => Promise<DiscussionView | undefined>;
}): ReactElement {
  const [state, setState] = useState<Load>('idle');
  const [view, setView] = useState<DiscussionView | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state === 'loaded' || state === 'loading') {
      return;
    }
    setState('loading');
    props.load().then(
      (found) => {
        setView(found);
        setState(found === undefined ? 'none' : 'loaded');
      },
      () => setState('failed'),
    );
  };

  return h(
    Section,
    { title: messages.discussion.title },
    h(
      'button',
      { type: 'button', onClick: toggle, 'aria-expanded': open },
      open ? messages.discussion.hide : messages.discussion.show,
    ),
    open && state === 'loading'
      ? h('p', { className: 'muted', role: 'status' }, messages.discussion.loading)
      : null,
    open && state === 'none' ? h('p', { className: 'muted' }, messages.discussion.none) : null,
    open && state === 'failed' ? h('p', { role: 'alert' }, messages.discussion.failed) : null,
    open && state === 'loaded' && view !== undefined ? h(Thread, { view }) : null,
  );
}
