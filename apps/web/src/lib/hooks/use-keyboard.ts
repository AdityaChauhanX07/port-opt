'use client';

import { useEffect } from 'react';

type Handler = (e: KeyboardEvent) => void;

export interface KeyBinding {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  handler: Handler;
  /** Prevent binding from firing when focus is in an input/textarea */
  ignoreInputs?: boolean;
}

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

export function useKeyboard(bindings: KeyBinding[]) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const b of bindings) {
        const metaOk   = b.meta   ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        const ctrlOk   = b.ctrl   ? e.ctrlKey  : true;
        const shiftOk  = b.shift  ? e.shiftKey : !e.shiftKey;
        const keyOk    = e.key === b.key || e.key.toLowerCase() === b.key.toLowerCase();
        if (!metaOk || !ctrlOk || !shiftOk || !keyOk) continue;
        if (b.ignoreInputs && isInputFocused()) continue;
        e.preventDefault();
        b.handler(e);
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings]);
}
