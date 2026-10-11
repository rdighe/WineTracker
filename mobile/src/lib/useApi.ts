import { useMemo } from 'react';
import { createApi } from './api';
import { useAuth } from './auth';

export function useApi() {
  const { authHeader } = useAuth();
  return useMemo(() => createApi(authHeader), [authHeader]);
}
