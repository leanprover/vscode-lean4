/* eslint-disable @typescript-eslint/no-namespace */
import * as React from 'react';
import type { DocumentUri, Position, Range, TextDocumentPositionParams } from 'vscode-languageserver-protocol';

import { Event } from './event';
import { EditorContext } from './contexts';

export interface DocumentPosition extends Position {
  uri: DocumentUri;
}

export namespace DocumentPosition {
  export function isEqual(p1: DocumentPosition, p2: DocumentPosition): boolean {
    return p1.uri === p2.uri && p1.line === p2.line && p1.character === p2.character;
  }

  export function toTdpp(p: DocumentPosition): TextDocumentPositionParams {
    return { textDocument: { uri: p.uri },
             position: { line: p.line, character: p.character } }
  }

  export function toString(p: DocumentPosition) {
    return `${p.uri}:${p.line + 1}:${p.character}`;
  }
}

export namespace PositionHelpers {
  export function isAfterOrEqual(p1: Position, p2: Position): boolean {
    return p1.line > p2.line || (p1.line === p2.line && p1.character >= p2.character);
  }
}

export namespace RangeHelpers {
  export function contains(range: Range, pos: Position, ignoreCharacter?: boolean): boolean {
    if (!ignoreCharacter) {
      if (pos.line === range.start.line && pos.character < range.start.character) return false;
      if (pos.line === range.end.line && pos.character > range.end.character) return false;
    }
    return range.start.line <= pos.line && pos.line <= range.end.line;
  }
}

// https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** @deprecated (unused) */
export function colorizeMessage(goal: string): string {
  return goal
    .replace(/^([|⊢]) /mg, '<strong class="goal-vdash">$1</strong> ')
    .replace(/^(\d+ goals|1 goal)/mg, '<strong class="goal-goals">$1</strong>')
    .replace(/^(context|state):/mg, '<strong class="goal-goals">$1</strong>:')
    .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
    .replace(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg, '<strong class="goal-hyp">$1</strong> :');
}

export function basename(path: string): string {
  const bn = path.split(/[\\/]/).pop();
  if (bn) return bn;
  else return '';
}

/** Like {@link React.useEffect} but subscribes to `ev` firing. */
export function useEvent<T>(ev: Event<T>, f: (_: T) => void, dependencies?: React.DependencyList): void {
  React.useEffect(() => {
    const h = ev.on(f);
    return () => h.dispose();
  }, dependencies)
}

export function useEventResult<T>(ev: Event<T>): T | undefined;
export function useEventResult<T, S>(ev: Event<S>, map: (_: S | undefined) => T | undefined): T | undefined;
export function useEventResult(ev: Event<unknown>, map?: any): any {
  const [t, setT] = React.useState(() => map ? map(ev.current) : ev.current);
  useEvent(ev, newT => setT(map ? map(newT) : newT));
  return t;
}

export function useServerNotificationEffect<T>(method: string, f: (params: T) => void, deps?: React.DependencyList): void {
  const ec = React.useContext(EditorContext);
  React.useEffect(() => {
    void ec.api.subscribeServerNotifications(method).catch(ex => {
      console.error(`Failed subscribing to server notification '${method}': ${ex}`);
    });
    const h = ec.events.gotServerNotification.on(([thisMethod, params]: [string, T]) => {
      if (thisMethod !== method) return;
      f(params);
    });
    return () => {
      h.dispose();
      void ec.api.unsubscribeServerNotifications(method);
    };
  }, deps);
}

/**
 * Returns the same tuple as `setState` such that whenever a server notification with `method`
 * arrives at the editor, the state will be updated according to `f`.
 */
export function useServerNotificationState<S, T>(method: string, initial: S, f: (params: T) => Promise<(state: S) => S>, deps?: React.DependencyList): [S, React.Dispatch<React.SetStateAction<S>>] {
  const [s, setS] = React.useState<S>(initial);

  useServerNotificationEffect(method, (params: T) => void f(params).then(g => setS(g)), deps);

  return [s, setS];
}

export function useClientNotificationEffect<T>(method: string, f: (params: T) => void, deps?: React.DependencyList): void {
  const ec = React.useContext(EditorContext);
  React.useEffect(() => {
    void ec.api.subscribeClientNotifications(method).catch(ex => {
      console.error(`Failed subscribing to client notification '${method}': ${ex}`);
    });
    const h = ec.events.sentClientNotification.on(([thisMethod, params]: [string, T]) => {
      if (thisMethod !== method) return;
      f(params);
    });
    return () => {
      h.dispose();
      void ec.api.unsubscribeClientNotifications(method);
    };
  }, deps);
}

/**
 * Like {@link useServerNotificationState} but for client->server notifications sent by the editor.
 */
