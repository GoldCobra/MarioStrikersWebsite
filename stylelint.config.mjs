// Catches CSS mistakes (invalid values, unknown properties, duplicates) in the site's own stylesheets;
// the Gear Builder snapshot keeps its authors' CSS.
export default {
  extends: ["stylelint-config-recommended"],
  ignoreFiles: ["apps/web/public/assets/gear-builder/**", "**/dist/**", "**/node_modules/**"],
  rules: {
    // The cascade is deliberate: the partials are ordered in global.ts, and later rules override
    // earlier ones of higher specificity on purpose (media blocks in tablet.css and mobile.css last).
    "no-descending-specificity": null,
  },
};
