import { expect, test } from 'vitest';
import { fabricToPage, newDesign, pageToFabric } from './model';

test('page <-> fabric roundtrip keeps objects, size and background', () => {
  const page = newDesign().pages[0];
  const json = { objects: [{ type: 'rect', left: 1 }], background: '#123456' };
  const next = fabricToPage(page, json, 1080, 1080);
  expect(next).toMatchObject({ id: page.id, width: 1080, height: 1080, background: '#123456', objects: json.objects });
  expect(pageToFabric(next)).toEqual(json);
});