export function useClientNotificationState<S, T>(method: string, initial: S, f: (state: S, params: T) => S, deps?: React.DependencyList): [S, React.Dispatch<React.SetStateAction<S>>] {
  const [s, setS] = React.useState<S>(initial);

  useClientNotificationEffect(method, (params: T) => {
    setS(state => f(state, params));
  }, deps);

  return [s, setS];
}

/**
 * Returns `[isPaused, setPaused, tPausable, tRef]` s.t.
 * - `[isPaused, setPaused]` are the paused status state
 * - for as long as `isPaused` is set, `tPausable` holds its initial value (the `t` passed before pausing)
 *   rather than updates with changes to `t`.
 * - `tRef` can be used to overwrite the paused state
 *
 * To pause child components, `startPaused` can be passed in their props.
 */
export function usePausableState<T>(startPaused: boolean, t: T): [boolean, React.Dispatch<React.SetStateAction<boolean>>, T, React.MutableRefObject<T>] {
  const [isPaused, setPaused] = React.useState<boolean>(startPaused);
  const old = React.useRef<T>(t);
  if (!isPaused) old.current = t;
  return [isPaused, setPaused, old.current, old];
}

/**
 * Returns a stateful log string and a function to update it.
 */
export function useLogState(): [string, (...msg: any[]) => void] {
  const [log, setLog] = React.useState('');

  function outputLog(...msg: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    console.log(...msg);
    const fmt = msg.reduce((acc, val) => acc + ' ' + val.toString(), '');
    setLog(oldLog => oldLog + fmt + '\n');
  }

  return [log, outputLog];
}

export type Keyed<T> = T & { key: string };

/**
 * Adds a unique `key` property to each element in `elems` using
 * the values of (possibly non-injective) `getId`.
 */
export function addUniqueKeys<T>(elems: T[], getId: (el: T) => string): Keyed<T>[] {
  const keys: { [key: string]: number } = {};
  return elems.map(el => {
    const id = getId(el);
    keys[id] = (keys[id] || 0) + 1;
    return { key: `${id}:${keys[id]}`, ...el }
  });
}

/** Like `React.forwardRef`, but also allows using the ref inside the forwarding component.
 * Adapted from https://itnext.io/reusing-the-ref-from-forwardref-with-react-hooks-4ce9df693dd */
export function forwardAndUseRef<T, P = {}>(render: (props: React.PropsWithChildren<P>, ref: React.RefObject<T>, setRef: (_: T | null) => void)
    => React.ReactElement | null): React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<T>> {
  return React.forwardRef<T, P>((props, ref) => {
    const thisRef = React.useRef<T | null>(null)
    return render(props, thisRef, v => {
      thisRef.current = v
      if (!ref) return
      if (typeof ref === 'function') {
        ref(v)
      } else {
        ref.current = v
      }
    })
  })
}

export interface LogicalDomTraverser {
  contains(el: Node): boolean
}

export interface LogicalDomStorage {
  // Returns a function which disposes of the registration.
  registerDescendant(el: HTMLElement | null): () => void
}

export const LogicalDomContext = React.createContext<LogicalDomStorage>({registerDescendant: () => () => {}})

/** Suppose a component B appears as a React child of the component A. For layout reasons,
 * we sometimes don't want B to appear as an actual child of A in the DOM. We may still however
 * want to carry out `contains` checks as if B were there, i.e. according to the React tree
 * structure rather than the DOM structure. Logical DOM nodes make this work. Note this is not
 * shadow DOM, although it is similar.
 *
 * For the method to work, each component introducing a *logical* (React-but-not-DOM) child must
 * register it in the `LogicalDomContext`.
 *
 * To carry out checks, call `useLogicalDom` with a ref to the node for which you want to carry
 * out `contains` checks and wrap that node in a `LogicalDomContext` using the resulting
 * `LogicalDomStorage`. */
export function useLogicalDom(ref: React.RefObject<HTMLElement>): [LogicalDomTraverser, LogicalDomStorage] {
  const parentCtx = React.useContext(LogicalDomContext)
  React.useEffect(() => {
    if (ref.current) {
      const h = parentCtx.registerDescendant(ref.current)
      return () => h()
    }
  }, [ref, parentCtx])
  const descendants = React.useRef<Set<Node>>(new Set())

  const contains = (el: Node) => {
    if (ref.current && ref.current.contains(el)) return true
    for (const d of descendants.current) {
      if (d.contains(el)) return true
    }
    return false
  }

  const registerDescendant = (el: HTMLElement | null) => {
    const h = parentCtx.registerDescendant(el)
    if (el) descendants.current.add(el)
    return () => {
      if (el) descendants.current.delete(el)
      h()
    }
  }

  return [
    React.useMemo(() => ({contains}), [ref]),
    React.useMemo(() => ({registerDescendant}), [parentCtx])
  ]
}
