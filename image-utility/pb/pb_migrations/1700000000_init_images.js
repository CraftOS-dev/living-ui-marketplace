/// <reference path="../pb_data/types.d.ts" />
/**
 * Image Utility schema.
 *
 * PocketBase (Go + isolated JS hooks) has no image-processing runtime — there
 * is no server-side compute (that design was tried and rejected). So ALL image
 * work (decode, crop, resize, format convert, compress) happens CLIENT-SIDE in
 * a <canvas> (V1 used Pillow); the backend only STORES the uploaded source
 * image (a `file` field) plus its metadata and the most-recent transform's
 * output metadata (`last_output`). Edited outputs are regenerated client-side
 * on download from the source + the stored transform spec.
 *
 * Fields mirror ImageAsset.to_dict():
 *   filename / file_size / format / width / height / last_output, plus the
 *   `source` file field and an `uploaded` autodate (→ uploaded_at).
 *
 * Auth mode "none": open rules are acceptable because the app binds loopback
 * and the origin guard (_system.pb.js) refuses foreign-origin writes. The open
 * `source` file field is served at /api/files/images/<recordId>/<filename>.
 */
migrate(
  (app) => {
    const images = new Collection({
      type: 'base',
      name: 'images',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'filename', type: 'text', required: true, max: 500 },
        {
          name: 'source',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 52428800, // 50 MB
          mimeTypes: [
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
            'image/bmp',
            'image/tiff',
          ],
        },
        { name: 'file_size', type: 'number' },
        { name: 'format', type: 'text', max: 20 },
        { name: 'width', type: 'number' },
        { name: 'height', type: 'number' },
        { name: 'last_output', type: 'json', maxSize: 200000 },
        { name: 'uploaded', type: 'autodate', onCreate: true },
      ],
    });
    app.save(images);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('images'));
  },
);
