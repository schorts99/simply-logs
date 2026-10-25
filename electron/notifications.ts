interface NativeNotification {
  once(event: 'show', listener: () => void): unknown;
  once(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
  removeListener(event: 'show', listener: () => void): unknown;
  removeListener(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
  show(): void;
}

export function showNotification(
  notification: NativeNotification,
  timeoutMs = 15_000,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      notification.removeListener('show', shown);
      notification.removeListener('failed', failed);
    };
    const shown = () => { cleanup(); resolve(true); };
    const failed = (_event: unknown, error: string) => {
      cleanup();
      reject(new Error(error || 'The operating system rejected the notification.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The operating system did not confirm the notification request.'));
    }, timeoutMs);
    notification.once('show', shown);
    notification.once('failed', failed);
    try {
      notification.show();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
