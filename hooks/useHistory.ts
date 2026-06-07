import { useCallback, useEffect, useState } from 'react';
import { clearHistory, getHistory } from '../services/history';
import { ScanRecord } from '../types';

export function useHistory() {
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHistory();
      setRecords(data);
    } catch (err) {
      console.error('Failed to load scan history:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clear = useCallback(async () => {
    await clearHistory();
    setRecords([]);
  }, []);

  return { records, loading, clear, refresh: load };
}
