// `eslint-config-next/core-web-vitals` ships a flat-config array as of Next
// 16, so it is spread in directly. Routing it through `FlatCompat.extends()`
// (what create-next-app used to generate) hands that flat array to the
// eslintrc validator, which rejects it and then crashes formatting its own
// error — "Converting circular structure to JSON", with no lint output at all.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [...nextCoreWebVitals];

export default eslintConfig;
