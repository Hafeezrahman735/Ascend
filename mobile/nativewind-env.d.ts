/// <reference types="nativewind/types" />

// TypeScript 6 (Expo SDK 57) rejects a side-effect import of a module it has no
// declaration for, so `import '../global.css'` in app/_layout.tsx failed to
// compile. The import is real and required: it is what feeds Tailwind's output
// into NativeWind at build time.
declare module '*.css';
