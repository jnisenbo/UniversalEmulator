import { useEffect, useRef } from 'react';
import type { InputHandler } from './actions';
import { pushInputHandler } from './input';

/**
 * Registers a handler once, at mount, and always calls the latest closure.
 * Registering once keeps stack order = mount order, so a modal opened later
 * stays above the screen that opened it even as that screen re-renders.
 */
export function useInputHandler(handler: InputHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => pushInputHandler((e) => ref.current(e)), []);
}
