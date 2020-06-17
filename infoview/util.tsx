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

export interface Signal<T> {
    on(h: (x: T) => void): Disposable;
    value?: T;
}

export class SignalBuilder {
    subscriptions: Disposable[] = [];
    dispose() {for (const s of this.subscriptions) s.dispose();}

    push(...handlers: Disposable[]) {this.subscriptions.push(...handlers);}

    mkEvent<T>() {
        const e = new Event<T>();
        this.subscriptions.push(e);
        return e;
    }

    onChange<T>(e: Signal<T>, comp: (a: T,b: T) => boolean = (x,y) => x !== y): Signal<T> {
        const out = new Event<T>();
        let prev = null;
        const h = e.on(x => {
            if (prev !== null && comp(prev,x)) {
                out.fire(x);
            }
            prev = x;
        });
        this.subscriptions.push(out, h);
        return out;
    }

    filter<T>(f: (x: T) => boolean, e: Signal<T>): Signal<T> {
        return {on: h => e.on(x => f(x) && h(x))};
    }
    map<T,U>(f: (x: T) => U, e: Signal<T>): Signal<U> {
        return {on: h => e.on(x => h(f(x)))};
    }
    merge<U>(...es: Signal<U>[]): Signal<U> {
        const out = new Event();
        return {on: h => {
            const ss = es.map(e => e.on(h));
            return {dispose(){for (const s of ss) s.dispose();}}
        }}
    }
    throttle<T>(delayms: number, inputEvent: Signal<T>): Signal<T> {
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
        this.subscriptions.push(out, h);
        return out;
    }

    zip<X>(es: {[k in keyof X]: Signal<X[k]>}, defaults?: X): Signal<X> {
        const current: X = defaults || {} as any;
        const triggered: any = {};
        const update = (h) => (k: string) => (v: any) => {
            current[k] = v;
            triggered[k] = true;
            if (defaults || Object.getOwnPropertyNames(es).every(s => triggered[s])) h({...current});
        }
        return {on: h => {
            const hs = Object.getOwnPropertyNames(es).map(k => es[k].on(update(h)(k)));
            return {dispose() {for (const x of hs) x.dispose();}}
        }};
    }

    unzip<X>(e: Signal<X>, ks: (keyof X)[]): {[k in keyof X]: Signal<X[k]>} {
        const r: any = {};
        for (const k of ks) {
            r[k] = {on: h => {
                let prev = null;
                return e.on(x => {
                    if (!prev || prev[k] !== x[k]) {
                        prev = x[k];
                        h(x[k]);
                    }
                })}
            };
        }
        return r;
    }

    /** Only trigger the output `y` at most once after each `x` trigger. */
    onceAfter<X,Y>(x: Signal<X>, y: Signal<Y>): Signal<Y> {
        const out = new Event<Y>();
        let trig = false;
        this.subscriptions.push(
            x.on(() => {trig = true;}),
            y.on(v => {
                if (trig) {
                    trig = false;
                    out.fire(v);
                }
            }),
        );
        return out;
    }

    /** When the input fires, run the given promise and throttle future input values until the promise resolves.
     * Swallows the error if the promise errors.
     */
    throttleTask<X,Y>(f: (x: X) => Promise<Y>, input: Signal<X>): {result: Signal<Y>; isRunning: Signal<boolean>} {
        const result = new Event<Y>();
        const isRunning = new Event<boolean>();
        let value = null;
        let task = null;
        const run = (x) => {
            task = f(x).then(y => {
                result.fire(y)
            }).finally(() => {
                if (value !== null) {
                    run(value);
                    value = null;
                } else {
                    isRunning.fire(false);
                    task = null;
                }
            })
        }
        const h = input.on((x) => {
            value = x;
            if (!task) {
                isRunning.fire(true);
                run(x);
            }
        });
        this.subscriptions.push(result, isRunning, h);
        return {result, isRunning};
    }

    mapTaskOrdered<X,Y>(f: (x: X) => Promise<Y>, input: Signal<X>): Signal<Y> {
        let inflight = 0;
        let head = null;
        const result = new Event<Y>();
        const mk = (x) => f(x).then(y => result.fire(y)).finally(() => inflight--);
        const h = input.on(x => {
            if (inflight === 0) {
                inflight++;
                head = mk(x);
            } else {
                inflight++;
                head = head.catch(() => ({})).then(() => mk(x));
            }
        });
        this.subscriptions.push(result, h);
        return result;
    }

    scan<A,X>(f: (acc: A, x: X) => A, init: A, g: Signal<X>): Signal<A> {
        const out = new Event<A>();
        let acc = init;
        const h = g.on(x => {acc = f(acc, x); out.fire(acc);});
        this.subscriptions.push(out, h);
        return out;
    }

    store<X>(g: Signal<X>): Signal<X> & {value?: X} {
        const r: any = g;
        if (r.isStoring) {return r;}
        r.isStoring = true;
        this.subscriptions.push(g.on(x => r.value = x));
        return r;
    }

    debounce(ms: number, g: Signal<boolean>): Signal<boolean> {
        const out = new Event<boolean>();
        let value = false;
        let trig = false;
        let checking = false;
        let down = Date.now();
        const check = () => {
            const e = Date.now() - down;
            if (trig) {
                trig = false;
                if (e < ms) {
                    setTimeout(check, ms - e);
                } else {
                    checking = false;
                }
            } else {
                trig = false;
                value = false;
                checking = false;
                out.fire(false);
            }
        }
        const h = g.on(x => {
            if (x) {
                trig = true;
            } else {
                down = Date.now();
            }
            if (x && !value) {
                value = true;
                out.fire(true);
            }
            if (!x && value && !checking) {
                trig = false;
                setTimeout(check, ms);
            }
        });
        this.subscriptions.push(out, h);
        return out;
    }
}