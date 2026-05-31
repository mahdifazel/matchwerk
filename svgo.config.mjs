/**
 * Project-wide svgo defaults. Preserves human-readable IDs (Figma layer
 * names like `Hi-A`…`Hi-E`) so external/internal CSS can target groups by
 * name — otherwise svgo's `cleanupIds` plugin strips unused IDs.
 *
 * If you don't want IDs preserved for a particular file, pass `--no-config`
 * or run svgo from a directory above this one.
 */
export default {
  multipass: true,
  floatPrecision: 1,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          cleanupIds: {
            // Keep every ID the original file declares — even if nothing
            // references it internally, the caller might be targeting it
            // from CSS / JS / a <style> block.
            remove: false,
            minify: false,
          },
        },
      },
    },
  ],
};
