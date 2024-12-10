export function groupByKey<K, V>(values: V[], key: (value: V) => K): Map<K, V[]> {
    const r = new Map<K, V[]>()
    for (const v of values) {
        const k = key(v)
        const group = r.get(k) ?? []
        group.push(v)
        r.set(k, group)
    }
    return r
}

export function groupByUniqueKey<K, V>(values: V[], key: (value: V) => K): Map<K, V> {
    const r = new Map<K, V>()
    for (const v of values) {
        r.set(key(v), v)
    }
    return r
}
