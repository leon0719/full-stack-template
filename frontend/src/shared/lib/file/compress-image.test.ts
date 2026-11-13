import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressImage } from "./compress-image";

const MB = 1024 * 1024;

function bigImage(name = "photo.png", type = "image/png", size = 3 * MB): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("compressImage", () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let outputSize: number;
  let canvas: { width: number; height: number };

  beforeEach(() => {
    outputSize = 200 * 1024;
    drawImage = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvas = this;
      return { drawImage, fillRect: vi.fn(), fillStyle: "" } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement["getContext"]);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb, type) =>
      cb(new Blob([new Uint8Array(outputSize)], { type })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scales the long edge down to maxEdge and re-encodes as JPEG", async () => {
    const result = await compressImage(bigImage(), { maxEdge: 2000 });
    expect(canvas).toMatchObject({ width: 2000, height: 1500 });
    expect(result.name).toBe("photo.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBe(outputSize);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.85,
    );
  });

  it("passes quality and webp type through", async () => {
    const result = await compressImage(bigImage(), { quality: 0.6, type: "image/webp" });
    expect(result.name).toBe("photo.webp");
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/webp",
      0.6,
    );
  });

  it("returns the original file when it is small, not an image, or a GIF", async () => {
    const small = bigImage("s.jpg", "image/jpeg", 100 * 1024);
    const pdf = bigImage("a.pdf", "application/pdf");
    const gif = bigImage("a.gif", "image/gif");
    expect(await compressImage(small)).toBe(small);
    expect(await compressImage(pdf)).toBe(pdf);
    expect(await compressImage(gif)).toBe(gif);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("returns the original file when the output is not smaller", async () => {
    outputSize = 4 * MB;
    const file = bigImage();
    expect(await compressImage(file)).toBe(file);
  });

  it("returns the original file when the browser cannot decode it", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("HEIC")));
    const file = bigImage("a.heic", "image/heic");
    expect(await compressImage(file)).toBe(file);
  });
});
