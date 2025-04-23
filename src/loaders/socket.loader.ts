// src/loaders/socket.loader.ts

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { config } from '../config/environment'; // Import config chung
// Không cần import corsOptions trực tiếp ở đây, vì Socket.IO có cấu hình CORS riêng
import { socketAuthMiddleware } from '../socket/middleware/auth.middleware'; // Import middleware xác thực
import { handleConnection } from '../socket/handlers/connection.handlers';   // Import handler chính cho kết nối mới
import logToFile from '../utils/logger';       // Import logger ghi file
import { ConversationHistoryService } from '../chatbot/services/conversationHistory.service';

// Biến cục bộ để lưu trữ instance của Socket.IO server sau khi khởi tạo
let ioInstance: SocketIOServer | null = null;

/**
 * Khởi tạo và cấu hình Socket.IO server.
 * Gắn nó vào HTTP server, áp dụng middleware và đăng ký connection handler.
 * @param httpServer - Instance của HTTP server đã được tạo.
 * @param conversationHistoryService - Instance của ConversationHistoryService để truyền cho connection handler.
 * @returns Instance của SocketIOServer đã được khởi tạo.
 */
export const initSocketIO = (
    httpServer: HttpServer,
    conversationHistoryService: ConversationHistoryService // Nhận dependencies qua tham số
): SocketIOServer => {

    logToFile('[Loader Socket] Initializing Socket.IO server...');

    // Tạo instance SocketIOServer
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: config.allowedOrigins, // Sử dụng danh sách origins từ config
            methods: ["GET", "POST"],       // Các phương thức HTTP được phép cho CORS handshake
            credentials: true              // Cho phép gửi credentials (như cookie, auth headers)
        },
        // transports: ['websocket', 'polling'], // Có thể chỉ định transports nếu cần
        // path: '/socket.io', // Đường dẫn mặc định, có thể thay đổi nếu muốn
        // pingTimeout: 60000, // Thời gian chờ ping (ms)
        // pingInterval: 25000 // Khoảng thời gian gửi ping (ms)
    });



    // --- Áp dụng Middleware ---
    // Middleware này sẽ chạy cho mọi kết nối socket đến
    io.use(socketAuthMiddleware);

    logToFile('[Loader Socket] Socket.IO authentication middleware applied.');

    // --- Đăng ký Connection Handler ---
    // Hàm này sẽ được gọi mỗi khi có một client mới kết nối thành công (sau khi qua middleware)
    io.on('connection', (socket: Socket) => {
        // Gọi hàm xử lý kết nối từ module handlers, truyền các dependencies cần thiết
        handleConnection(io, socket, conversationHistoryService);
    });

    logToFile('[Loader Socket] Socket.IO connection handler registered.');

    // Lưu instance vào biến cục bộ để có thể truy cập qua getIO()
    ioInstance = io;


    logToFile('[Loader Socket] Socket.IO server initialized successfully.');
    return io; // Trả về instance đã tạo
};

/**
 * Lấy instance của Socket.IO server đã được khởi tạo.
 * Hàm này dùng cho các module khác (ví dụ: services, jobs) cần emit sự kiện.
 * @throws Error nếu initSocketIO chưa được gọi.
 * @returns Instance SocketIOServer đã được khởi tạo.
 */
export const getIO = (): SocketIOServer => {
    if (!ioInstance) {
        const errorMsg = "[Loader Socket] FATAL: Attempted to get IO instance before initialization. Call initSocketIO first.";

        logToFile(errorMsg);
        // Ném lỗi để dừng chương trình hoặc báo hiệu rõ ràng vấn đề
        throw new Error(errorMsg);
    }
    return ioInstance;
};

// Có thể thêm các hàm tiện ích khác liên quan đến Socket.IO loader ở đây nếu cần