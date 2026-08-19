/**
 * Types for the virtual `@env` module provided by react-native-dotenv
 * (registered in babel.config.js).
 *
 * Every value is `string | undefined`: the plugin runs with `allowUndefined`
 * (its default), so a name that is missing from `.env` — or a build with no
 * `.env` file at all — inlines `undefined` rather than failing the build.
 * Read these through `src/config/JellyfinConfig.ts` instead of importing them
 * directly, so the undefined case is handled in one place.
 */
declare module '@env' {
  export const JELLYFIN_SERVER_URL: string | undefined;
}
