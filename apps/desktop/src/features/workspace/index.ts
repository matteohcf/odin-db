// Public API of the workspace feature. Other features import only from here.
export { type TabLabelContext, WorkspaceTabs } from "./components/workspace-tabs";
export {
  type CollectionTab,
  type ServerTab,
  type ShellTab,
  type UsersTab,
  useTabs,
  type WorkspaceTab,
} from "./store/tabs-store";
