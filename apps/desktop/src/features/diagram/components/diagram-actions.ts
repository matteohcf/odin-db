import { createContext } from "react";

/** What a diagram node can ask of its tab, without passing functions through node data. */
export const DiagramActions = createContext<{ onOpen: (collection: string) => void }>({
  onOpen: () => {},
});
