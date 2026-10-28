// Vite's `?raw` import, which Vitest resolves: the file's text as a string.
declare module "*?raw" {
  const text: string;
  export default text;
}
