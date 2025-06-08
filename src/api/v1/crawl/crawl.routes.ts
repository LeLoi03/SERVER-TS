// src/api/v1/crawl/crawl.routes.ts
import { Router } from 'express';
// Import the controller functions that handle the crawl-related requests.
import { handleCrawlConferences, handleCrawlJournals } from './crawl.controller';

/**
 * Creates and configures the API routes for crawl-related operations (v1).
 *
 * @returns {Router} An Express Router instance with defined crawl endpoints.
 */
const createCrawlRouter = (): Router => {
    const router = Router();

    /**
     * POST /crawl-conferences
     * Initiates a conference crawling and processing task.
     * This route is typically protected by a mutex to prevent concurrent runs.
     */
    router.post('/crawl-conferences', handleCrawlConferences);

    /**
     * POST /crawl-journals
     * Placeholder route for journal crawling. Currently not implemented.
     */
    router.post('/crawl-journals', handleCrawlJournals);

    // /**
    //  * POST /save-conferences
    //  * Triggers a manual save of processed conference data to the database.
    //  */
    // router.post('/save-conferences', handleSaveConference);

    return router;
};

// Export the router creation function.
export default createCrawlRouter;