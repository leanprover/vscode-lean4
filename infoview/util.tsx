import { Event } from 'lean-client-js-core'

// https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function colorizeMessage(goal: string): string {
    return goal
        .replace(/^([|⊢]) /mg, '<strong class="goal-vdash">$1</strong> ')
        .replace(/^(\d+ goals|1 goal)/mg, '<strong class="goal-goals">$1</strong>')
        .replace(/^(context|state):/mg, '<strong class="goal-goals">$1</strong>:')
        .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
        .replace(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg, '<strong class="goal-hyp">$1</strong> :');
}

export function basename(path) { return path.split(/[\\/]/).pop(); }

interface Disposable {
    dispose(): void;
}

interface EventLike<T> extends Disposable {
    on(h : (x : T) => void): Disposable;
}

function mkEventLike<T>(o: EventLike<any>, ...ds: Disposable[]): EventLike<T> {
    return {on: f => o.on(f), dispose() { o.dispose(); for (let x of ds) x.dispose(); }}
}

function onChange<T>(comp: (a:T,b:T)=> boolean, e: EventLike<T>): EventLike<T> {
    const out = new Event();
    let prev = null;
    const h = e.on(x => {
        if (prev !== null && comp(prev,x)) {
            out.fire(x);
        }
        prev = x;
    });
    return mkEventLike(out, h);
}

function map<T,U>(f: (x : T) => U, e: EventLike<T>) : EventLike<U> {
    const out = new Event();
    return mkEventLike(out, e.on((x) => out.fire(f(x))));
}

function filter<T>(f: (x : T) => boolean, e: EventLike<T>) : EventLike<T> {
    const out = new Event();
    return mkEventLike(out, e.on((x) => f(x) && out.fire(x)));
}

function merge<U>(...es: EventLike<U>[]) : EventLike<U> {
    const out = new Event();
    return mkEventLike(out, ...es.map(e => e.on(x => out.fire(x))));
}

function throttle<T>(delayms: number, inputEvent : EventLike<T>) : EventLike<T> {
    const out = new Event<T>();
    let trig = false;
    let value = null;
    const f = () => {
        if (value !== null) {
            out.fire(value);
            value = null;
            setTimeout(f, delayms);
        } else {
            trig = false
        }
    };
    const h = inputEvent.on((x) => {
        value = x;
        if (!trig) {
            trig = true;
            f();
        }
    });
    return mkEventLike(out, h)
}

export const EventLike = {
    map, filter, throttle, merge, onChange
}
