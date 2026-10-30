/// <reference path="../pb_data/types.d.ts" />
/**
 * app.guide: how the AI agent edits images in this app through the
 * agent-app CLI. Conventions, the edit kinds, error codes and ready-to-run
 * recipes.
 */

function guide(app) {
  const K = require(`${__hooks}/lib_kinds.js`);
  const S = require(`${__hooks}/lib_stack.js`);
  const X = require(`${__hooks}/lib_export.js`);
  const run = 'agent-app run <project>';
  const pol = S.policy(app);
  const recent = app.findRecordsByFilter('images', 'id != ""', '-updated', 12, 0).map((r) => ({ id: r.id, name: r.getString('name'), size: r.getInt('width') + ' x ' + r.getInt('height'), format: r.getString('format'), edits: r.getInt('edits_count') }));
  const presets = app.findRecordsByFilter('presets', 'id != ""', 'kind,name', 100, 0).map((r) => ({ name: r.getString('name'), kind: r.getString('kind') }));
  const assets = app.findRecordsByFilter('assets', 'id != ""', 'name', 50, 0).map((r) => ({ id: r.id, name: r.getString('name') }));
  return {
    app: 'Image Utility: crop, resize, adjust, cut out and export images on this computer, with layers on top (text, boxes, arrows, highlights, numbered steps, drawings, redactions, logos) that move, resize, rotate and stack on their own; one image at a time or in batches. Edits are non-destructive: each image keeps its original, a stack of photo edits and its layers, rendered by the local image engine. No logins.',
    recent_images: recent,
    presets: presets,
    logos: assets,
    policy: {
      agent_edits: pol.agent_edits,
      agent_batches: pol.agent_batches,
      meaning:
        (pol.agent_edits === 'propose'
          ? 'Your edits become a proposal the person accepts or rejects in their workspace (with your preview); you cannot change or remove their edits. '
          : 'Your edits apply directly (the person sees them marked as made by the AI agent and can undo them). ') +
        (pol.agent_batches === 'run' ? 'You may run batches you create.' : 'Batches you create wait for the person to run them.'),
      house_rules: pol.house_rules || '',
    },
    export_defaults: X.defaults(app),
    conventions: [
      'An image is its original file, a stack of photo edits applied in order (crop, resize, canvas, adjust, filter, remove_bg) and layers drawn over the result, bottom first. edits.add appends a photo edit (or inserts with --at <position>); layers.add puts a layer on top. Every answer gives the stack with each edit\'s size in and out, and the preview path.',
      'Photo edit coordinates (a crop box) are full-resolution pixels of the image as it enters that edit; images.get gives each edit\'s in size. The origin is the top-left corner.',
      'Layers: layers.add --image <id> --type <type> --props \'{...}\' with numbers in RESULT pixels (what images.render shows; --space layer gives them in the layer\'s own space). A layer is pinned to the photo by default: it follows later crops, turns and resizes, so an arrow keeps pointing at its subject and a redaction keeps covering its secret. --anchor frame pins it to the frame instead (a watermark or caption that stays in a corner; the only kind a batch or recipe can carry; there props are fractions: positions of the width and height, sizes of the shorter side). layers.list gives every layer with in_result numbers; layers.update --layer <id> --props \'{"cx":500}\' moves it (props merge; --visible false hides it); layers.arrange --to front|back|forward|backward; layers.remove.',
      'Look before and after you edit: images.render --image <id> returns a PNG/WebP path of the current result (--upto <edit id> for the result just before an edit, --original true for the untouched file, --region \'{"x":..,"y":..,"w":..,"h":..}\' for a crop at full resolution). Read the picture to find what to crop, redact or annotate; it is the only way to know where things are.',
      'dry_run=true renders any edit or recipe without saving it and answers the same envelope with a preview path. Use it to check placement before committing.',
      'analyze.image --image <id> gives Auto adjust values, the content box after trimming a flat border (trim), the most interesting crop for a ratio (smart, --ratio 1:1), the main colours and a histogram summary. Use its numbers rather than guessing.',
      'Your changes on an image within 15 minutes form one batch in its history; history.revert --batch <id> undoes a batch in one step, history.undo / history.redo step through the image\'s history (a revert is itself a batch, so it can be undone).',
      'Exports never change the image: export.create encodes the current result and keeps the file (exports.list shows path, size and saving). export.estimate encodes without keeping and gives real sizes; use it to pick a format or quality before exporting. Quality is best, balanced, small or 1..100; mode size with target_kb finds the best quality under a size (shrinking the image only if it must).',
      'Metadata on export: keep (all of it), basic (camera, date, author, copyright, description; the default) or none. GPS is stripped unless strip_gps=false. Images are converted to sRGB; orientation is applied to the pixels. An image\'s alt_text is written into the file as its description.',
      'Batches apply one recipe (edits from a recipe preset or a JSON list; crops by ratio, not by box) and one set of outputs to many images, named by a rename pattern: ' + require(`${__hooks}/lib_batch.js`).TOKENS.join(' ') + '. batches.preview shows every planned file name and size and encodes a few samples; check it before running.',
      'Files you write go inside the export folder set by the person (settings.get shows export_folder); a path outside it is refused.',
      'Remove background runs a model on this computer (fast, or detailed when the person installed it). If the engine or the model is not installed yet, the answer says so (model_missing); the person installs it in Settings.',
      'Requests: when the person asks you through the app, requests.get --request <id> gives the brief (image, images, region they drew, their words); set requests.update --status working when you start and --status done --result "<one paragraph: what you changed or proposed and why>" when you finish.',
      'Lists and objects are JSON strings on the command line, e.g. --params \'{"mode":"longest","longest":2048}\'. Confirm with the person before deleting images, exports or batches.',
    ],
    layer_types: {
      common: 'name, opacity 0.05..1, locked, anchor photo|frame. Box layers rotate about their centre: rotation in degrees, clockwise.',
      text: 'cx, cy (centre), size (font size), text (lines split by \\n), font (' + K.FONTS.join(', ') + '), color, bg (a label box behind), outline, align left|center|right, rotation; tile=true with gap repeats it across the image (a watermark).',
      rect: 'cx, cy, w, h, rotation, width (stroke; 0 for none), color, fill, fill_opacity, radius.',
      ellipse: 'cx, cy, w, h, rotation, width, color, fill, fill_opacity.',
      arrow: 'x1, y1 (tail), x2, y2 (tip), width, color, both (heads on both ends).',
      line: 'x1, y1, x2, y2, width, color.',
      highlight: 'cx, cy, w, h, rotation, color (a translucent marker over text).',
      step: 'cx, cy, size, n (the number), color: a numbered circle for step-by-step guides.',
      pen: 'cx, cy, w, h, rotation, points [[u,v],...] in -0.5..0.5 of the box, width, color: a freehand stroke.',
      redact: 'cx, cy, w, h, rotation, mode solid (default, with color) | pixelate | blur, label. Solid is the only mode that cannot be undone by sharpening: use it for passwords, keys, card and account numbers.',
      logo: 'cx, cy, w, h, rotation, asset (a logo id from assets.list); tile=true with gap repeats it.',
    },
    edit_kinds: {
      crop: 'params: rect {x,y,w,h} (pixels of the image after turns/flip/angle) or ratio ("1:1", "4:3", "16:9", "original", or a number) with smart=true to centre on the most interesting part; angle -45..45 straightens (the crop shrinks to stay inside); turns 1..3 quarter turns clockwise; flip_h, flip_v.',
      resize: 'params: mode longest {longest}, pixels {width and/or height}, percent {percent}, fit {width,height} (inside the box), cover {width,height,smart} (fills the box exactly, cropping the overflow); enlarge=true allows growing; resample lanczos (default), sharp, bicubic, bilinear, nearest (pixel art); a light sharpen follows a big shrink unless sharpen=false.',
      canvas: 'params: padding (pixels, or {t,r,b,l}), ratio (pad out to a ratio), fill (#hex, transparent, blur, or {"from":"#..","to":"#..","angle":135}), radius (rounded corners), shadow=true. Turns a screenshot into a framed card.',
      adjust: 'params: exposure (EV -3..3), contrast, highlights, shadows, whites, blacks, saturation, vibrance, temperature, tint, clarity (-100..100), sharpen (0..100), vignette (-100..100), levels {black,white,gamma}; auto=true computes levels, gamma and white balance from the image (analyze.image shows the values).',
      filter: 'params: name (' + K.FILTERS.join(', ') + '), strength 0..100 (default 100).',
      remove_bg: 'params: model fast (default) or detailed, background transparent (default) or a #hex colour, edge soft or hard, refine -20..20 (grow or shrink the cut-out edge, pixels). Export a transparent result as PNG, WebP or AVIF (JPEG has no transparency; it uses the matte colour).',
    },
    error_codes: {
      param_invalid: 'a param is missing or out of range; the message names it and a valid value (app.schema lists every kind)',
      agent_propose_only: 'the policy keeps your edits as proposals, and you tried to change or remove one of the person\'s edits',
      person_only: 'only the person can do this (policy, export folder, installing a model, deciding a proposal)',
      engine_unavailable: 'the image engine is still installing or failed to install (engine.status); try again when it is ready',
      model_missing: 'the background model is not installed (the person installs it in Settings)',
      not_for_animation: 'this edit or output does not apply to an animated image',
      not_found: 'no record with that id (a layer id comes from layers.list)',
      unreadable: 'the file is not an image the engine can read',
      too_large: 'the image or the result is over the size limit',
      out_of_memory: 'the engine ran out of memory; make the image smaller first (resize) or export fewer outputs at once',
    },
    recipes: {
      'Bring images in': run + ' images.import --path "C:\\Users\\me\\Pictures\\photo.jpg" (or --paths \'["..",".."]\', or --folder "C:\\..\\shots" for every image in a folder). The answer gives each image\'s id, size and format.',
      'What is selected in the app': run + ' app.context shows the open image, the selected images, the selected tool and any region the person drew.',
      'Look at an image': run + ' images.render --image <id> (the current result); --original true for the untouched file; --region \'{"x":0,"y":0,"w":1200,"h":800}\' to read detail at full size.',
      'Straighten and crop to a ratio': run + ' edits.add --image <id> --kind crop --params \'{"angle":-2.5,"ratio":"4:3","smart":true}\' --dry_run true, check the preview, then again without dry_run.',
      'Make it web-ready': run + ' edits.apply --image <id> --preset "Web-ready photo" (Auto adjust, longest edge 2048), then export.estimate --image <id> --outputs \'[{"format":"webp","quality":"balanced"},{"format":"avif","quality":"balanced"},{"format":"jpeg","quality":"balanced"}]\' and export the smallest one that looks right.',
      'Fit an email limit': run + ' export.create --image <id> --format jpeg --mode size --target_kb 500 (the answer says the quality it chose and whether it met the target).',
      'Polish a screenshot': run + ' layers.add --image <id> --type redact --props \'{"cx":550,"cy":113,"w":260,"h":34,"name":"API key"}\', then --type arrow --props \'{"x1":200,"y1":520,"x2":400,"y2":380}\' and --type step --props \'{"cx":180,"cy":540,"size":40,"n":1}\', then edits.apply --preset "Screenshot polish" (padding, rounded corners, shadow on a gradient; the layers stay on their spots).',
      'Cut out a product': run + ' edits.add --image <id> --kind remove_bg --params \'{"model":"fast","background":"#ffffff"}\', then --kind canvas --params \'{"ratio":"1:1","padding":80,"fill":"#ffffff"}\'.',
      'Label something': run + ' layers.add --image <id> --type text --props \'{"cx":640,"cy":90,"size":56,"text":"New feature","color":"#ffffff","bg":"#111111"}\'; move it later with layers.update --layer <id> --props \'{"cx":700,"cy":120}\', turn it with --props \'{"rotation":-8}\'.',
      'Watermark for a client': run + ' layers.add --image <id> --type logo --anchor frame --space layer --props \'{"cx":0.88,"cy":0.9,"w":0.2,"h":0.1,"asset":"<logo id>","opacity":0.7}\' (pinned to the frame: stays bottom right after any crop).',
      'Social sizes from one image': run + ' presets.list --kind size, then export.create --image <id> --outputs \'[{"format":"jpeg","square":1080,"suffix":"-square"}]\' or apply a size preset with edits.apply --image <id> --preset "Instagram portrait" on a duplicate (images.duplicate) so the original stack stays.',
      'Favicons': run + ' export.create --image <id> --preset "Favicon set" (favicon.ico with 16, 32 and 48 px, apple-touch-icon 180, icons 192 and 512).',
      'Same edits on other images': run + ' edits.copy --from <image id> --to \'["<id>","<id>"]\' [--kinds \'["adjust","layer"]\'] (positions scale to each image\'s size).',
      'Process a folder': run + ' batches.create --images \'["<id>",...]\' --recipe_preset "Web-ready photo" --outputs \'[{"format":"webp","quality":"balanced"}]\' --rename "{name}-web" --name "Blog photos", then batches.preview --batch <id> (names, sizes, a few real encodes), then batches.run --batch <id> (or leave it for the person, per the policy); batches.get shows progress and the files.',
      'Describe images': run + ' images.render --image <id>, write a short alt text (what it shows and why it matters, under 125 characters) and images.update --image <id> --alt_text "..." --keywords \'["..",".."]\'; exports carry the alt text as the description.',
      'Undo': run + ' history.list --image <id> shows batches (newest first) with kind edit, undo or redo; history.undo --image <id> steps back one batch, history.redo forward; history.revert --batch <id> undoes a specific batch.',
      'See what changed in quality': run + ' export.compare --image <id> --format webp --quality small returns a before and after crop at 100 % (paths) so you can judge artefacts.',
    },
    export_folder: require(`${__hooks}/lib_app.js`).settingsJson(app).export_folder || '(not set: the person sets it in Settings; until then exports stay in the app)',
  };
}

module.exports = { guide: guide };
