module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo wires up expo-router, React 19, and (when installed)
    // the reanimated/worklets plugin in the right order. Don't add those by
    // hand — doubling them up breaks the build.
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
  };
};
