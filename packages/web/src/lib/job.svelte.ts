/** Tracks one async action's loading / result / error state so each import form doesn't need its own trio of variables. */
export function createJob<T>() {
  let loading = $state(false);
  let result = $state<T | null>(null);
  let error = $state('');

  return {
    get loading() { return loading; },
    get result() { return result; },
    get error() { return error; },
    /** Runs `action`, recording its outcome. Resolves with the result, or null if it failed (the message is in `error`). */
    async run(action: () => Promise<T>): Promise<T | null> {
      loading = true;
      result = null;
      error = '';
      try {
        result = await action();
        return result;
      } catch (e: any) {
        error = e?.message ?? 'Something went wrong';
        return null;
      } finally {
        loading = false;
      }
    },
    fail(message: string) {
      result = null;
      error = message;
    },
    reset() {
      result = null;
      error = '';
    },
  };
}
