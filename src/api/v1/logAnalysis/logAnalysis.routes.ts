// src/api/v1/logAnalysis/logAnalysis.routes.ts
import { Router } from 'express';
import { container } from 'tsyringe'; // For resolving LoggingService
import { LoggingService } from '../../../services/logging.service'; // Import LoggingService

// Import the controller functions that handle log analysis requests.
import { getLatestAnalysis, triggerAnalysis } from './logAnalysis.controller';

/**
 * Creates and configures the API routes for log analysis operations (v1).
 * It logs its configuration process using the `LoggingService`.
 *
 * @returns {Router} An Express Router instance with defined log analysis endpoints.
 */
const createLogAnalysisRouter = (): Router => {
    const router = Router();

    // Resolve LoggingService to log the route configuration process.
    // This is one of the few places in a route file where a service might be resolved directly
    // for configuration-time logging, rather than in a controller or middleware.
    const loggingService = container.resolve(LoggingService);
    const logger = loggingService.getLogger({ context: 'LogAnalysisRoutes' });

    logger.info('Configuring log analysis API routes...');

    /**
     * GET /latest
     * Retrieves the latest log analysis results, potentially triggering a fresh analysis.
     * Supports query parameters for filtering by time range and request ID.
     */
    router.get('/latest', getLatestAnalysis);

    /**
     * POST /trigger
     * Triggers a background log analysis task asynchronously.
     */
    router.post('/trigger', triggerAnalysis);

    logger.info('Log analysis API routes configured: GET /latest, POST /trigger.');

    return router;
}

// Export the router creation function.
export default createLogAnalysisRouter;