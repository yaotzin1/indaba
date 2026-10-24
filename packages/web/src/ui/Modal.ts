import {
  createElement as h,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import { messages } from '../messages.js';

/** What a person can Tab to inside a dialog. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** The dialog's name, read out when it opens. */
  readonly title: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}

/**
 * A dialog (specs/web-app-registry, AC-14): focus moves into it when it opens and goes back to what had it when it closes,
 * Tab stays inside, and Escape closes it. Its heading takes the first focus so the title is read.
 */
export function Modal(props: ModalProps): ReactElement {
  const dialog = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    opener.current = element?.ownerDocument.activeElement ?? null;
    element?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key !== 'Tab' || dialog.current === null) {
      return;
    }
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    const active = dialog.current.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return h(
    'div',
    { className: 'dialog-backdrop' },
    h(
      'div',
      {
        ref: dialog,
        className: 'dialog',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': id,
        onKeyDown,
      },
      h(
        'div',
        { className: 'dialog-head' },
        h('h2', { id: id, tabIndex: -1, 'data-autofocus': true }, props.title),
        h('button', { type: 'button', className: 'link', onClick: props.onClose }, messages.registry.close),
      ),
      props.children,
    ),
  );
}
