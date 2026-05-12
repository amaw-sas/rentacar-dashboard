import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.DOMRect === "undefined") {
  class DOMRectShim {
    static fromRect() {
      return new DOMRectShim();
    }
    x = 0;
    y = 0;
    width = 0;
    height = 0;
    top = 0;
    left = 0;
    right = 0;
    bottom = 0;
    toJSON() {
      return this;
    }
  }
  globalThis.DOMRect = DOMRectShim as unknown as typeof DOMRect;
}

const elementProto = Element.prototype as Element & {
  hasPointerCapture?: (pointerId: number) => boolean;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: (arg?: boolean | ScrollIntoViewOptions) => void;
};
if (!elementProto.hasPointerCapture) {
  elementProto.hasPointerCapture = () => false;
}
if (!elementProto.releasePointerCapture) {
  elementProto.releasePointerCapture = () => {};
}
if (!elementProto.scrollIntoView) {
  elementProto.scrollIntoView = () => {};
}
