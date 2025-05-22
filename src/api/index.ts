// src/api/index.ts
import { Router } from 'express';

// Import router creation functions for different API versions.
import createV1Router from './v1'; // Imports the function to create the v1 router
// import createV2Router from './v2'; // Placeholder for future API versions

/**
 * Creates and configures the top-level API router for the entire application.
 * This router serves as the entry point for all API versions (e.g., /api/v1, /api/v2).
 *
 * @returns {Router} An Express Router instance that includes all API versions.
 */
const createApiRouter = (): Router => {
    const router = Router();

    /**
     * Mounts the v1 API routes under the '/v1' path.
     * `createV1Router()` is called here to get the configured v1 router instance.
     */
    router.use('/v1', createV1Router());

    // Placeholder for mounting future API versions.
    // Example: router.use('/v2', createV2Router());

    return router;
};

// Export the top-level API router creation function.
export default createApiRouter;