import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApiHandler } from '../src/server/handlers/api';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url!, `https://${req.headers.host}`);
  const apiHandler = createApiHandler(url);
  const response = await apiHandler();
  const body = await response.json();
  res.status(response.status).json(body);
}
