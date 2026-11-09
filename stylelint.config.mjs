// Catches CSS mistakes (invalid values, unknown properties, duplicates) in the site's own stylesheets;
// the Gear Builder snapshot keeps its authors' CSS.
export default {
  extends: ["stylelint-config-recommended"],
  ignoreFiles: ["apps/web/public/assets/gear-builder/**", "**/dist/**", "**/node_modules/**"],
  rules: {
    // The cascade is deliberate: the partials are ordered in global.ts, and later rules override
    // earlier ones of higher specificity on purpose (media blocks in tablet.css and mobile.css last).
    "no-descending-specificity": null,
    // New in stylelint 18. The visually hidden helpers keep the classic `clip` and setup-guides.css keeps
    // `word-break: break-word` on purpose: both still work everywhere, and replacing them could move text.
    "property-no-deprecated": null,
    "declaration-property-value-keyword-no-deprecated": null,
  },
};
