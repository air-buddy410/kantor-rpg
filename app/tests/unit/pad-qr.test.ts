import { describe, expect, it } from 'vitest';
import { penalty, qrEncode, qrMatrix, qrSvg, wifiQrText } from '../../src/pad/qr';

// Reference: the qrcode package the server already ships (not an app dependency).
type Ref = { create(d: unknown, o: object): { modules: { size: number; data: Uint8Array }; maskPattern: number; version: number } };
const load = async (): Promise<Ref> => {
  // @ts-expect-error plain CommonJS without type declarations
  const m = (await import('../../../server/node_modules/qrcode/lib/core/qrcode.js')) as unknown as Ref & { default?: Ref };
  return m.default ?? m;
};

const SAMPLES = [
  'A',
  'HELLO',
  'https://employee-rpg.air-buddy.site/pad.html#K7QX2M',
  'https://employee-rpg.air-buddy.site/kantor/pad.html?lang=en#K7QX2M', // 60+ chars
  wifiQrText('PerumNet Gaming', 'sandi;uji:"1"'),
  'Kopi ☕ dan teh, 2026', // multi-byte UTF-8
  'x'.repeat(300), // version 13 (two block groups, version info)
];

describe('qr encoder', () => {
  it('matches the reference module by module for every mask', async () => {
    const QR = await load();
    expect(SAMPLES[3].length).toBeGreaterThanOrEqual(60);
    for (const s of SAMPLES) {
      for (let mask = 0; mask < 8; mask++) {
        const ours = qrEncode(s, mask);
        const ref = QR.create([{ data: s, mode: 'byte' }], { errorCorrectionLevel: 'M', maskPattern: mask });
        expect(ours.size, s).toBe(ref.modules.size);
        expect(ours.version, s).toBe(ref.version);
        const flat = ours.modules.flat().map((b) => (b ? 1 : 0));
        expect(flat.join(''), `${s} mask ${mask}`).toBe(Array.from(ref.modules.data, (b) => (b ? 1 : 0)).join(''));
      }
    }
  });

  it('picks the mask with the lowest penalty', () => {
    for (const s of SAMPLES) {
      const auto = qrEncode(s);
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => penalty(qrEncode(s, m).modules));
      expect(scores[auto.mask]).toBe(Math.min(...scores));
      expect(qrMatrix(s)).toEqual(auto.modules);
    }
  });

  it('stops at version 15', () => {
    expect(qrEncode('y'.repeat(412)).version).toBe(15);
    expect(() => qrEncode('y'.repeat(413))).toThrow(RangeError);
  });

  it('draws an accessible SVG with a quiet zone', () => {
    const svg = qrSvg('HELLO', { label: 'Buka "kontroler"' });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Buka &quot;kontroler&quot;"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('M4 4h1v1h-1z'); // finder corner sits after 4 quiet modules
  });
});

describe('wifi payload', () => {
  it('escapes backslash, semicolon, comma, colon and quote', () => {
    expect(wifiQrText('PerumNet Gaming', 'abc12345')).toBe('WIFI:T:WPA;S:PerumNet Gaming;P:abc12345;;');
    expect(wifiQrText('a;b,c', 'p:q"r\\s')).toBe('WIFI:T:WPA;S:a\\;b\\,c;P:p\\:q\\"r\\\\s;;');
    expect(wifiQrText('Open', '', 'nopass')).toBe('WIFI:T:nopass;S:Open;P:;;');
  });
});
