/**
 * The environment variables the site may be built with. Merged into vite/client's own
 * declarations.
 */
interface ImportMetaEnv {
  /** The API's origin, when it is not this site's host on VITE_API_PORT. */
  readonly VITE_API_ORIGIN?: string

  /** The API's port, baked in at build time. The API is its own IIS site. */
  readonly VITE_API_PORT?: string
}
