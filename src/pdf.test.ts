import { expect, test } from 'vitest';
import { makePdf } from './pdf';

test('pdf has one page object per page and a correct xref start', () => {
  const pdf = makePdf([{ jpeg: new Uint8Array([1, 2, 3]), w: 400, h: 300 }, { jpeg: new Uint8Array([4]), w: 400, h: 300 }]);
  const text = new TextDecoder('latin1').decode(pdf);
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/Count 2');
  expect(text).toContain('/MediaBox [0 0 300 225]');
  const start = Number(/startxref\n(\d+)/.exec(text)![1]);
  expect(text.slice(start, start + 4)).toBe('xref');
});
