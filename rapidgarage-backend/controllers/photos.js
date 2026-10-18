// /post/:id/photos  - add (POST, multipart field "photos") and delete photos.
const router = require('express').Router({ mergeParams: true });
const multer = require('multer');
const models = require('../models');
const { badRequest, sendError, notFound, serverError, parseId } = require('../lib/http');
const { MAX_PHOTOS_PER_POST, MAX_FILE_BYTES, processImage, newKeys, parseAlt } = require('../lib/photos');
const { getStorage } = require('../lib/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_PHOTOS_PER_POST, fields: 10, parts: 20 },
}).array('photos', MAX_PHOTOS_PER_POST);

function runUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'file_too_large', 'Each photo must be 8 MB or smaller.');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return badRequest(res, `Upload up to ${MAX_PHOTOS_PER_POST} photos in the "photos" field.`);
    }
    return badRequest(res, 'Invalid upload.');
  });
}

// Owner or admin only (checked by the parent router before this runs).
router.post('/', runUpload, async (req, res) => {
  const files = req.files || [];
  if (!files.length) return badRequest(res, 'No photos uploaded (use multipart field "photos").');
  const post = req.post;
  const storage = getStorage();
  const written = [];
  try {
    const existing = await models.PostPhoto.count({ where: { postId: post.id } });
    if (existing + files.length > MAX_PHOTOS_PER_POST) {
      return badRequest(res, `A post can have at most ${MAX_PHOTOS_PER_POST} photos (it has ${existing}).`);
    }
    // Validate + process everything before storing anything.
    const processed = [];
    for (const f of files) {
      try {
        processed.push(await processImage(f.buffer));
      } catch (e) {
        if (e.code === 'unsupported_type') return sendError(res, 415, 'unsupported_type', `"${f.originalname}" is not a JPEG, PNG or WebP image.`);
        if (e.code === 'corrupt_image') return badRequest(res, `"${f.originalname}" could not be read as an image.`);
        throw e;
      }
    }
    const photos = [];
    for (let i = 0; i < processed.length; i++) {
      const p = processed[i];
      const keys = newKeys(post.id);
      await storage.put(keys.storageKey, p.full, 'image/webp'); written.push(keys.storageKey);
      await storage.put(keys.thumbKey, p.thumb, 'image/webp'); written.push(keys.thumbKey);
      photos.push(await models.PostPhoto.create(Object.assign({ postId: post.id, width: p.width, height: p.height, position: existing + i }, keys)));
    }
    return res.status(201).json(photos);
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => {})));
    return serverError(res, err);
  }
});

// PUT /post/:id/photos/:photoId { alt }: the seller's description of a photo
// for people who can't see it. Empty or null goes back to the default.
router.put('/:photoId', async (req, res) => {
  const photoId = parseId(req.params.photoId);
  if (!photoId) return badRequest(res, 'Photo id must be a positive integer.');
  const alt = parseAlt((req.body || {}).alt);
  if (alt.error) return badRequest(res, alt.error, { alt: alt.error });
  try {
    const photo = await models.PostPhoto.findOne({ where: { id: photoId, postId: req.post.id } });
    if (!photo) return notFound(res, 'Photo not found.');
    await photo.update({ alt: alt.value });
    return res.json(photo);
  } catch (err) {
    return serverError(res, err);
  }
});

router.delete('/:photoId', async (req, res) => {
  const photoId = parseId(req.params.photoId);
  if (!photoId) return badRequest(res, 'Photo id must be a positive integer.');
  try {
    const photo = await models.PostPhoto.findOne({ where: { id: photoId, postId: req.post.id } });
    if (!photo) return notFound(res, 'Photo not found.');
    await removePhotoFiles([photo]);
    // Items that used this photo keep their place, just without a picture.
    await models.SaleItem.update({ photoId: null }, { where: { photoId: photo.id } });
    await photo.destroy();
    return res.status(204).end();
  } catch (err) {
    return serverError(res, err);
  }
});

async function removePhotoFiles(photos) {
  const storage = getStorage();
  for (const p of photos) {
    await storage.remove(p.storageKey);
    await storage.remove(p.thumbKey);
  }
}

module.exports = router;
module.exports.removePhotoFiles = removePhotoFiles;
