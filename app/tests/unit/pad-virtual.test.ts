import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeInput, decodeInput } from '../../src/pad/protocol';

// Fake relay socket: records what the PC sends, lets the test push messages.
class FakeWS {
  static last: FakeWS;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeWS.last = this; }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose?.(); }
  push(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

const real = { id: 'DualSense Wireless Controller (Vendor: 054c)', index: 0, connected: true };
const events: { type: string; index: number }[] = [];
const bus = new EventTarget();
bus.addEventListener('gamepadconnected', (e) => events.push({ type: e.type, index: (e as unknown as { gamepad: Gamepad }).gamepad.index }));
bus.addEventListener('gamepaddisconnected', (e) => events.push({ type: e.type, index: (e as unknown as { gamepad: Gamepad }).gamepad.index }));

type Mod = typeof import('../../src/pad/virtual-pads');
let mod: Mod;
let link: ReturnType<Mod['startPhoneLink']>;
const nav = { getGamepads: () => [real, null, null, null] } as unknown as Navigator;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('dispatchEvent', (e: Event) => bus.dispatchEvent(e));
  events.length = 0;
  mod = await import('../../src/pad/virtual-pads');
  link = mod.startPhoneLink({ relayUrl: 'ws://test/pad-relay?role=screen' });
  FakeWS.last.push({ t: 'room', code: 'K7QX2M' });
});
afterEach(() => { link.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const pads = () => navigator.getGamepads() as unknown as ({ index: number; id: string; connected: boolean; buttons: { pressed: boolean; value: number }[]; axes: number[]; vibrationActuator: { playEffect(t: string, p: object): Promise<string> } } | null)[];

describe('virtual phone pads', () => {
  it('keeps the real pads and adds phones at index 4..7', () => {
    expect(link.code).toBe('K7QX2M');
    expect(link.status).toBe('open');
    for (const id of ['pa', 'pb', 'pc', 'pd']) FakeWS.last.push({ t: 'phone-join', from: id });
    const list = pads();
    expect(list[0]).toBe(real);
    expect(list.slice(4, 8).map((p) => p?.index)).toEqual([4, 5, 6, 7]);
    expect(list[4]!.id).toBe(mod.PAD_ID);
    expect(link.phones.map((p) => p.seat)).toEqual([2, 3, 4, 5]);
    expect(events).toEqual([4, 5, 6, 7].map((index) => ({ type: 'gamepadconnected', index })));
    // each phone was told its player number through the relay
    expect(FakeWS.last.sent.filter((m) => m.t === 'seat').map((m) => [m.to, m.n])).toEqual([['pa', 2], ['pb', 3], ['pc', 4], ['pd', 5]]);
    FakeWS.last.push({ t: 'phone-leave', from: 'pb' });
    expect(pads()[5]).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'gamepaddisconnected', index: 5 });
  });

  it('decodes input packets into buttons and axes', () => {
    FakeWS.last.push({ t: 'phone-join', from: 'pa' });
    const buttons = new Array(17).fill(0);
    buttons[0] = 1; buttons[12] = 1; buttons[16] = 1; buttons[7] = 0.5;
    const pkt = encodeInput(1, { buttons, axes: [1, -0.5, 0, 0.25] });
    expect(decodeInput(pkt)!.buttons[7]).toBeCloseTo(0.5, 2);
    FakeWS.last.push({ t: 'input', p: pkt, from: 'pa' });
    const p = pads()[4]!;
    expect(p.buttons[0].pressed).toBe(true);
    expect(p.buttons[12].pressed).toBe(true);
    expect(p.buttons[16].pressed).toBe(true);
    expect(p.buttons[1].pressed).toBe(false);
    expect(p.buttons[7].value).toBeCloseTo(0.5, 2);
    expect(p.buttons[7].pressed).toBe(true);
    expect(p.axes[0]).toBe(1);
    expect(p.axes[1]).toBeCloseTo(-0.5, 2);
    expect(p.axes[3]).toBeCloseTo(0.25, 2);
    // a late packet with an older sequence number is ignored
    FakeWS.last.push({ t: 'input', p: encodeInput(0, { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] }), from: 'pa' });
    expect(p.buttons[0].pressed).toBe(true);
    expect(decodeInput(['i', 1, 2])).toBeNull();
  });

  it('releases everything when a phone goes silent for 3 s', () => {
    FakeWS.last.push({ t: 'phone-join', from: 'pa' });
    const buttons = new Array(17).fill(0); buttons[0] = 1;
    FakeWS.last.push({ t: 'input', p: encodeInput(1, { buttons, axes: [0.8, 0, 0, 0] }), from: 'pa' });
    const p = pads()[4]!;
    vi.advanceTimersByTime(3500);
    expect(p.connected).toBe(false);
    expect(p.buttons[0].pressed).toBe(false);
    expect(p.axes[0]).toBe(0);
    expect(pads()[4]).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: 'gamepaddisconnected', index: 4 });
    // the next packet brings it back
    FakeWS.last.push({ t: 'input', p: encodeInput(2, { buttons, axes: [0, 0, 0, 0] }), from: 'pa' });
    expect(pads()[4]?.connected).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'gamepadconnected', index: 4 });
  });

  it('forwards rumble to that phone and resolves complete', async () => {
    FakeWS.last.push({ t: 'phone-join', from: 'pa' });
    FakeWS.last.push({ t: 'phone-join', from: 'pb' });
    const r = await pads()[5]!.vibrationActuator.playEffect('dual-rumble', { duration: 120, strongMagnitude: 0.8, weakMagnitude: 2 });
    expect(r).toBe('complete');
    expect(FakeWS.last.sent.at(-1)).toEqual({ t: 'rumble', ms: 120, strong: 0.8, weak: 1, to: 'pb' });
  });

  it('keeps the relay room alive while a phone is connected', () => {
    FakeWS.last.push({ t: 'phone-join', from: 'pa' });
    const seats = () => FakeWS.last.sent.filter((m) => m.t === 'seat').length;
    const before = seats();
    for (let i = 0; i < 61; i++) { FakeWS.last.push({ t: 'pong', ts: 0, from: 'pa' }); vi.advanceTimersByTime(1000); }
    expect(seats()).toBe(before + 1);
  });

  it('measures latency from ping/pong and marks the relay down on close', () => {
    FakeWS.last.push({ t: 'phone-join', from: 'pa' });
    vi.advanceTimersByTime(1000);
    const ping = FakeWS.last.sent.find((m) => m.t === 'ping')!;
    vi.advanceTimersByTime(18);
    FakeWS.last.push({ t: 'pong', ts: ping.ts, from: 'pa' });
    expect(link.phones[0].latency).toBeGreaterThanOrEqual(0);
    expect(link.phones[0].transport).toBe('relay');
    FakeWS.last.close();
    expect(link.status).toBe('down');
    expect(link.phones).toEqual([]);
  });
});

describe('without the Gamepad API', () => {
  it('still returns the phone pads', async () => {
    vi.resetModules();
    vi.stubGlobal('navigator', {});
    const m = await import('../../src/pad/virtual-pads');
    m.installVirtualPads();
    expect(navigator.getGamepads()).toEqual([]);
  });
});
