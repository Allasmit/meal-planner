import './config'; // must stay first: loads .env and validates JWT_SECRET
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { mealsRouter } from './routes/meals';
import { plannerRouter } from './routes/planner';
import { importRouter } from './routes/import';
import { familyRouter } from './routes/family';
import { runMigrations } from './db/migrate';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.set('trust proxy', 'loopback'); // behind Caddy on the same machine: use the real client IP for rate limiting

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }),
);
// Meals carry an inline image and imports can carry whole pasted pages, so only those routes get the larger limit.
app.use(['/api/meals', '/api/import'], express.json({ limit: '10mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/meals', mealsRouter);
app.use('/api/planner', plannerRouter);
app.use('/api/import', importRouter);
app.use('/api/family', familyRouter);

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Client errors raised by body-parser (bad JSON, payload too large) and multer (upload limits).
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Request is too large' });
    return;
  }
  if (err?.type === 'entity.parse.failed' || err?.name === 'MulterError') {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const constraintCode: string = err?.code ?? err?.cause?.code ?? '';
  const constraintMessage: string = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
  if (constraintCode === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint failed/i.test(constraintMessage)) {
    res.status(400).json({ error: 'A referenced item does not exist or is still in use' });
    return;
  }
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message || 'Invalid request' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Migrations must finish before the server accepts requests.
runMigrations()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`API server running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

// Prevent unhandled async errors from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
