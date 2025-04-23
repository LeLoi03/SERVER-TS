// src/chatbot/utils/historyMapper.ts
import { HistoryItem, ChatMessageType } from '../shared/types'; // Import backend types
import { generateMessageId } from './chatUtils'; // Import frontend utility

export const mapHistoryToFrontendMessages = (history: HistoryItem[]): ChatMessageType[] => {
    if (!history) return [];

    // 1. Lọc ra chỉ những tin nhắn cần hiển thị cho người dùng
    const filteredHistory = history.filter(item => {
        // Giữ lại tin nhắn của người dùng nếu có text
        if (item.role === 'user' && item.parts?.[0]?.text) {
            return true;
        }
        // Giữ lại tin nhắn của model NẾU đó là text (không phải function call)
        if (item.role === 'model' && item.parts?.[0]?.text) {
            return true;
        }
        // Loại bỏ tất cả các trường hợp khác:
        // - model function call (item.parts[0].functionCall)
        // - function response (item.role === 'function')
        return false;
    });

    // 2. Map những tin nhắn đã lọc thành định dạng frontend
    return filteredHistory.map((item): ChatMessageType => {
        // Tại đây, chúng ta biết chắc chắn item.parts[0].text tồn tại
        const messageText = item.parts[0].text!; // Sử dụng non-null assertion vì đã lọc ở trên
        const messageId = generateMessageId();

        // Xác định type cơ bản (có thể mở rộng sau nếu model trả về map/image...)
        const messageType: 'text' | 'map' | 'error' | 'warning' = 'text';

        return {
            id: messageId,
            message: messageText,
            isUser: item.role === 'user',
            type: messageType,
            thoughts: undefined, // Lịch sử thường không lưu thoughts
            location: undefined, // Lịch sử thường không lưu location
            // timestamp: item.timestamp // Có thể thêm timestamp nếu cần
        };
    });
};

// Helper getTextFromParts không còn cần thiết cho mục đích mapping này nữa
// vì chúng ta đã lọc và chỉ xử lý phần text. Bạn có thể xóa nó nếu không dùng ở đâu khác.