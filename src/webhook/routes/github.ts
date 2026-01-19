import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyGitHubSignature } from '../middleware/signature.js';
import { handleIssueEvent } from '../handlers/issue.js';
import { handleCommentEvent } from '../handlers/comment.js';

interface WebhookPayload {
  action: string;
  issue?: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    labels: Array<{ name: string }>;
  };
  comment?: {
    id: number;
    body: string;
    user: { login: string };
    in_reply_to_id?: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    clone_url: string;
  };
  installation?: {
    id: number;
  };
  sender: {
    login: string;
  };
}

export async function githubWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', verifyGitHubSignature);

  app.post('/github', async (request: FastifyRequest, reply: FastifyReply) => {
    const event = request.headers['x-github-event'];
    const payload = request.body as WebhookPayload;

    request.log.info({ event, action: payload.action }, 'Received webhook');

    try {
      switch (event) {
        case 'issues':
          await handleIssueEvent(payload, request.log);
          break;

        case 'issue_comment':
          await handleCommentEvent(payload, request.log);
          break;

        default:
          request.log.debug({ event }, 'Ignoring unhandled event type');
      }

      return { received: true };
    } catch (error) {
      request.log.error({ error }, 'Error processing webhook');
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
