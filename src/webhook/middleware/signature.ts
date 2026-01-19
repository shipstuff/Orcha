import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getConfig } from '../../config/index.js';

export function verifyGitHubSignature(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const config = getConfig();
  const signature = request.headers['x-hub-signature-256'];

  if (!signature || typeof signature !== 'string') {
    reply.code(401).send({ error: 'Missing signature header' });
    return;
  }

  const body = JSON.stringify(request.body);
  const expectedSignature = `sha256=${createHmac('sha256', config.github.webhookSecret)
    .update(body)
    .digest('hex')}`;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    reply.code(401).send({ error: 'Invalid signature' });
    return;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    reply.code(401).send({ error: 'Invalid signature' });
    return;
  }

  done();
}
