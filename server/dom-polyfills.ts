// Minimal DOM-related stubs for running bundled code in a pure Node.js environment.
// These are **not** full implementations, just enough to avoid runtime ReferenceErrors
// from libraries that expect these globals to exist.

const g = globalThis as any;

if (typeof g.DOMMatrix === "undefined") {
  g.DOMMatrix = class DOMMatrix {
    constructor(_init?: any) {
      // no-op
    }
  };
}

if (typeof g.ImageData === "undefined") {
  g.ImageData = class ImageData {
    constructor(_data?: any, _width?: number, _height?: number) {
      // no-op
    }
  };
}

if (typeof g.Path2D === "undefined") {
  g.Path2D = class Path2D {
    constructor(_path?: any) {
      // no-op
    }
  };
}


