import { createContext, useContext } from "react";

/** What the settings search box holds, lowercase; empty when not searching. */
export const SettingsSearch = createContext("");

export const useSettingsSearch = () => useContext(SettingsSearch);
