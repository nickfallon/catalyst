// css is manually minified from ./styes.css and saved as a module
// which exports a string in ./styes.js
// recommended: https://cssminifier.com/
const css = require("./styles");

module.exports = {
  customCss: css,
  customSiteTitle: "Rest API interactive documentation",
  customfavIcon: "/img/icons/favicon.ico"

  // Also available:
  // - customJs
  // - isExplorer
  // - options
  // - swaggerUrl
};
