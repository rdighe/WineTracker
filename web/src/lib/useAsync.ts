import { useCallback, useEffect, useRef, useState } from 'react';

/** Load something; keep the last value while reloading so the page holds its frame. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => n === seq.current && setState({ data, loading: false }),
      (error) => n === seq.current && setState((s) => ({ data: s.data, error, loading: false }))
    );
  }, [run]);
  useEffect(reload, [reload]);
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) };
}
