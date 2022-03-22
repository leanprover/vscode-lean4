/** HACK:
 * Consumers of the infoview need to provide react-popper as a bundled ES module to be imported
 * by both the infoview and dynamically loaded widgets. We build it here to make this easier until
 * such a bundle becomes available on NPM.
 */
export * from 'react-popper';
