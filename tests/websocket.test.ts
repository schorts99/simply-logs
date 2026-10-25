import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { LookupFunction } from 'node:net';
import type WebSocket from 'ws';
import { publicWebSocket } from '../electron/network';

function socketFixture() {
  let options!: WebSocket.ClientOptions;
  let ready!: () => void;
  const connected = new Promise<void>(resolve => { ready = resolve; });
  const sent: string[] = [];
  let terminated = false;
  const socket = Object.assign(new EventEmitter(), {
    send(message: string, callback?: (error?: Error) => void) { sent.push(message); callback?.(); },
    terminate() { terminated = true; socket.emit('close', 1006, Buffer.alloc(0)); },
  });
  const connect = (_url: URL, input: WebSocket.ClientOptions) => {
    options = input; ready(); return socket as unknown as WebSocket;
  };
  return { socket, sent, connect, connected, options: () => options, terminated: () => terminated };
}

test('runtime WebSockets require public WSS URLs and reject credentials, private addresses and custom ports', async () => {
  for (const url of [
    'ws://example.com', 'https://example.com', 'wss://localhost',
    'wss://127.0.0.1', 'wss://[::1]', 'wss://example.com:444', 'wss://user:password@example.com',
  ]) {
    await assert.rejects(publicWebSocket(url, {}, () => {}, new AbortController().signal, () => {
      assert.fail('invalid URLs must not create a socket');
    }), Error, url);
  }
});

test('WebSockets pin validated DNS, disable redirects and compression, bound frames and authenticate only after TLS upgrade', async () => {
  const fixture = socketFixture();
  const controller = new AbortController();
  const values: unknown[] = [];
  const pending = publicWebSocket('wss://1.1.1.1/function/logs', { access_token: 'fixture-token' }, value => values.push(value), controller.signal, fixture.connect);
  await fixture.connected;
  assert.deepEqual(fixture.sent, []);
  assert.equal(fixture.options().followRedirects, false);
  assert.equal(fixture.options().perMessageDeflate, false);
  assert.equal(fixture.options().handshakeTimeout, 8000);
  assert.equal(fixture.options().maxPayload, 2 * 1024 * 1024);
  const agent = fixture.options().agent as unknown as { options: { lookup: LookupFunction } };
  const lookup = agent.options.lookup!;
  await new Promise<void>((resolve, reject) => {
    lookup('rebound.invalid', {}, (error, address, family) => {
      if (error) { reject(error); return; }
      assert.equal(address, '1.1.1.1');
      assert.equal(family, 4);
      resolve();
    });
  });
  fixture.socket.emit('open');
  assert.deepEqual(JSON.parse(fixture.sent[0]), { access_token: 'fixture-token' });
  fixture.socket.emit('message', Buffer.from('{"message":"Function output"}'), false);
  assert.deepEqual(values, [{ message: 'Function output' }]);
  const rejected = assert.rejects(pending, /abort/i);
  controller.abort();
  await rejected;
  assert.equal(fixture.terminated(), true);
  fixture.socket.emit('message', Buffer.from('{"message":"late"}'), false);
  assert.equal(values.length, 1);
});

test('quiet connected WebSockets have no idle deadline and remain cancellable', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = socketFixture();
  const controller = new AbortController();
  const pending = publicWebSocket('wss://1.1.1.1', {}, () => {}, controller.signal, fixture.connect);
  await fixture.connected;
  fixture.socket.emit('open');
  context.mock.timers.tick(60000);
  assert.equal(fixture.terminated(), false);
  const rejected = assert.rejects(pending, /abort/i);
  controller.abort();
  await rejected;
});

test('malformed JSON, binary frames, provider close reasons and failed handshakes terminate explicitly', async () => {
  for (const fail of [
    (socket: EventEmitter) => socket.emit('message', Buffer.from('not JSON'), false),
    (socket: EventEmitter) => socket.emit('message', Buffer.from('{}'), true),
    (socket: EventEmitter) => socket.emit('close', 1008, Buffer.from('Permission denied')),
    (socket: EventEmitter) => socket.emit('error', new Error('Unexpected server response: 403')),
  ]) {
    const fixture = socketFixture();
    const pending = publicWebSocket('wss://1.1.1.1', {}, () => {}, new AbortController().signal, fixture.connect);
    const rejected = assert.rejects(pending, /JSON|binary|Permission denied|403/);
    await fixture.connected;
    fail(fixture.socket);
    await rejected;
    assert.equal(fixture.terminated(), true);
  }
});
