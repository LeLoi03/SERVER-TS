// server.ts
import 'reflect-metadata';
import { config } from './config/environment';
import { initLoaders } from './loaders'; // Import orchestrator
import logToFile from './utils/logger';

async function startServer() {
    try {
        logToFile('[Server Start] Initializing loaders...');
        const { httpServer } = await initLoaders(); // Chỉ cần httpServer để listen

        // --- Start Server ---
        httpServer.listen(config.port, () => {
            const serverUrl = `http://localhost:${config.port}`; // Hoặc IP thực tế
            logToFile(`🚀 Server (HTTP + Socket.IO) listening on port ${config.port}`);
            logToFile(`🔗 Access the server at: ${serverUrl}`);
            logToFile(`🌐 Allowed CORS origins: ${config.allowedOrigins.join(', ')}`);
            logToFile(`[Server Start] Server listening on port ${config.port}. Access at ${serverUrl}`);
            
            console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${config.port}`)
            console.log(`🔗 Access the server at: ${serverUrl}`)
            console.log(`🌐 Allowed CORS origins: ${config.allowedOrigins.join(', ')}`)
            console.log(`[Server Start] Server listening on port ${config.port}. Access at ${serverUrl}`)

        });

        // --- Graceful Shutdown Handling ---
        const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

        signals.forEach((signal) => {
            process.on(signal, async () => {
                logToFile(`[Server Shutdown] Received ${signal}. Starting graceful shutdown...`);

                // 1. Close HTTP Server (stop accepting new connections)
                httpServer.close(async (err) => {
                    if (err) {
                        logToFile('[Server Shutdown] Error closing HTTP server');
                        process.exit(1); // Exit immediately on server close error
                    }
                    logToFile('[Server Shutdown] HTTP server closed.');

                    // 2. Close Database Connection
                    try {
                        // Giả sử bạn có hàm disconnectDB hoặc dùng mongoose.connection.close()
                        // await disconnectDB();
                        const mongoose = await import('mongoose'); // Import động để tránh cyclical deps nếu cần
                        await mongoose.connection.close();
                        logToFile('[Server Shutdown] MongoDB connection closed.');
                    } catch (dbErr) {
                        logToFile('[Server Shutdown] Error closing MongoDB connection');
                    }

                    // 3. Add any other cleanup tasks here (e.g., close external connections)

                    logToFile('[Server Shutdown] Graceful shutdown completed.');
                    process.exit(0); // Exit successfully
                });

                // Force shutdown after a timeout if graceful shutdown takes too long
                setTimeout(() => {
                    logToFile('[Server Shutdown] Graceful shutdown timeout exceeded. Forcing exit.');
                    process.exit(1);
                }, 10000); // 10 seconds timeout
            });
        });

    } catch (error) {
        logToFile(`[Server Start] FATAL ERROR during initialization: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

startServer();