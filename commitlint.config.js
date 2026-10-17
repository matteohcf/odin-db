export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", ["core", "desktop", "ui", "bindings", "ci", "deps", "docs"]],
  },
};
