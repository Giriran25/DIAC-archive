import { useCallback, useEffect, useRef, useState } from 'react';

/* ---------------------------------------------------------------------- *
 * One place where a screen reads the archive.
 *
 * Every view was writing its own useEffect with its own loading flag, and
 * they disagreed: some swallowed the error, some left `loading` true
 * forever on a failure, and none of them cancelled a stale request. A
 * screen that shows the answer to a question the visitor has already moved
 * on from is showing the wrong thing.
 * ---------------------------------------------------------------------- */

/**
 * @param {(signal: AbortSignal) => Promise<any>} fetcher
 * @param {any[]} deps  re-runs when these change
 */
export function useArchive(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.resolve()
      .then(() => fetcherRef.current(controller.signal))
      .then((data) => {
        if (live) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        // A cancelled request is not a failure; the screen has moved on.
        if (!live || err?.name === 'AbortError') return;
        setState({ data: null, loading: false, error: err });
      });

    return () => { live = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, retry };
}
