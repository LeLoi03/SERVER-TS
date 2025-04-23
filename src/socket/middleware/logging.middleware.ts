import { Request, Response, NextFunction } from 'express';
import logToFile from '../../utils/logger';

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Bỏ qua logging cho các request nội bộ của Socket.IO hoặc các path không cần thiết
    if (req.url.startsWith('/socket.io/') || req.url === '/favicon.ico') {
        return next();
    }

    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || 'N/A';

    // Log bắt đầu request
    const requestLogMsg = `--> ${method} ${originalUrl} from ${ip} (User-Agent: ${userAgent})`;
    
    logToFile(`[HTTP Request] ${requestLogMsg}`);

    // Log khi response kết thúc
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        const responseLogMsg = `<-- ${method} ${originalUrl} ${statusCode} ${duration}ms`;

        if (statusCode >= 500) {
            
            logToFile(`[HTTP Response] ${responseLogMsg} - ERROR`);
        } else if (statusCode >= 400) {
            
            logToFile(`[HTTP Response] ${responseLogMsg} - WARN`);
        } else {
            
            logToFile(`[HTTP Response] ${responseLogMsg}`);
        }
    });

    next();
};