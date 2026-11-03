/// <reference path="../pb_data/types.d.ts" />
/**
 * The models a recording is turned into a song with, in parts (lib_models.js).
 * Not an operation: bytes for the page, not something the agent calls.
 */

routerAdd('GET', '/api/models/part', (e) => require(`${__hooks}/lib_models.js`).part(e));
