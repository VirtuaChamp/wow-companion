import { describe, expect, it } from "vitest";
import { bgr24BufferToCells, classifyCell } from "../../src/transport/capture.ts";

function bgrPixel(b: number, g: number, r: number): [number, number, number] {
  return [b, g, r];
}

describe("capture.pixelToCell", () => {
  it("reads GDI+ Format24bppRgb bytes in B,G,R memory order, not R,G,B", () => {
    const cellSize = 4;
    const width = 8;
    const height = 1;
    const stride = width * cellSize * 3;
    const pixels = new Uint8Array(stride * cellSize);

    const pureColors: readonly [number, number, number][] = [
      [0, 0, 0],
      [0, 0, 255],
      [0, 255, 0],
      [0, 255, 255],
      [255, 0, 0],
      [255, 0, 255],
      [255, 255, 0],
      [255, 255, 255],
    ];

    for (let col = 0; col < width; col += 1) {
      const [r, g, b] = pureColors[col] as [number, number, number];
      const [bb, gg, rr] = bgrPixel(b, g, r);
      for (let py = 0; py < cellSize; py += 1) {
        for (let px = 0; px < cellSize; px += 1) {
          const x = col * cellSize + px;
          const offset = py * stride + x * 3;
          pixels[offset] = bb;
          pixels[offset + 1] = gg;
          pixels[offset + 2] = rr;
        }
      }
    }

    const cells = bgr24BufferToCells(pixels, stride, width, height, cellSize);
    expect(cells).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("classifyCell maps a channel triple to the nearest pure colour index", () => {
    expect(classifyCell(0, 0, 0)).toBe(0);
    expect(classifyCell(255, 255, 255)).toBe(7);
    expect(classifyCell(200, 10, 200)).toBe(5);
  });
});
