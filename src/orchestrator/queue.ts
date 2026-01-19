import { getConfig } from '../config/index.js';
import { jobsRepository, Job, JobType } from '../database/repositories/jobs.js';
import { sessionsRepository } from '../database/repositories/sessions.js';
import pino from 'pino';

const log = pino({ name: 'queue' });

export type JobHandler = (job: Job) => Promise<void>;

interface JobHandlers {
  start_agent: JobHandler;
  resume_agent: JobHandler;
  stop_agent: JobHandler;
}

export class JobQueue {
  private handlers: Partial<JobHandlers> = {};
  private processing = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private currentJobs = new Set<number>();

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers[type] = handler;
  }

  start(): void {
    if (this.pollInterval) {
      return;
    }

    log.info('Starting job queue');
    this.processing = true;
    this.pollInterval = setInterval(() => this.processJobs(), 1000);

    // Process immediately on start
    this.processJobs();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.processing = false;
    log.info('Job queue stopped');
  }

  private async processJobs(): Promise<void> {
    if (!this.processing) {
      return;
    }

    const config = getConfig();

    // Check concurrency limit
    const activeAgents = sessionsRepository.countByState(['initializing', 'running', 'waiting', 'completing']);

    if (activeAgents >= config.agent.maxConcurrent) {
      log.debug({ activeAgents, limit: config.agent.maxConcurrent }, 'Concurrency limit reached');
      return;
    }

    // Get pending jobs
    const pendingJobs = jobsRepository.findPending();

    for (const job of pendingJobs) {
      // Skip if already processing
      if (this.currentJobs.has(job.id)) {
        continue;
      }

      // Recheck concurrency for each job
      const currentActive = sessionsRepository.countByState(['initializing', 'running', 'waiting', 'completing']);
      if (currentActive >= config.agent.maxConcurrent) {
        break;
      }

      // Try to claim the job
      if (!jobsRepository.claimJob(job.id)) {
        continue;
      }

      this.currentJobs.add(job.id);

      // Process the job
      this.processJob(job)
        .catch((error) => {
          log.error({ error, jobId: job.id }, 'Job processing error');
        })
        .finally(() => {
          this.currentJobs.delete(job.id);
        });
    }
  }

  private async processJob(job: Job): Promise<void> {
    log.info({ jobId: job.id, type: job.job_type }, 'Processing job');

    const handler = this.handlers[job.job_type];

    if (!handler) {
      log.error({ type: job.job_type }, 'No handler registered for job type');
      jobsRepository.updateStatus(job.id, 'failed', `No handler for job type: ${job.job_type}`);
      return;
    }

    try {
      await handler(job);
      jobsRepository.updateStatus(job.id, 'completed');
      log.info({ jobId: job.id }, 'Job completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ error, jobId: job.id }, 'Job failed');
      jobsRepository.updateStatus(job.id, 'failed', errorMessage);
    }
  }

  getStats(): { pending: number; processing: number; active: number } {
    return {
      pending: jobsRepository.countByStatus('pending'),
      processing: this.currentJobs.size,
      active: sessionsRepository.countByState(['initializing', 'running', 'waiting', 'completing']),
    };
  }
}

export const jobQueue = new JobQueue();
