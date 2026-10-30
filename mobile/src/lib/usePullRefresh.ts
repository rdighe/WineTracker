/**
 * Pull to refresh that only shows when someone pulls: loads the screen makes
 * on its own (opening it, coming back to it) refresh quietly, without the
 * spinner pulling the page down.
 */
import { useCallback, useState } from 'react';

export function usePullRefresh(load: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  return { refreshing, onRefresh };
}
