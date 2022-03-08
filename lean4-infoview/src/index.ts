/**
 * This library is an editor-independent loader for the Lean 4 infoview. It expects to be hosted
 * within a webpage and connected to an editor through the main entrypoint, `renderInfoview`.
 * On being given this, the loader fetches its components and renders the infoview.
 */
export * from '@lean4/infoview-api';
export { renderInfoview } from './infoview/main';

/**
 * Widget libraries which import @lean4/infoview components will also want to use React and related
 * libraries. It turns out that re-exporting them here is the simplest way to provide a single,
 * shared artifact to consumers.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactPopper from 'react-popper';
export { React, ReactDOM, ReactPopper }
