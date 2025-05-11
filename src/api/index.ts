// src/api/index.ts
import { Router } from 'express';
import v1Router from './v1';
// import v2Router from './v2';

const createApiRouter = (): Router => {
    const router = Router();
    router.use('/v1', v1Router());
    // router.use('/v2', v2Router());
    return router;
}

export default createApiRouter; 