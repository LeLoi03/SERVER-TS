import { Router } from 'express';
import { handleCrawlConferences, handleCrawlJournals } from './crawl.controller';

const router = Router();

// Định nghĩa routes cho crawl
router.post('/conferences', handleCrawlConferences);
router.post('/journals', handleCrawlJournals);

export default router;