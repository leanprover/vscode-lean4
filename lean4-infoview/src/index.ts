/**
 * This library is an editor-independent loader for the Lean 4 infoview. It expects to be hosted
 * within a webpage and connected to an editor through the main entrypoint, `renderInfoview`.
 * On being given this, the loader fetches its components and renders the infoview.
 */
export * from '@lean4/infoview-api';
export { renderInfoview } from './infoview/main';
