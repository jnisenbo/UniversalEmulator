export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tabPrev' | 'tabNext' | 'menu' | 'filterPrev' | 'filterNext';
export type InputSource = 'pad' | 'stick' | 'key' | 'pointer';

export interface InputEvent {
  action: Action;
  /** press: first frame down. repeat: auto-repeat while held. release: let go. */
  kind: 'press' | 'repeat' | 'release';
  source: InputSource;
  /** ms since the previous press/repeat of the same action (repeat cadence). */
  interval?: number;
}

export const isDirection = (a: Action): a is 'up' | 'down' | 'left' | 'right' => a === 'up' || a === 'down' || a === 'left' || a === 'right';

/** Handlers are asked top-down; returning true consumes the event. Modals return true for everything. */
export type InputHandler = (e: InputEvent) => boolean | void;
