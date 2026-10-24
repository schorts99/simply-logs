import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CredentialStore, type Encryption } from '../electron/credentials';

const encryption: Encryption = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: value => Buffer.from([...value].reverse().join('')),
  decryptString: value => [...value.toString()].reverse().join(''),
};

test('tokens are encrypted, survive restart, and concurrent writes preserve both values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'simply-logs-vault-'));
  try {
    const store = new CredentialStore(directory, encryption);
    await Promise.all([store.save('one', 'placeholder-token-one'), store.save('two', 'placeholder-token-two')]);
    assert.ok(!(await readFile(path.join(directory, 'credentials.json'), 'utf8')).includes('placeholder-token-one'));
    const restarted = new CredentialStore(directory, encryption);
    assert.equal(await restarted.get('one'), 'placeholder-token-one');
    assert.equal(await restarted.get('two'), 'placeholder-token-two');
    await restarted.delete('one');
    await assert.rejects(restarted.get('one'), /No saved token/);
    assert.equal(await restarted.get('two'), 'placeholder-token-two');
  } finally { await rm(directory, { recursive: true }); }
});

test('unavailable or basic-text keychains never persist plaintext tokens', async () => {
  for (const secure of [false, true]) {
    const directory = await mkdtemp(path.join(tmpdir(), 'simply-logs-session-'));
    try {
      const store = new CredentialStore(directory, {
        ...encryption, isEncryptionAvailable: () => secure, getSelectedStorageBackend: () => 'basic_text',
      });
      assert.deepEqual(await store.save('one', 'placeholder-session-token'), { persistent: false });
      assert.equal(await store.get('one'), 'placeholder-session-token');
      assert.deepEqual(await readdir(directory), []);
      const restarted = new CredentialStore(directory, { ...encryption, isEncryptionAvailable: () => false });
      await assert.rejects(restarted.get('one'), /keychain is unavailable/);
    } finally { await rm(directory, { recursive: true }); }
  }
});

test('corrupt credential storage is never silently overwritten', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'simply-logs-corrupt-'));
  try {
    const file = path.join(directory, 'credentials.json');
    await writeFile(file, '{broken');
    const store = new CredentialStore(directory, encryption);
    await assert.rejects(store.save('one', 'placeholder'), /not been overwritten/);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true }); }
});
