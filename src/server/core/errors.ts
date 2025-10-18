/**
 * Custom error types for the server
 */

export class ServerError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

export class NotFoundError extends ServerError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class StaticFileError extends ServerError {
  constructor(message: string = 'Static file error') {
    super(message, 404, 'STATIC_FILE_ERROR');
  }
}

/**
 * Error response helper
 */
export function createErrorResponse(error: ServerError): Response {
  const errorHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${error.statusCode} - ${error.name}</title>
        <link rel="stylesheet" href="/global.css">
      </head>
      <body>
        <div class="container">
          <h1>${error.statusCode} - ${error.name}</h1>
          <p>${error.message}</p>
          <a href="/">← Back to Home</a>
        </div>
      </body>
    </html>
  `;

  return new Response(errorHtml, {
    status: error.statusCode,
    headers: { "Content-Type": "text/html" },
  });
}
