import type { Unsubscribe } from "./types.js";

/** Minimal typed event emitter (no external deps). */
export class Emitter<Events> {
  private handlers: {
    [K in keyof Events]?: Set<(payload: Events[K]) => void>;
  } = {};

  on<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void,
  ): Unsubscribe {
    (this.handlers[event] ??= new Set()).add(handler);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void,
  ): void {
    this.handlers[event]?.delete(handler);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers[event];
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch {
        // A misbehaving listener must not break the detection loop.
      }
    }
  }

  clear(): void {
    this.handlers = {};
  }
}
