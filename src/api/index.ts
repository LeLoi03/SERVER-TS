import { Router } from 'express';
import v1Router from './v1';

const router = Router();

// Gắn router cho phiên bản v1
router.use('/v1', v1Router);

// Gắn router cho các phiên bản khác nếu có (v2, v3,...)
// router.use('/v2', v2Router);

export default router; // Router này sẽ được mount vào /api trong express.loader