import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export interface Encryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class CredentialStore {
  private session = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private directory: string, private encryption: Encryption) {}

  private get persistent(): boolean {
    return this.encryption.isEncryptionAvailable() && this.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }

  private async read(): Promise<Record<string, string>> {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, 'credentials.json'), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string')) {
        throw new Error('Invalid credential store.');
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error('The credential store could not be read. Your saved tokens have not been overwritten.');
    }
  }

  private async write(values: Record<string, string>): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'credentials.json');
    await writeFile(`${file}.tmp`, JSON.stringify(values), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

  async get(id: string): Promise<string> {
    await this.queue;
    const cached = this.session.get(id);
    if (cached) return cached;
    if (!this.persistent) throw new Error('The OS keychain is unavailable. Reconnect with a token for this session.');
    const value = (await this.read())[id];
    if (!value) throw new Error('No saved token. Reconnect this application.');
    try {
      return this.encryption.decryptString(Buffer.from(value, 'base64'));
    } catch {
      throw new Error('The OS keychain could not unlock this token. Reconnect this application.');
    }
  }

  save(id: string, token: string): Promise<{ persistent: boolean }> {
    const result = this.queue.then(async () => {
      const persistent = this.persistent;
      if (persistent) {
        const values = await this.read();
        values[id] = this.encryption.encryptString(token).toString('base64');
        await this.write(values);
      }
      this.session.set(id, token);
      return { persistent };
    });
    this.queue = result.catch(() => {});
    return result;
  }

  delete(id: string): Promise<void> {
    const result = this.queue.then(async () => {
      const values = await this.read();
      delete values[id];
      await this.write(values);
      this.session.delete(id);
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
