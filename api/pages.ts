import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createBulkPagesHandler } from '../src/server/handlers/api';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const response = await createBulkPagesHandler();
  const body = await response.json();
  res.status(response.status).json(body);
}
