import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createRouter } from '../lib/router';
import { IMAGES_DIR, isValidImageName } from '../lib/images';
import { requireAuth } from '../middleware/auth';

export const imagesRouter = createRouter();
imagesRouter.use(requireAuth);

// GET /api/images/:name — meal photos stored on disk (content-addressed, so they can be cached forever)
imagesRouter.get('/:name', (req: Request, res: Response): void => {
  const name = req.params.name;
  if (!isValidImageName(name)) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  const file = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('image/jpeg');
  res.sendFile(file);
});
