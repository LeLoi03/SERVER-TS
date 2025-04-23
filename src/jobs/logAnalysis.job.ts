import cron from 'node-cron';
import { Server as SocketIOServer } from 'socket.io';
import logToFile from '../utils/logger';
import { LogAnalysisService } from '../services/logAnalysis.service';

export const scheduleLogAnalysisJob = (
    logAnalysisService: LogAnalysisService,
    io: SocketIOServer // Nhận io instance để emit updates
) => {
    const cronSchedule = '30 * * * *'; // Chạy vào phút thứ 30 của mỗi giờ


    logToFile(`[Cron] Scheduling log analysis job with schedule: "${cronSchedule}"`);

    cron.schedule(cronSchedule, async () => {

        logToFile('[Cron] Running scheduled log analysis...');
        try {
            // Gọi service để thực hiện phân tích
            const results = await logAnalysisService.performAnalysisAndUpdate(); // Hàm này sẽ cập nhật cache và trả về kết quả

            // Phát broadcast kết quả mới nhất qua Socket.IO
            io.emit('log_analysis_update', results);

            logToFile('[Cron] Log analysis finished and results broadcasted.');

        } catch (error) {

            logToFile(`[Cron] Scheduled log analysis failed: ${error instanceof Error ? error.message : String(error)}`);
            // Quyết định có nên emit lỗi hay không
            io.emit('log_analysis_error', {
                message: 'Scheduled log analysis failed to complete.',
                timestamp: new Date(),
                error: error instanceof Error ? error.message : String(error) // Gửi thông điệp lỗi cơ bản
            });
        }
    }, {
        scheduled: true,
        timezone: "Asia/Ho_Chi_Minh" // Đặt múi giờ nếu cần
    });


};